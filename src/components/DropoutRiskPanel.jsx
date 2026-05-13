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
          return label ? `${label}: ${signalValue}` : '';
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

function buildSourceErrorLines(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .map(([sourceName, errorValue]) => {
      const message =
        typeof errorValue === 'string'
          ? errorValue
          : errorValue?.message || errorValue?.detail || 'read failed';
      return `${sourceName}: ${message}`;
    })
    .filter(Boolean);
}

function formatMirrorStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'missing';
  if (normalized === 'not_published_in_current_workflow_scope') {
    return 'not published in current workflow scope';
  }
  return normalized.replace(/_/g, ' ');
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
      ? `Legacy snapshot signal: recent engagement activity around day ${dayIndex} was highlighted in the published score payload.`
      : 'Legacy snapshot signal: recent engagement activity was highlighted in the published score payload.';
  }
  if (signalName === 'days_since_last_any_activity' && hasNumericValue) {
    const rounded = Math.round(signalValue);
    return `Legacy snapshot signal: no recent patient activity was recorded for about ${rounded} day${rounded === 1 ? '' : 's'}.`;
  }
  if (signalName === 'days_since_last_vitals' && hasNumericValue) {
    const rounded = Math.round(signalValue);
    return `Legacy snapshot signal: no fresh vitals were logged for about ${rounded} day${rounded === 1 ? '' : 's'}.`;
  }
  if (signalName === 'epro_status_current') {
    return 'Legacy snapshot signal: the current questionnaire response status was included in the published score payload.';
  }
  if (signalName === 'crc_followup_unanswered_72h') {
    return 'Legacy snapshot signal: an unanswered CRC follow-up thread was included in the published score payload.';
  }
  if (signalName === 'ctcae_grade_max_14d' && hasNumericValue) {
    return `Legacy snapshot signal: recent side-effect burden was included in the published score payload (max CTCAE signal ${signalValue.toFixed(1)}).`;
  }
  if (signalName === 'pain_score_mean_7d' && hasNumericValue) {
    return `Legacy snapshot signal: recent pain burden over the last 7 days was included in the published score payload (mean score ${signalValue.toFixed(1)}).`;
  }
  if (signalName === 'anxiety_score_mean_7d' && hasNumericValue) {
    return `Legacy snapshot signal: recent anxiety burden over the last 7 days was included in the published score payload (mean score ${signalValue.toFixed(1)}).`;
  }

  const fallbackLabel = signalName ? signalName.replace(/_/g, ' ') : 'model signal';
  if (hasNumericValue) {
    return `Legacy snapshot signal: ${fallbackLabel} = ${signalValue.toFixed(2)}.`;
  }
  return `Legacy snapshot signal: ${fallbackLabel}.`;
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
    return [`Legacy snapshot bucket: ${bucket} at ${(probability * 100).toFixed(1)}%.`];
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
    .map((entry) => `Legacy snapshot input gap: ${entry}.`);

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
  const [activeExplainabilityUserId, setActiveExplainabilityUserId] = useState('');

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
      setActiveExplainabilityUserId('');
      return undefined;
    }

    setActiveExplainability(null);
    setActiveExplainabilityReady(false);
    setActiveExplainabilityUserId(activeEntry.userId);
    return subscribeToDropoutPredictionExplainability(
      activeEntry.userId,
      (payload) => {
        setActiveExplainability(payload);
        setActiveExplainabilityUserId(activeEntry.userId);
        setActiveExplainabilityReady(true);
      },
      (nextError) => {
        console.error('Unable to load disengagement explainability mirror:', nextError);
        setActiveExplainability(null);
        setActiveExplainabilityUserId(activeEntry.userId);
        setActiveExplainabilityReady(true);
      }
    );
  }, [activeEntry?.userId]);

  const activeExplainabilityPayload = useMemo(() => {
    if (!activeExplainabilityReady) return null;
    if (!activeEntry?.userId) return null;
    if (activeExplainabilityUserId !== activeEntry.userId) return null;
    return activeExplainability;
  }, [activeEntry?.userId, activeExplainability, activeExplainabilityReady, activeExplainabilityUserId]);

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
    return buildSignalLines(activeExplainabilityPayload?.why_flagged);
  }, [activeExplainabilityPayload?.why_flagged]);
  const explainabilityMissingInputs = useMemo(() => {
    return buildSignalLines(activeExplainabilityPayload?.missing_or_weak_inputs);
  }, [activeExplainabilityPayload?.missing_or_weak_inputs]);
  const explainabilityRiskReduction = useMemo(() => {
    return buildSignalLines(activeExplainabilityPayload?.what_could_reduce_risk);
  }, [activeExplainabilityPayload?.what_could_reduce_risk]);
  const explainabilityModelAgreement = useMemo(() => {
    const payload = activeExplainabilityPayload?.model_agreement;
    if (payload && typeof payload === 'object') {
      return {
        status: payload.status || 'unavailable',
        summary: String(payload.summary || '').trim(),
      };
    }
    return {
      status: activeExplainabilityPayload ? 'not_published_in_current_workflow_scope' : 'unavailable',
      summary: activeExplainabilityPayload
        ? 'Model agreement is not published in this workflow scope.'
        : '',
    };
  }, [activeExplainabilityPayload, activeExplainabilityPayload?.model_agreement]);
  const explainabilityConfidence = useMemo(() => {
    const payload = activeExplainabilityPayload?.confidence_and_stability;
    if (payload && typeof payload === 'object') {
      return {
        status: payload.status || 'unavailable',
        summary: String(payload.summary || '').trim(),
      };
    }
    return {
      status: activeExplainabilityPayload ? 'not_published' : 'unavailable',
      summary: activeExplainabilityPayload
        ? 'Confidence and stability are not published in this workflow scope.'
        : '',
    };
  }, [activeExplainabilityPayload, activeExplainabilityPayload?.confidence_and_stability]);
  const explainabilityBlockedReasons = useMemo(
    () => buildSignalLines(activeExplainabilityPayload?.blocked_reasons),
    [activeExplainabilityPayload?.blocked_reasons]
  );
  const explainabilityMissingRequiredSections = useMemo(
    () => buildSignalLines(activeExplainabilityPayload?.missing_required_sections),
    [activeExplainabilityPayload?.missing_required_sections]
  );
  const explainabilitySourceErrors = useMemo(
    () => buildSourceErrorLines(activeExplainabilityPayload?.source_errors),
    [activeExplainabilityPayload?.source_errors]
  );
  const mirrorStatusLabel = activeExplainabilityPayload
    ? formatMirrorStatus(activeExplainabilityPayload.mirror_status || 'unknown')
    : '';
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
  const loadedRowsLabel = isUsingFallbackRows
    ? `${filteredRows.length} fallback rows`
    : `${filteredRows.length} loaded`;
  const visibleRowsSummary = isUsingFallbackRows
    ? `Showing ${visibleRows.length} visible patients from ${filteredRows.length} loaded global fallback snapshot rows. The latest published snapshot pool is being used because the current patient window has not mirrored rows yet.`
    : `Showing ${visibleRows.length} visible patients from ${filteredRows.length} loaded current snapshots. Full summary cards above are sourced separately from the latest published disengagement summary.`;
  const paginationNote = isUsingFallbackRows
    ? `Page ${effectiveSnapshotPage} - Showing up to ${snapshotPageSize} global fallback snapshot rows from the latest published snapshot pool.`
    : `Page ${effectiveSnapshotPage} - Showing up to ${snapshotPageSize} ranked patients from the loaded disengagement snapshot window.`;

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
                  {visibleRowsSummary}
                </div>
              </div>
              <div className="dropout-dashboard__detailActions">
                <span className="metric-pill">{loadedRowsLabel}</span>
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
              note={paginationNote}
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
                  title="Legacy snapshot signals"
                  items={legacyExplanationSignals}
                  emptyLabel="No legacy explanation signals were included in the current snapshot payload."
                />
                <DetailSection
                  title="Legacy snapshot input gaps"
                  items={legacyMissingInputs}
                  emptyLabel="No legacy missing-input issues were reported for the current snapshot."
                />
                <DetailSection
                  title="Legacy snapshot data-quality flags"
                  items={legacyDataQualityFlags}
                  emptyLabel="No legacy data-quality flags were reported for the current snapshot."
                />

                <div className="section-header section-header--tight section-header--spaced">
                  <div>
                    <h3 className="mt-0">Explainability summary</h3>
                    <div className="section-note">
                      CRC-facing summary from the dedicated explainability mirror. Legacy current-snapshot fields are shown above as operational context only.
                    </div>
                  </div>
                </div>

                {activeExplainabilityPayload ? (
                  <>
                    <div className="info-banner section-note--spaced">
                      Explainability mirror status: <strong>{mirrorStatusLabel}</strong>
                      {explainabilityBlockedReasons.length ? (
                        <div className="section-note section-note--dense">
                          Blocked or partial reason: {explainabilityBlockedReasons.join('; ')}
                        </div>
                      ) : null}
                    </div>
                    <div className="dropout-dashboard__explainabilityGrid">
                      <DetailSection
                        title="Why this patient is flagged"
                        items={explainabilityWhyFlagged}
                        emptyLabel="Why flagged: missing"
                      />
                      <DetailSection
                        title="Data gaps affecting confidence"
                        items={explainabilityMissingInputs}
                        emptyLabel="Missing or weak inputs: missing"
                      />
                      <DetailSection
                        title="What might reduce disengagement risk"
                        items={explainabilityRiskReduction}
                        emptyLabel="What could reduce risk: missing"
                      />
                      <StatusSummarySection
                        title="Model agreement"
                        status={explainabilityModelAgreement.status}
                        summary={explainabilityModelAgreement.summary}
                        emptyLabel="Model agreement: not published in this workflow scope"
                      />
                      <StatusSummarySection
                        title="Confidence and stability"
                        status={explainabilityConfidence.status}
                        summary={explainabilityConfidence.summary}
                        emptyLabel="Confidence and stability: limited / not published"
                      />
                      <DetailSection
                        title="Missing mirror sections"
                        items={explainabilityMissingRequiredSections}
                        emptyLabel="No required mirror sections are missing."
                      />
                      <DetailSection
                        title="Live source read errors"
                        items={explainabilitySourceErrors}
                        emptyLabel="No live source read errors were reported for this mirror."
                      />
                    </div>
                  </>
                ) : activeExplainabilityReady && activeExplainabilityUserId === activeEntry?.userId ? (
                  <div className="empty-panel">
                    Explainability mirror has not been published for this patient.
                    <div className="section-note section-note--spaced">
                      The current prediction snapshot can still be shown above, but CRC should not treat legacy snapshot fields as a dedicated explainability mirror.
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
