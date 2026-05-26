import { beforeAll, describe, expect, it, vi } from 'vitest';

let buildChallengerCrossCheckItems;
let buildInterventionTimelineStages;
let buildRecentPublishTrendData;
let formatInterventionCloseReasonLabel;
let formatInterventionHistoryEntry;
let formatInterventionProxyStatusLabel;
let formatSourceCompletenessStatus;

beforeAll(async () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test-auth-domain');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project-id');
  vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'test-storage-bucket');
  vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 'test-messaging-sender-id');
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app-id');
  vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', 'test-measurement-id');
  vi.stubEnv('VITE_USE_FUNCTIONS_EMULATOR', 'false');

  const module = await import('../DropoutRiskPanel.jsx');
  buildChallengerCrossCheckItems = module.buildChallengerCrossCheckItems;
  buildInterventionTimelineStages = module.buildInterventionTimelineStages;
  buildRecentPublishTrendData = module.buildRecentPublishTrendData;
  formatInterventionCloseReasonLabel = module.formatInterventionCloseReasonLabel;
  formatInterventionHistoryEntry = module.formatInterventionHistoryEntry;
  formatInterventionProxyStatusLabel = module.formatInterventionProxyStatusLabel;
  formatSourceCompletenessStatus = module.formatSourceCompletenessStatus;
});

function buildPublishEntry(index, probability, bucket = 'low') {
  const publishedAt = new Date(Date.UTC(2026, 4, 15, 9, 0, index)).toISOString();
  return {
    id: `publish-${index}`,
    published_at: publishedAt,
    dropout_probability: probability,
    risk_bucket: bucket,
    recommended_action: bucket === 'high' ? 'review_today_consider_outreach' : 'monitor_only',
  };
}

describe('buildRecentPublishTrendData', () => {
  it('limits the trend view to 7 publishes including the current publish', () => {
    const currentEntry = buildPublishEntry(8, 0.72, 'high');
    const historyRows = Array.from({ length: 8 }, (_, index) => buildPublishEntry(index, 0.1 + index * 0.05));

    const result = buildRecentPublishTrendData(historyRows, currentEntry);

    expect(result.visibleRows).toHaveLength(7);
    expect(result.timelineRows).toHaveLength(6);
    expect(result.visibleRows[0].id).toBe(currentEntry.id);
  });

  it('drops history rows that duplicate the current publish identity', () => {
    const currentEntry = {
      ...buildPublishEntry(4, 0.74, 'high'),
      history_doc_id: 'publish-4',
      model_version: 'model_stage_3_29_single.pth',
      subject_id: 'TL-S1',
    };
    const duplicateHistoryEntry = {
      ...currentEntry,
      id: 'history-duplicate',
    };
    const historyRows = [
      duplicateHistoryEntry,
      {
        ...buildPublishEntry(3, 0.59, 'high'),
        history_doc_id: 'publish-3',
        model_version: 'model_stage_3_29_single.pth',
        subject_id: 'TL-S1',
      },
      {
        ...buildPublishEntry(2, 0.41, 'medium'),
        history_doc_id: 'publish-2',
        model_version: 'model_stage_3_29_single.pth',
        subject_id: 'TL-S1',
      },
    ];

    const result = buildRecentPublishTrendData(historyRows, currentEntry);

    expect(result.visibleRows).toHaveLength(3);
    expect(new Set(result.visibleRows.map((entry) => entry.published_at)).size).toBe(3);
    expect(result.visibleRows[1].id).toBe('publish-3');
  });

  it('sorts publishes into a rising trend and computes the latest delta against the prior publish', () => {
    const currentEntry = buildPublishEntry(4, 0.74, 'high');
    const historyRows = [
      buildPublishEntry(3, 0.59, 'high'),
      buildPublishEntry(2, 0.41, 'medium'),
      buildPublishEntry(1, 0.24, 'low'),
    ];

    const result = buildRecentPublishTrendData(historyRows, currentEntry);

    expect(result.trendDirection).toBe('rising');
    expect(result.latestDelta).toBeCloseTo(0.15, 5);
    expect(result.chronologicalRows.at(-1).id).toBe(currentEntry.id);
  });

  it('marks a window as stable when all visible publish movements stay inside the stable threshold', () => {
    const currentEntry = buildPublishEntry(4, 0.657, 'high');
    const historyRows = [
      buildPublishEntry(3, 0.6569, 'high'),
      buildPublishEntry(2, 0.6567, 'high'),
      buildPublishEntry(1, 0.6568, 'high'),
    ];

    const result = buildRecentPublishTrendData(historyRows, currentEntry);

    expect(result.trendDirection).toBe('stable');
  });

  it('marks a window as mixed when publishes move in both directions', () => {
    const currentEntry = buildPublishEntry(4, 0.44, 'medium');
    const historyRows = [
      buildPublishEntry(3, 0.61, 'high'),
      buildPublishEntry(2, 0.32, 'low'),
      buildPublishEntry(1, 0.48, 'medium'),
    ];

    const result = buildRecentPublishTrendData(historyRows, currentEntry);

    expect(result.trendDirection).toBe('mixed / volatile');
  });

  it('filters stale floor-collapsed legacy publishes and anchors the true previous publish', () => {
    const currentEntry = {
      ...buildPublishEntry(9, 0.266, 'low'),
      model_version: 'model_stage_3_29_single.pth',
      subject_id: 'TL-S1',
      model_runtime_diagnostics: { checkpoints_dir_basename: 'checkpoints_live_v2' },
    };
    const staleHistoryRows = [
      buildPublishEntry(8, 0.000001, 'low'),
      buildPublishEntry(7, 0.000001, 'low'),
      buildPublishEntry(6, 0.000001, 'low'),
    ];

    const result = buildRecentPublishTrendData(staleHistoryRows, currentEntry, {
      previousPublish: {
        previous_published_at: buildPublishEntry(8, 0.594, 'medium').published_at,
        previous_dropout_probability: 0.594,
        previous_risk_bucket: 'medium',
      },
    });

    expect(result.chronologicalRows).toHaveLength(2);
    expect(result.chronologicalRows[0].dropout_probability).toBe(0.594);
    expect(result.chronologicalRows[1]).toBe(currentEntry);
    expect(result.latestDelta).toBeCloseTo(-0.328, 5);
  });
});

describe('dropout case and explainability labels', () => {
  it('maps observation and close-reason labels to fixed CRC wording', () => {
    expect(formatInterventionProxyStatusLabel('window_open')).toBe('Observation window open');
    expect(formatInterventionProxyStatusLabel('reengaged_observed')).toBe('Re-engagement observed');
    expect(formatInterventionCloseReasonLabel('auto_reengaged')).toBe(
      'Closed automatically after re-engagement was observed'
    );
    expect(formatInterventionCloseReasonLabel('manual_crc_close')).toBe('Closed manually by CRC');
  });

  it('shows patient daily logs as an optional fallback source', () => {
    expect(formatSourceCompletenessStatus('optional_fallback_not_used')).toBe('optional fallback');
  });

  it('formats recent case history with status, observation, close reason, and timestamp', () => {
    const label = formatInterventionHistoryEntry({
      status: 'closed',
      proxy_reengagement_status: 'reengaged_observed',
      close_reason: 'auto_reengaged',
      updated_at: '2026-05-15T10:00:00Z',
    });

    expect(label).toContain('Closed');
    expect(label).toContain('Re-engagement observed');
    expect(label).toContain('Closed automatically after re-engagement was observed');
  });

  it('does not invent a 1970 auto-evaluation timestamp when no case dates exist', () => {
    const autoStage = buildInterventionTimelineStages({}).find((stage) => stage.key === 'auto');

    expect(autoStage.timestamp).toBeNull();
    expect(autoStage.caption).toBe('');
  });

  it('drops repetitive challenger timing lines when the primary explanation already says the same thing', () => {
    const rows = buildChallengerCrossCheckItems(
      'This challenger cross-check is being used as a secondary read on operational follow-up, symptom burden, and source coverage before agreeing with the published direction.',
      [
        'Recent engagement timing around day 8 is one of the strongest local signals in the current patient window.',
        'The challenger is also checking whether operational follow-up friction is contributing to the risk picture because the CRC follow-up loop is still open.',
      ],
      [
        'The Transformer temporal focus highlighted recent engagement history around day 8; this attention marker is not by itself a negative disengagement signal.',
      ]
    );

    expect(rows.some((entry) => entry.toLowerCase().includes('operational follow-up friction'))).toBe(true);
    expect(rows.some((entry) => entry.toLowerCase().includes('engagement timing around day 8'))).toBe(false);
  });
});
