import React, { useEffect, useMemo, useState } from 'react';
import WindowPaginationControls from './WindowPaginationControls';
import {
  fetchDropoutDashboardSummary,
  subscribeToAllDropoutPredictionSnapshots,
  subscribeToDropoutPredictionExplainability,
  subscribeToDropoutPredictionSnapshotsForUsers,
} from '../services/dropoutService';

const DEFAULT_DROPOUT_PAGE_SIZE = 30;

function renderRiskBucket(bucket) {
  return String(bucket || 'pending').toUpperCase();
}

function isEarlyHistorySnapshot(snapshot = {}) {
  const riskBucket = String(snapshot?.risk_bucket || '').trim().toLowerCase();
  const routedStage = String(snapshot?.routed_stage || '').trim().toLowerCase();
  const recommendedAction = String(snapshot?.recommended_action || '').trim().toLowerCase();
  const flags = Array.isArray(snapshot?.data_quality_flags)
    ? snapshot.data_quality_flags.map((entry) => String(entry || '').trim().toLowerCase())
    : [];

  return (
    riskBucket === 'insufficient_history' ||
    routedStage === 'insufficient_history' ||
    recommendedAction === 'collect_more_history' ||
    flags.includes('insufficient_history_no_score')
  );
}

function renderSnapshotStateLabel(snapshot = {}) {
  if (isEarlyHistorySnapshot(snapshot)) {
    return 'COLLECTING DATA';
  }
  return renderRiskBucket(snapshot?.risk_bucket);
}

function getProbabilityNumber(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function formatProbabilityPercent(value) {
  const probability = getProbabilityNumber(value);
  return probability == null ? 'N/A' : `${(probability * 100).toFixed(1)}%`;
}

function formatProbabilityDecimal(value) {
  const probability = getProbabilityNumber(value);
  return probability == null ? 'N/A' : probability.toFixed(3);
}

function isActionableSnapshot(snapshot = {}) {
  if (isEarlyHistorySnapshot(snapshot)) return false;
  if (snapshot.is_actionable === true) return true;
  const riskBucket = String(snapshot.risk_bucket || '').toLowerCase();
  const priorityScore = Number(snapshot.action_priority_score);
  return riskBucket === 'high' || (Number.isFinite(priorityScore) && priorityScore >= 0.5);
}

function getConfidenceLabel(flagsValue) {
  const flags = Array.isArray(flagsValue) ? flagsValue.map((entry) => String(entry || '').toLowerCase()) : [];
  if (flags.includes('confidence_high')) return 'High';
  if (flags.includes('confidence_medium')) return 'Medium';
  if (flags.includes('confidence_limited')) return 'Limited';
  return 'Unknown';
}

function formatSnapshotProbabilityPercent(snapshot = {}) {
  if (isEarlyHistorySnapshot(snapshot)) {
    return 'Data not sufficient yet';
  }
  return formatProbabilityPercent(snapshot?.dropout_probability);
}

function formatSnapshotProbabilityDecimal(snapshot = {}) {
  if (isEarlyHistorySnapshot(snapshot)) {
    return 'Not scored yet';
  }
  return formatProbabilityDecimal(snapshot?.dropout_probability);
}

function formatRecommendedAction(snapshot = {}) {
  if (isEarlyHistorySnapshot(snapshot)) {
    return 'Collect more history';
  }
  return snapshot?.recommended_action || 'N/A';
}

function buildEarlyHistorySummary(snapshot = {}) {
  if (!isEarlyHistorySnapshot(snapshot)) {
    return '';
  }

  const historyWindowDays = Number(snapshot?.history_window_days);
  const historyWindowLabel = Number.isFinite(historyWindowDays) ? `${historyWindowDays}-day` : 'recent';
  return `This patient is still in the early data-collection phase. TrialLight has not issued a formal disengagement risk score yet because the ${historyWindowLabel} history window is not mature enough. Continue collecting patient activity, ePRO, and safety history.`;
}

function buildSignalLines(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry == null) return '';
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object') {
          const label = entry.label || entry.signal || entry.key || entry.feature || '';
          const signalValue = entry.value ?? entry.score ?? entry.delta ?? '';
          return label ? `${label}: ${signalValue}` : JSON.stringify(entry);
        }
        return String(entry);
      })
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, signalValue]) => `${key}: ${signalValue}`);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function translateLegacySignalEntry(signalEntry) {
  if (typeof signalEntry === 'string') {
    return String(signalEntry).trim();
  }
  if (!signalEntry || typeof signalEntry !== 'object') {
    return String(signalEntry || '').trim();
  }

  const signalName = String(
    signalEntry.signal || signalEntry.label || signalEntry.feature || signalEntry.key || ''
  )
    .trim()
    .toLowerCase();
  const signalValue = Number(signalEntry.value);
  const dayIndex = Number(signalEntry.day_index);
  const hasNumericValue = Number.isFinite(signalValue);

  if (signalName === 'attention_peak') {
    return Number.isFinite(dayIndex)
      ? `Recent engagement activity around day ${dayIndex} was highlighted as a strong disengagement signal.`
      : 'Recent engagement activity was highlighted as a strong disengagement signal.';
  }
  if (signalName === 'days_since_last_any_activity' && hasNumericValue) {
    const rounded = Math.round(signalValue);
    return `No recent patient activity was recorded for about ${rounded} day${rounded === 1 ? '' : 's'}, which is lifting the disengagement score.`;
  }
  if (signalName === 'days_since_last_vitals' && hasNumericValue) {
    const rounded = Math.round(signalValue);
    return `No fresh vitals were logged for about ${rounded} day${rounded === 1 ? '' : 's'}, so the model is treating recent engagement as weaker.`;
  }
  if (signalName === 'epro_status_current') {
    return 'The current questionnaire response status is contributing to the disengagement signal.';
  }
  if (signalName === 'crc_followup_unanswered_72h') {
    return 'An unanswered CRC follow-up thread is still contributing to the disengagement signal.';
  }
  if (signalName === 'ctcae_grade_max_14d' && hasNumericValue) {
    return `Recent side-effect burden is still contributing to the current risk pattern (max CTCAE signal ${signalValue.toFixed(1)}).`;
  }
  if (signalName === 'pain_score_mean_7d' && hasNumericValue) {
    return `Recent pain burden over the last 7 days is contributing to the disengagement signal (mean score ${signalValue.toFixed(1)}).`;
  }
  if (signalName === 'anxiety_score_mean_7d' && hasNumericValue) {
    return `Recent anxiety burden over the last 7 days is contributing to the disengagement signal (mean score ${signalValue.toFixed(1)}).`;
  }

  const fallbackLabel = signalName ? signalName.replace(/_/g, ' ') : 'model signal';
  if (hasNumericValue) {
    return `${fallbackLabel.charAt(0).toUpperCase() + fallbackLabel.slice(1)} is contributing to the current disengagement signal (${signalValue.toFixed(2)}).`;
  }
  return `${fallbackLabel.charAt(0).toUpperCase() + fallbackLabel.slice(1)} is contributing to the current disengagement signal.`;
}

function buildLegacyWhyFlaggedLines(snapshot = null) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const signalEntries = Array.isArray(safeSnapshot.explanation_signals) ? safeSnapshot.explanation_signals : [];
  const translated = signalEntries
    .map((entry) => translateLegacySignalEntry(entry))
    .filter(Boolean);

  if (translated.length) {
    return Array.from(new Set(translated)).slice(0, 5);
  }

  const probability = getProbabilityNumber(safeSnapshot.dropout_probability);
  const bucket = renderRiskBucket(safeSnapshot.risk_bucket);
  if (probability != null) {
    return [`The published snapshot placed this patient in the ${bucket} disengagement bucket at ${(probability * 100).toFixed(1)}%.`];
  }
  return [];
}

function buildLegacyMissingInputLines(snapshot = null) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const missingInputs = Array.isArray(safeSnapshot.missing_inputs_summary) ? safeSnapshot.missing_inputs_summary : [];
  const flags = Array.isArray(safeSnapshot.data_quality_flags)
    ? safeSnapshot.data_quality_flags.map((entry) => String(entry || '').trim().toLowerCase())
    : [];

  const rows = missingInputs
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => `Input coverage gap: ${entry}.`);

  if (flags.includes('reduced_input_mode')) {
    rows.push('This snapshot is running in reduced input mode because part of the upstream engagement evidence is still missing.');
  }
  if (flags.includes('side_effect_signal_missing')) {
    rows.push('Recent structured side-effect signals were missing from the readable feature window.');
  }
  if (flags.includes('insufficient_history_no_score')) {
    rows.push('Recent history depth is still limited, so confidence in the disengagement summary is reduced.');
  }
  if (flags.includes('trial_id_derived_from_subject_id')) {
    rows.push('Trial linkage had to be derived indirectly, which reduces the clarity of the published context.');
  }

  return Array.from(new Set(rows)).slice(0, 5);
}

function decorateSnapshotRows(rows = [], patients = []) {
  const patientMap = new Map((Array.isArray(patients) ? patients : []).map((patient) => [patient.id, patient]));
  return (Array.isArray(rows) ? rows : [])
    .map((snapshot) => {
      const patient = patientMap.get(snapshot.userId) || null;
      return {
        ...snapshot,
        patient,
        userId: snapshot.userId,
        patientName: patient?.nickname || patient?.email || snapshot.subject_id || snapshot.userId || 'Unknown patient',
        patientEmail: patient?.email || '',
        subjectId: snapshot.subject_id || patient?.subject_id || patient?.subjectId || 'Not set',
        primaryCrcName: patient?.primary_crc_name || 'Unassigned',
        isActionable: isActionableSnapshot(snapshot),
      };
    })
    .sort(sortDropoutRows);
}

function sortDropoutRows(left, right) {
  const leftProbability = getProbabilityNumber(left.dropout_probability) ?? -1;
  const rightProbability = getProbabilityNumber(right.dropout_probability) ?? -1;
  if (rightProbability !== leftProbability) {
    return rightProbability - leftProbability;
  }

  const leftPriority = Number(left.action_priority_score);
  const rightPriority = Number(right.action_priority_score);
  const safeLeftPriority = Number.isFinite(leftPriority) ? leftPriority : -1;
  const safeRightPriority = Number.isFinite(rightPriority) ? rightPriority : -1;
  if (safeRightPriority !== safeLeftPriority) {
    return safeRightPriority - safeLeftPriority;
  }

  return String(left.patientName || '').localeCompare(String(right.patientName || ''));
}

function MetricCard({ label, value, tone = 'default' }) {
  return (
    <div className={`dropout-dashboard__metric dropout-dashboard__metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailSection({ title, items, emptyLabel }) {
  if (!items.length) {
    return (
      <div className="dropout-dashboard__detailSection">
        <strong>{title}</strong>
        <div className="section-note">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="dropout-dashboard__detailSection">
      <strong>{title}</strong>
      <ul className="dropout-dashboard__detailList">
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'Unavailable';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function StatusSummarySection({ title, status, summary, emptyLabel }) {
  if (!summary) {
    return (
      <div className="dropout-dashboard__detailSection">
        <strong>{title}</strong>
        <div className="section-note">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="dropout-dashboard__detailSection">
      <div className="dropout-dashboard__statusHeader">
        <strong>{title}</strong>
        <span className={`dropout-dashboard__statusBadge dropout-dashboard__statusBadge--${String(status || 'unavailable').toLowerCase()}`}>
          {formatStatusLabel(status)}
        </span>
      </div>
      <div className="section-note section-note--dense">{summary}</div>
    </div>
  );
}

function buildLegacyRiskReductionHints(snapshot = null) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const signals = Array.isArray(safeSnapshot.explanation_signals) ? safeSnapshot.explanation_signals : [];
  const missingInputs = Array.isArray(safeSnapshot.missing_inputs_summary) ? safeSnapshot.missing_inputs_summary : [];
  const flags = Array.isArray(safeSnapshot.data_quality_flags)
    ? safeSnapshot.data_quality_flags.map((entry) => String(entry || '').toLowerCase())
    : [];
  const hints = [];

  if (signals.some((entry) => String(entry?.signal || '').toLowerCase() === 'days_since_last_any_activity')) {
    hints.push('A fresh patient check-in would give the model a stronger recent engagement signal.');
  }
  if (signals.some((entry) => String(entry?.signal || '').toLowerCase() === 'days_since_last_vitals')) {
    hints.push('A new vitals submission would reduce uncertainty around recent patient engagement.');
  }
  if (
    signals.some((entry) => {
      const signalName = String(entry?.signal || '').toLowerCase();
      return signalName === 'epro_status_current' || signalName === 'crc_followup_unanswered_72h';
    }) ||
    missingInputs.some((entry) => /questionnaire|epro|reply latency/i.test(String(entry || '')))
  ) {
    hints.push('Closing the next questionnaire or CRC follow-up loop would improve the recent engagement evidence.');
  }
  if (missingInputs.some((entry) => /appointment/i.test(String(entry || '')))) {
    hints.push('Documented appointment attendance or follow-up completion would give the model a clearer operational signal.');
  }
  if (flags.includes('reduced_input_mode') && !hints.length) {
    hints.push('Filling the missing upstream engagement sources would make the next disengagement summary more actionable.');
  }
  if (!hints.length) {
    hints.push('The next completed patient touchpoint would give the model a stronger recent engagement signal.');
  }

  return Array.from(new Set(hints)).slice(0, 3);
}

function buildLegacyConfidenceAndStability(snapshot = null) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const flags = Array.isArray(safeSnapshot.data_quality_flags)
    ? safeSnapshot.data_quality_flags.map((entry) => String(entry || '').toLowerCase())
    : [];
  if (flags.includes('confidence_high')) {
    return {
      status: 'high',
      summary: 'Recent history coverage is strong enough for a stable, readable CRC disengagement summary.',
    };
  }
  if (
    flags.includes('confidence_medium') ||
    flags.includes('confidence_limited') ||
    flags.includes('reduced_input_mode') ||
    flags.includes('insufficient_history_no_score') ||
    flags.includes('stage_model_operational_fallback')
  ) {
    return {
      status: 'limited',
      summary:
        'This snapshot is directionally useful, but confidence is limited because recent history or upstream engagement coverage is incomplete.',
    };
  }
  return {
    status: 'unavailable',
    summary: '',
  };
}

export default function DropoutRiskPanel({
  patients = [],
  onOpenStudyCoordination,
  onOpenPatients,
}) {
  const [snapshotRows, setSnapshotRows] = useState([]);
  const [fallbackSnapshotRows, setFallbackSnapshotRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryReady, setSummaryReady] = useState(false);
  const [snapshotPageSize, setSnapshotPageSize] = useState(DEFAULT_DROPOUT_PAGE_SIZE);
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [activeExplainability, setActiveExplainability] = useState(null);
  const [activeExplainabilityReady, setActiveExplainabilityReady] = useState(false);

  const loadedUserIds = useMemo(() => patients.map((patient) => patient.id).filter(Boolean), [patients]);
  const loadedUserSignature = useMemo(() => loadedUserIds.join('|'), [loadedUserIds]);

  useEffect(() => {
    return subscribeToDropoutPredictionSnapshotsForUsers(
      loadedUserIds,
      (rows) => {
        setSnapshotRows(rows);
        setError('');
      },
      (nextError) => {
        setSnapshotRows([]);
        setError(nextError.message || 'Unable to read current disengagement snapshots.');
      }
    );
  }, [loadedUserIds, loadedUserSignature]);

  const joinedRows = useMemo(() => decorateSnapshotRows(snapshotRows, patients), [patients, snapshotRows]);

  useEffect(() => {
    if (joinedRows.length || error) {
      setFallbackSnapshotRows([]);
      return undefined;
    }

    return subscribeToAllDropoutPredictionSnapshots(
      (rows) => {
        setFallbackSnapshotRows(rows);
      },
      (nextError) => {
        console.error('Unable to load global disengagement fallback snapshots:', nextError);
        setFallbackSnapshotRows([]);
      },
      { limitCount: 60 }
    );
  }, [error, joinedRows.length]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardSummary() {
      try {
        const payload = await fetchDropoutDashboardSummary();
        if (!cancelled) {
          setSummary(payload);
        }
      } catch (loadError) {
        console.error('Unable to load full disengagement dashboard summary:', loadError);
        if (!cancelled) {
          setSummary(null);
        }
      } finally {
        if (!cancelled) {
          setSummaryReady(true);
        }
      }
    }

    loadDashboardSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const fallbackJoinedRows = useMemo(() => decorateSnapshotRows(fallbackSnapshotRows, patients), [fallbackSnapshotRows, patients]);
  const isUsingFallbackRows = !joinedRows.length && fallbackJoinedRows.length > 0;
  const visibleSourceRows = isUsingFallbackRows ? fallbackJoinedRows : joinedRows;
  const hasPublishedSnapshotData = Boolean(summary) || visibleSourceRows.length > 0;

  const filteredRows = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    if (!queryText) return visibleSourceRows;

    return visibleSourceRows.filter((entry) => {
      const haystack = [entry.patientName, entry.subjectId, entry.patientEmail]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(queryText);
    });
  }, [searchQuery, visibleSourceRows]);

  const totalLoadedPages = Math.max(1, Math.ceil(filteredRows.length / snapshotPageSize));
  const effectiveSnapshotPage = Math.min(snapshotPage, totalLoadedPages);
  const visibleRows = filteredRows.slice(
    (effectiveSnapshotPage - 1) * snapshotPageSize,
    effectiveSnapshotPage * snapshotPageSize
  );
  const canGoToNextSnapshotPage = filteredRows.length > effectiveSnapshotPage * snapshotPageSize;

  const activeEntry = useMemo(
    () => visibleRows.find((entry) => entry.userId === selectedUserId) || visibleRows[0] || filteredRows[0] || null,
    [filteredRows, selectedUserId, visibleRows]
  );

  useEffect(() => {
    if (!activeEntry?.userId) {
      setActiveExplainability(null);
      setActiveExplainabilityReady(false);
      return undefined;
    }

    setActiveExplainabilityReady(false);
    return subscribeToDropoutPredictionExplainability(
      activeEntry.userId,
      (payload) => {
        setActiveExplainability(payload);
        setActiveExplainabilityReady(true);
      },
      (nextError) => {
        console.error('Unable to load disengagement explainability mirror:', nextError);
        setActiveExplainability(null);
        setActiveExplainabilityReady(true);
      }
    );
  }, [activeEntry?.userId]);

  const dashboardMetrics = useMemo(
    () => ({
      scoredCount: Number.isFinite(Number(summary?.scored_count)) ? Number(summary.scored_count) : null,
      highRiskCount: Number.isFinite(Number(summary?.high_risk_count)) ? Number(summary.high_risk_count) : null,
      actionableCount: Number.isFinite(Number(summary?.actionable_count)) ? Number(summary.actionable_count) : null,
      averageProbability: getProbabilityNumber(summary?.average_probability),
      publishedAt: summary?.published_at || '',
    }),
    [summary]
  );

  const explainabilityWhyFlagged = useMemo(() => {
    const mirrorItems = buildSignalLines(activeExplainability?.why_flagged);
    if (mirrorItems.length) return mirrorItems;
    return buildLegacyWhyFlaggedLines(activeEntry);
  }, [activeEntry, activeExplainability?.why_flagged]);
  const explainabilityMissingInputs = useMemo(() => {
    const mirrorItems = buildSignalLines(activeExplainability?.missing_or_weak_inputs);
    if (mirrorItems.length) return mirrorItems;
    return buildLegacyMissingInputLines(activeEntry);
  }, [activeEntry, activeExplainability?.missing_or_weak_inputs]);
  const explainabilityRiskReduction = useMemo(() => {
    const mirrorItems = buildSignalLines(activeExplainability?.what_could_reduce_risk);
    if (mirrorItems.length) return mirrorItems;
    return buildLegacyRiskReductionHints(activeEntry);
  }, [activeEntry, activeExplainability?.what_could_reduce_risk]);
  const explainabilityModelAgreement = useMemo(() => {
    const payload = activeExplainability?.model_agreement;
    if (payload && typeof payload === 'object') {
      return {
        status: payload.status || 'unavailable',
        summary: String(payload.summary || '').trim(),
      };
    }
    return {
      status: 'unavailable',
      summary: '',
    };
  }, [activeExplainability?.model_agreement]);
  const explainabilityConfidence = useMemo(() => {
    const payload = activeExplainability?.confidence_and_stability;
    if (payload && typeof payload === 'object') {
      return {
        status: payload.status || 'unavailable',
        summary: String(payload.summary || '').trim(),
      };
    }
    return buildLegacyConfidenceAndStability(activeEntry);
  }, [activeEntry, activeExplainability?.confidence_and_stability]);
  const hasAnyExplainability = Boolean(
    explainabilityWhyFlagged.length ||
      explainabilityMissingInputs.length ||
      explainabilityRiskReduction.length ||
      explainabilityModelAgreement.summary ||
      explainabilityConfidence.summary
  );
  const legacyExplanationSignals = useMemo(
    () => buildLegacyWhyFlaggedLines(activeEntry),
    [activeEntry]
  );
  const legacyMissingInputs = useMemo(
    () => buildLegacyMissingInputLines(activeEntry),
    [activeEntry]
  );
  const legacyDataQualityFlags = useMemo(() => {
    const flags = Array.isArray(activeEntry?.data_quality_flags) ? activeEntry.data_quality_flags : [];
    return flags
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }, [activeEntry?.data_quality_flags]);

  const openStudyCoordination = () => {
    if (activeEntry?.patient && typeof onOpenStudyCoordination === 'function') {
      onOpenStudyCoordination(activeEntry.patient);
    }
  };

  const openPatientRoster = () => {
    if (activeEntry?.patient && typeof onOpenPatients === 'function') {
      onOpenPatients(activeEntry.patient);
    }
  };

  const content = (() => {
    if (error) {
      return (
        <div className="empty-panel">
          Disengagement snapshots are temporarily unavailable.
          <div className="section-note section-note--spaced">
            CRC review will resume when the next published snapshot can be read successfully.
          </div>
        </div>
      );
    }

    if (summaryReady && !hasPublishedSnapshotData) {
      return (
        <div className="empty-panel">
          No published disengagement snapshot is available yet.
          <div className="section-note section-note--spaced">
            The daily precompute workflow has not published a current snapshot for CRC review.
          </div>
        </div>
      );
    }

    return (
      <>
        {summary ? (
          <div className="dropout-dashboard__metrics">
            <MetricCard label="Scored patients" value={dashboardMetrics.scoredCount ?? 'N/A'} />
            <MetricCard label="High-risk patients" value={dashboardMetrics.highRiskCount ?? 'N/A'} tone="warning" />
            <MetricCard label="Actionable patients" value={dashboardMetrics.actionableCount ?? 'N/A'} tone="brand" />
            <MetricCard
              label="Average risk"
              value={
                dashboardMetrics.averageProbability == null
                  ? 'N/A'
                  : formatProbabilityPercent(dashboardMetrics.averageProbability)
              }
            />
          </div>
        ) : null}

        <div className="section-note section-note--spaced">
          {summary
            ? `Summary cards reflect the latest published full disengagement dashboard summary${
                dashboardMetrics.publishedAt
                  ? ` from ${new Date(dashboardMetrics.publishedAt).toLocaleString()}`
                  : ''
              }. ${
                isUsingFallbackRows
                  ? 'The ranked list below is temporarily showing the latest available current-snapshot rows while the loaded patient window catches up.'
                  : 'The ranked list below remains paginated from the currently loaded patient window.'
              }`
            : summaryReady
              ? `No published disengagement summary is available yet. ${
                  isUsingFallbackRows
                    ? 'The ranked list below is temporarily showing the latest available current-snapshot rows while the dashboard summary is still missing.'
                    : 'This workspace will stay empty until the next published snapshot is available.'
                }`
              : 'Loading the latest published disengagement dashboard summary...'}
        </div>

        <div className="dropout-dashboard__layout">
          <div className="dropout-dashboard__listCard">
            <div className="section-header section-header--tight">
              <div>
                <h3 className="mt-0">Risk-ranked patients</h3>
                <div className="section-note">
                  Search by patient name, subject ID, or email. Results stay sorted from highest to lowest risk inside the current loaded snapshot feed.
                </div>
                <div className="section-note section-note--spaced">
                  Showing {visibleRows.length} visible patients from {filteredRows.length} loaded current snapshots. Full summary cards above are sourced separately from the latest published disengagement summary.
                </div>
              </div>
              <div className="dropout-dashboard__detailActions">
                <span className="metric-pill">{filteredRows.length} loaded</span>
              </div>
            </div>

            <input
              type="text"
              className="dropout-dashboard__search"
              placeholder="Search patient name, subject ID, or email"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSnapshotPage(1);
              }}
            />

            <WindowPaginationControls
              page={effectiveSnapshotPage}
              pageSize={snapshotPageSize}
              onPageChange={setSnapshotPage}
              onPageSizeChange={(value) => {
                setSnapshotPageSize(value);
                setSnapshotPage(1);
              }}
              canGoNext={canGoToNextSnapshotPage}
              note={`Page ${effectiveSnapshotPage} - Showing up to ${snapshotPageSize} ranked patients from the loaded disengagement snapshot window.`}
            />

            <div className="dropout-dashboard__list">
              {visibleRows.length ? (
                visibleRows.map((entry) => {
                  const isSelected = entry.userId === activeEntry?.userId;
                  return (
                    <button
                      key={entry.userId}
                      type="button"
                      className={`dropout-dashboard__row ${isSelected ? 'dropout-dashboard__row--selected' : ''}`}
                      onClick={() => setSelectedUserId(entry.userId)}
                    >
                      <div className="dropout-dashboard__rowTop">
                        <div>
                          <div className="dropout-dashboard__patientName">{entry.patientName}</div>
                          <div className="dropout-dashboard__rowMeta">{entry.patientEmail || 'No email recorded'}</div>
                        </div>
                        <span className="dropout-card__bucket">{renderSnapshotStateLabel(entry)}</span>
                      </div>

                      <div className="dropout-dashboard__rowStats">
                        <span>Subject ID: {entry.subjectId}</span>
                        <span>Risk: {formatSnapshotProbabilityPercent(entry)}</span>
                      </div>

                      <div className="dropout-dashboard__rowStats">
                        <span>Confidence: {getConfidenceLabel(entry.data_quality_flags)}</span>
                        <span>Action: {formatRecommendedAction(entry)}</span>
                      </div>

                      <div className="dropout-dashboard__rowStats">
                        <span>{entry.published_at ? new Date(entry.published_at).toLocaleString() : 'Not published'}</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="empty-panel">
                  {visibleSourceRows.length
                    ? 'No patients match the current search.'
                    : 'No current disengagement snapshots are mirrored into Firestore for this CRC workspace yet.'}
                </div>
              )}
            </div>
          </div>

          <div className="dropout-dashboard__detailCard">
            {activeEntry ? (
              <>
                <div className="section-header">
                  <div>
                    <h3 className="mt-0">Patient disengagement detail</h3>
                    <div className="section-note">
                      Detailed CRC-only snapshot for the selected patient. This panel updates immediately when you select a different row.
                    </div>
                  </div>
                  <div className="dropout-dashboard__detailActions">
                    <button className="btn btn-secondary btn-small" onClick={openPatientRoster} disabled={!activeEntry.patient}>
                      Open Patients
                    </button>
                    <button className="btn btn-primary btn-small" onClick={openStudyCoordination} disabled={!activeEntry.patient}>
                      Open Study Coordination
                    </button>
                  </div>
                </div>

                <div className="dropout-dashboard__detailSummary">
                  <div className="dropout-card">
                    <div className="dropout-card__header">
                      <strong>{activeEntry.patientName}</strong>
                      <span className="dropout-card__bucket">{renderSnapshotStateLabel(activeEntry)}</span>
                    </div>
                    <div className="dropout-card__metric">Subject ID: {activeEntry.subjectId}</div>
                    <div className="dropout-card__metric">Risk probability: {formatSnapshotProbabilityDecimal(activeEntry)}</div>
                    <div className="dropout-card__metric">Confidence: {getConfidenceLabel(activeEntry.data_quality_flags)}</div>
                    <div className="dropout-card__metric">Recommended action: {formatRecommendedAction(activeEntry)}</div>
                    <div className="dropout-card__metric">Action priority score: {activeEntry.action_priority_score ?? 'N/A'}</div>
                    <div className="dropout-card__metric">Primary CRC: {activeEntry.primaryCrcName}</div>
                    <div className="dropout-card__metric">
                      Last published: {activeEntry.published_at ? new Date(activeEntry.published_at).toLocaleString() : 'N/A'}
                    </div>
                  </div>

                  <div className="dropout-card dropout-card--soft">
                    <strong>Model contract</strong>
                    <div className="dropout-card__metric">Stage: {activeEntry.routed_stage || 'N/A'}</div>
                    <div className="dropout-card__metric">Prediction horizon: {activeEntry.pred_horizon_days || 'N/A'} days</div>
                    <div className="dropout-card__metric">History window: {activeEntry.history_window_days || 'N/A'} days</div>
                    <div className="dropout-card__metric">Model version: {activeEntry.model_version || 'N/A'}</div>
                  </div>
                </div>

                {isEarlyHistorySnapshot(activeEntry) ? (
                  <div className="info-banner section-note--spaced">{buildEarlyHistorySummary(activeEntry)}</div>
                ) : null}

                <DetailSection
                  title="Explanation signals"
                  items={legacyExplanationSignals}
                  emptyLabel="No explanation signals were included in the current snapshot."
                />
                <DetailSection
                  title="Missing inputs summary"
                  items={legacyMissingInputs}
                  emptyLabel="No missing-input issues were reported for the current snapshot."
                />
                <DetailSection
                  title="Data quality flags"
                  items={legacyDataQualityFlags}
                  emptyLabel="No data-quality flags were reported for the current snapshot."
                />

                <div className="section-header section-header--tight section-header--spaced">
                  <div>
                    <h3 className="mt-0">Explainability summary</h3>
                    <div className="section-note">
                      CRC-facing summary generated from the published disengagement snapshot. This panel prefers the dedicated explainability mirror and falls back to the legacy snapshot fields when needed.
                    </div>
                  </div>
                </div>

                {hasAnyExplainability ? (
                  <div className="dropout-dashboard__explainabilityGrid">
                    <DetailSection
                      title="Why this patient is flagged"
                      items={explainabilityWhyFlagged}
                      emptyLabel="No readable explanation bullets were published for this patient yet."
                    />
                    <DetailSection
                      title="Data gaps affecting confidence"
                      items={explainabilityMissingInputs}
                      emptyLabel="No major data gaps were published for this patient yet."
                    />
                    <DetailSection
                      title="What might reduce disengagement risk"
                      items={explainabilityRiskReduction}
                      emptyLabel="No next-action explanation summary was published for this patient yet."
                    />
                    <StatusSummarySection
                      title="Model agreement"
                      status={explainabilityModelAgreement.status}
                      summary={explainabilityModelAgreement.summary}
                      emptyLabel="Model agreement is not available for this published snapshot yet."
                    />
                    <StatusSummarySection
                      title="Confidence and stability"
                      status={explainabilityConfidence.status}
                      summary={explainabilityConfidence.summary}
                      emptyLabel="Confidence and stability are not available for this published snapshot yet."
                    />
                  </div>
                ) : activeExplainabilityReady ? (
                  <div className="empty-panel">
                    Explainability summary is not available for this published snapshot yet.
                    <div className="section-note section-note--spaced">
                      This patient still has a disengagement score, but the readable explanation summary has not been published.
                    </div>
                  </div>
                ) : (
                  <div className="empty-panel">
                    Loading explainability summary...
                  </div>
                )}
              </>
            ) : (
              <div className="empty-panel">Select a ranked patient to inspect the current disengagement snapshot.</div>
            )}
          </div>
        </div>
      </>
    );
  })();

  return (
    <div className="card workspace-card intelligence-card intelligence-card--dropout">
      <div className="section-header">
        <div>
          <h3 className="mt-0">Patient Disengagement Prediction</h3>
          <div className="section-note">
            Dedicated CRC-only workspace sourced from live Firestore snapshots. Published summaries appear when available, and ranked rows stay paginated inside the loaded patient window.
          </div>
        </div>
        <span className="metric-pill">CRC only</span>
      </div>
      {content}
    </div>
  );
}
