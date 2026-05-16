import React, { useEffect, useMemo, useState } from 'react';
import WindowPaginationControls from './WindowPaginationControls';
import {
  buildDropoutInterventionPredictionSignature,
  closeDropoutInterventionCase,
  findActiveDropoutInterventionCase,
  fetchDropoutDashboardSummary,
  getDropoutInterventionProxyStatus,
  isDropoutInterventionCaseOpen,
  subscribeToAllDropoutPredictionSnapshots,
  subscribeToDropoutPredictionExplainability,
  subscribeToRecentDropoutPredictionHistory,
  subscribeToDropoutPredictionSnapshotsForUsers,
  subscribeToRecentDropoutInterventionCases,
  updateActiveDropoutInterventionCase,
} from '../services/dropoutService';

const DEFAULT_DROPOUT_PAGE_SIZE = 30;
const RECENT_PUBLISH_HISTORY_LIMIT = 7;
const RECENT_INTERVENTION_CASE_LIMIT = 6;
const INTERVENTION_ACTION_BUTTONS = [
  { value: 'outreach_attempted', label: 'Outreach attempted' },
  { value: 'monitor_only', label: 'Monitor only' },
];
const INTERVENTION_RESULT_BUTTONS = [
  { value: 'no_response_yet', label: 'No response yet' },
  { value: 'responded', label: 'Responded' },
];
const READ_ONLY_INTERVENTION_STATUSES = [
  'window_open',
  'reengaged_observed',
  'no_reengagement_observed',
  'source_incomplete',
];

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

function formatDateTimeValue(value, emptyLabel = 'N/A') {
  if (!value) return emptyLabel;
  const nextValue = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(nextValue.getTime()) ? emptyLabel : nextValue.toLocaleString();
}

function formatWorkflowValueLabel(value, emptyLabel = 'Not recorded') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return emptyLabel;
  return normalized
    .split('_')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

export function formatInterventionProxyStatusLabel(value, emptyLabel = 'Observation window still open') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return emptyLabel;
  if (normalized === 'window_open') return 'Observation window open';
  if (normalized === 'reengaged_observed') return 'Re-engagement observed';
  if (normalized === 'no_reengagement_observed') return 'No re-engagement observed';
  if (normalized === 'source_incomplete') return 'Source data incomplete';
  return formatWorkflowValueLabel(normalized, emptyLabel);
}

export function formatInterventionCloseReasonLabel(value, emptyLabel = 'Not recorded') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return emptyLabel;
  if (normalized === 'auto_reengaged') {
    return 'Closed automatically after re-engagement was observed';
  }
  if (normalized === 'manual_crc_close') {
    return 'Closed manually by CRC';
  }
  return formatWorkflowValueLabel(normalized, emptyLabel);
}

function hasUsableSnapshotForInterventionCase(snapshot = {}) {
  return Boolean(
    String(snapshot?.published_at || '').trim() ||
      String(snapshot?.risk_bucket || '').trim() ||
      getProbabilityNumber(snapshot?.dropout_probability) != null
  );
}

function getInterventionCaseStatusTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'reengaged_observed') return 'success';
  if (normalized === 'window_open') return 'brand';
  if (normalized === 'no_reengagement_observed' || normalized === 'source_incomplete') return 'warning';
  return 'default';
}

function getInterventionLifecycleTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'open') return 'brand';
  if (normalized === 'closed') return 'default';
  return 'default';
}

function shouldAutoSyncInterventionCase(caseEntry = null, snapshot = {}, patient = null) {
  if (!hasUsableSnapshotForInterventionCase(snapshot)) {
    return false;
  }

  if (!caseEntry) {
    return isActionableSnapshot(snapshot);
  }

  return String(caseEntry.latest_prediction_signature || '') !== buildDropoutInterventionPredictionSignature(snapshot, patient);
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

const SOURCE_COMPLETENESS_LABELS = {
  incident_records: 'incident records',
  side_effect_reports: 'side-effect reports',
  patient_daily_logs: 'patient daily logs',
  epro_submissions: 'ePRO submissions',
  crc_followup_threads: 'CRC follow-up threads',
  appointments: 'appointments',
  vitals: 'vitals',
  epro_answer_summary: 'ePRO answer summary',
};

export function formatSourceCompletenessStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'optional_fallback_not_used' || normalized === 'optional_fallback') {
    return 'optional fallback';
  }
  if (normalized === 'timestamp_missing') {
    return 'timestamp missing';
  }
  return normalized.replace(/_/g, ' ');
}

function buildSourceCompletenessLines(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .map(([sourceName, status]) => {
      const label = SOURCE_COMPLETENESS_LABELS[sourceName] || sourceName.replace(/_/g, ' ');
      return `${label}: ${formatSourceCompletenessStatus(status)}`;
    })
    .filter(Boolean);
}

function formatRiskChangeDirectionLabel(direction) {
  const normalized = String(direction || '').trim().toLowerCase();
  if (!normalized) return 'No prior publish';
  if (normalized === 'higher') return 'Higher';
  if (normalized === 'lower') return 'Lower';
  if (normalized === 'stable') return 'Stable';
  return formatWorkflowValueLabel(normalized, 'No prior publish');
}

function getRiskChangeDirectionTone(direction) {
  const normalized = String(direction || '').trim().toLowerCase();
  if (normalized === 'higher') return 'warning';
  if (normalized === 'lower') return 'success';
  if (normalized === 'stable') return 'default';
  return 'default';
}

function formatRiskStateLabel(bucket, probability) {
  const bucketLabel = String(bucket || '').trim() ? renderRiskBucket(bucket) : 'Unknown';
  const probabilityValue = getProbabilityNumber(probability);
  if (probabilityValue == null) {
    return bucketLabel;
  }
  return `${bucketLabel} (${(probabilityValue * 100).toFixed(1)}%)`;
}

export function formatInterventionHistoryEntry(caseEntry = {}) {
  const statusLabel = formatWorkflowValueLabel(caseEntry?.status, 'No status');
  const proxyStatusLabel = formatInterventionProxyStatusLabel(
    getDropoutInterventionProxyStatus(caseEntry),
    'No automatic observation'
  );
  const closeReason = String(caseEntry?.close_reason || '').trim();
  const closeReasonLabel = closeReason ? formatInterventionCloseReasonLabel(closeReason) : '';
  const timestampLabel = formatDateTimeValue(caseEntry?.updated_at || caseEntry?.created_at, 'No timestamp');
  return [statusLabel, proxyStatusLabel, closeReasonLabel, timestampLabel].filter(Boolean).join(' / ');
}

export function buildChallengerCrossCheckItems(summary, drivers = [], whyFlagged = []) {
  const rows = [];
  const summaryText = String(summary || '').trim();
  if (summaryText) {
    rows.push(summaryText);
  }

  const whyFlaggedText = whyFlagged.map((entry) => String(entry || '').trim().toLowerCase()).join(' ');
  const distinctiveDrivers = (Array.isArray(drivers) ? drivers : []).filter((entry) => {
    const text = String(entry || '').trim();
    if (!text) return false;
    const lower = text.toLowerCase();
    if (
      lower.includes('narrower source mix') ||
      lower.includes('side-effect burden') ||
      lower.includes('self-reported burden') ||
      lower.includes('symptom') ||
      lower.includes('questionnaire')
    ) {
      return true;
    }
    return !whyFlaggedText || !(
      (lower.includes('engagement timing') && whyFlaggedText.includes('engagement activity')) ||
      (lower.includes('inactivity') && whyFlaggedText.includes('no recent patient activity')) ||
      (lower.includes('fresh vitals') && whyFlaggedText.includes('no fresh vitals')) ||
      (lower.includes('crc follow-up') && whyFlaggedText.includes('crc follow-up'))
    );
  });

  distinctiveDrivers.forEach((entry) => {
    if (!rows.includes(entry)) {
      rows.push(entry);
    }
  });

  if (!rows.length && whyFlagged.length) {
    rows.push('The challenger remains directionally aligned with the main disengagement drivers already highlighted above.');
  }

  return rows.slice(0, 3);
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

function RiskChangeSection({
  summary,
  direction,
  previousPublishedAt,
  previousRiskBucket,
  previousProbability,
  currentRiskBucket,
  currentProbability,
  reasons,
}) {
  if (!summary) {
    return (
      <div className="dropout-dashboard__detailSection">
        <div className="dropout-dashboard__statusHeader">
          <strong>Risk change since last publish</strong>
          <span className="metric-pill">No prior publish</span>
        </div>
        <div className="section-note">
          No earlier published snapshot is available yet, so risk change cannot be summarized here.
        </div>
      </div>
    );
  }

  return (
    <div className="dropout-dashboard__detailSection">
      <div className="dropout-dashboard__statusHeader">
        <strong>Risk change since last publish</strong>
        <span className={`metric-pill metric-pill--${getRiskChangeDirectionTone(direction)}`}>
          {formatRiskChangeDirectionLabel(direction)}
        </span>
      </div>
      <div className="section-note section-note--dense">{summary}</div>
      <div className="dropout-card__metric">Previous publish: {formatDateTimeValue(previousPublishedAt, 'No prior publish')}</div>
      <div className="dropout-card__metric">
        Previous risk: {formatRiskStateLabel(previousRiskBucket, previousProbability)}
      </div>
      <div className="dropout-card__metric">
        Current risk: {formatRiskStateLabel(currentRiskBucket, currentProbability)}
      </div>
      {reasons.length ? (
        <ul className="dropout-dashboard__detailList">
          {reasons.map((item) => (
            <li key={`risk-change-${item}`}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function getProbabilityDelta(currentValue, previousValue) {
  const currentProbability = getProbabilityNumber(currentValue);
  const previousProbability = getProbabilityNumber(previousValue);
  if (currentProbability == null || previousProbability == null) {
    return null;
  }
  return currentProbability - previousProbability;
}

function getTrendDirection(delta) {
  if (delta == null) return '';
  if (delta >= 0.03) return 'higher';
  if (delta <= -0.03) return 'lower';
  return 'stable';
}

function getRiskBucketTone(bucket) {
  const normalized = String(bucket || '').trim().toLowerCase();
  if (normalized === 'high') return '#cb5a3c';
  if (normalized === 'medium') return '#c98d36';
  if (normalized === 'low') return '#2468a2';
  if (normalized === 'insufficient_history') return '#7a8799';
  return '#8a98ac';
}

function formatRecentTrendDirectionLabel(direction) {
  if (direction === 'rising') return 'Rising';
  if (direction === 'falling') return 'Falling';
  if (direction === 'stable') return 'Stable';
  if (direction === 'mixed / volatile') return 'Mixed / volatile';
  return 'Building history';
}

function formatTrendDeltaLabel(delta) {
  if (delta == null) return 'No earlier comparison';
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${(delta * 100).toFixed(1)} pts vs prior publish`;
}

function buildTrendHeadline(trendDirection, currentCount) {
  if (trendDirection === 'rising') {
    return `Recent publishes are trending upward across the visible ${currentCount}-publish window.`;
  }
  if (trendDirection === 'falling') {
    return `Recent publishes are trending downward across the visible ${currentCount}-publish window.`;
  }
  if (trendDirection === 'stable') {
    return `Recent publishes are holding broadly steady across the visible ${currentCount}-publish window.`;
  }
  if (currentCount > 1) {
    return `Recent publishes are moving in both directions across the visible ${currentCount}-publish window.`;
  }
  return 'Only one published disengagement snapshot is available so far.';
}

function buildPublishIdentityKey(entry = {}) {
  return [
    String(entry?.published_at || '').trim().toLowerCase(),
    String(entry?.model_version || '').trim().toLowerCase(),
    String(getProbabilityNumber(entry?.dropout_probability) ?? '').trim().toLowerCase(),
    String(entry?.risk_bucket || '').trim().toLowerCase(),
    String(entry?.subject_id || entry?.subjectId || '').trim().toLowerCase(),
  ].join('|');
}

export function buildRecentPublishTrendData(rows = [], currentEntry = null) {
  const historyRows = Array.isArray(rows) ? rows : [];
  const currentIdentityKey = currentEntry ? buildPublishIdentityKey(currentEntry) : '';
  const dedupedHistoryRows = [];
  const seenHistoryKeys = new Set();
  [...historyRows]
    .sort((left, right) => new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime())
    .forEach((entry) => {
      const identityKey = buildPublishIdentityKey(entry);
      if (!identityKey || identityKey === currentIdentityKey || seenHistoryKeys.has(identityKey)) {
        return;
      }
      seenHistoryKeys.add(identityKey);
      dedupedHistoryRows.push(entry);
    });
  const timelineRows = dedupedHistoryRows.slice(0, Math.max(RECENT_PUBLISH_HISTORY_LIMIT - 1, 0));
  const visibleRows = currentEntry ? [currentEntry, ...timelineRows] : timelineRows;
  const chronologicalRows = [...visibleRows].sort(
    (left, right) => new Date(left.published_at || 0).getTime() - new Date(right.published_at || 0).getTime()
  );
  const sequentialDeltas = chronologicalRows
    .map((entry, index) => {
      if (index === 0) return null;
      return getProbabilityDelta(entry?.dropout_probability, chronologicalRows[index - 1]?.dropout_probability);
    })
    .filter((value) => value != null);
  const directionalSteps = sequentialDeltas.map((delta) => getTrendDirection(delta));
  const higherCount = directionalSteps.filter((entry) => entry === 'higher').length;
  const lowerCount = directionalSteps.filter((entry) => entry === 'lower').length;
  const netDelta =
    chronologicalRows.length >= 2
      ? getProbabilityDelta(
          chronologicalRows[chronologicalRows.length - 1]?.dropout_probability,
          chronologicalRows[0]?.dropout_probability
        )
      : null;
  let trendDirection = 'mixed / volatile';
  if (chronologicalRows.length < 2) {
    trendDirection = 'building';
  } else if (higherCount === 0 && lowerCount === 0) {
    trendDirection = 'stable';
  } else if (higherCount >= 2 && lowerCount === 0) {
    trendDirection = 'rising';
  } else if (lowerCount >= 2 && higherCount === 0) {
    trendDirection = 'falling';
  } else if (netDelta != null && netDelta >= 0.08 && higherCount > lowerCount) {
    trendDirection = 'rising';
  } else if (netDelta != null && netDelta <= -0.08 && lowerCount > higherCount) {
    trendDirection = 'falling';
  }
  const previousEntry = timelineRows[0] || null;
  const latestDelta = currentEntry ? getProbabilityDelta(currentEntry?.dropout_probability, previousEntry?.dropout_probability) : null;
  const latestDirection = getTrendDirection(latestDelta);
  const headline = buildTrendHeadline(trendDirection, visibleRows.length);
  let jumpSummary = '';
  if (latestDelta != null && Math.abs(latestDelta) >= 0.1) {
    jumpSummary =
      latestDelta > 0
        ? `The latest publish made a sharper upward step than the recent baseline (${formatTrendDeltaLabel(latestDelta)}).`
        : `The latest publish made a sharper downward step than the recent baseline (${formatTrendDeltaLabel(latestDelta)}).`;
  } else if (
    latestDirection &&
    previousEntry &&
    String(currentEntry?.risk_bucket || '').trim().toLowerCase() !== String(previousEntry?.risk_bucket || '').trim().toLowerCase()
  ) {
    jumpSummary = `The latest publish changed risk state versus the prior publish (${formatTrendDeltaLabel(latestDelta)}).`;
  }

  return {
    timelineRows,
    visibleRows,
    chronologicalRows,
    trendDirection,
    headline,
    jumpSummary,
    latestDelta,
  };
}

function RecentPublishTrendSection({ rows, currentEntry }) {
  const trendData = buildRecentPublishTrendData(rows, currentEntry);
  const { visibleRows, chronologicalRows, trendDirection, headline, jumpSummary } = trendData;

  if (!currentEntry) {
    return null;
  }

  const chartWidth = 360;
  const chartHeight = 92;
  const leftPadding = 16;
  const rightPadding = 12;
  const topPadding = 12;
  const bottomPadding = 14;
  const usableWidth = chartWidth - leftPadding - rightPadding;
  const usableHeight = chartHeight - topPadding - bottomPadding;
  const chartPoints = chronologicalRows.map((entry, index) => {
    const pointCount = Math.max(chronologicalRows.length - 1, 1);
    const x = leftPadding + (usableWidth * index) / pointCount;
    const probability = Math.max(0, Math.min(1, getProbabilityNumber(entry?.dropout_probability) ?? 0));
    const y = topPadding + (1 - probability) * usableHeight;
    return {
      x,
      y,
      probability,
      color: getRiskBucketTone(entry?.risk_bucket),
      isCurrent: entry === currentEntry,
      key: entry?.id || entry?.published_at || `point-${index}`,
    };
  });
  const polylinePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div className="dropout-card dropout-card--soft" style={{ marginTop: '18px' }}>
      <div className="dropout-card__header">
        <strong>Recent 7 publishes</strong>
        <span className="metric-pill">{visibleRows.length} visible</span>
      </div>
      <div className="section-note section-note--dense">
        {headline || 'This trend view will fill in as more published disengagement snapshots accumulate for this patient.'}
      </div>
      <div className="dropout-dashboard__statusHeader" style={{ marginTop: '10px' }}>
        <span
          className={`metric-pill metric-pill--${
            trendDirection === 'rising' ? 'warning' : trendDirection === 'falling' ? 'success' : 'default'
          }`}
        >
          {formatRecentTrendDirectionLabel(trendDirection)}
        </span>
        {jumpSummary ? <span className="section-note section-note--dense">{jumpSummary}</span> : null}
      </div>
      <div style={{ marginTop: '12px', border: '1px solid var(--border)', borderRadius: '18px', padding: '10px 12px', background: 'rgba(255,255,255,0.55)' }}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} width="100%" height="104" aria-label="Recent disengagement publish trend">
          <line x1={leftPadding} y1={topPadding} x2={chartWidth - rightPadding} y2={topPadding} stroke="rgba(40, 72, 104, 0.12)" strokeWidth="1" />
          <line x1={leftPadding} y1={chartHeight - bottomPadding} x2={chartWidth - rightPadding} y2={chartHeight - bottomPadding} stroke="rgba(40, 72, 104, 0.16)" strokeWidth="1" />
          {polylinePoints ? (
            <polyline
              fill="none"
              stroke="rgba(25, 79, 128, 0.42)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={polylinePoints}
            />
          ) : null}
          {chartPoints.map((point) => (
            <g key={point.key}>
              {point.isCurrent ? (
                <circle cx={point.x} cy={point.y} r="7.5" fill="rgba(36, 104, 162, 0.12)" stroke="none" />
              ) : null}
              <circle
                cx={point.x}
                cy={point.y}
                r={point.isCurrent ? 4.8 : 3.6}
                fill={point.color}
                stroke="#ffffff"
                strokeWidth={point.isCurrent ? 2 : 1.5}
              />
            </g>
          ))}
        </svg>
      </div>
      <div className="dropout-card__metric" style={{ marginTop: '10px' }}>
        Latest publish: {formatRiskStateLabel(currentEntry?.risk_bucket, currentEntry?.dropout_probability)}
      </div>
      <div className="dropout-card__metric">
        Latest action: {formatRecommendedAction(currentEntry)}
      </div>

      <div style={{ marginTop: '12px', display: 'grid', gap: '10px' }}>
        {visibleRows.map((entry, index, rowsWithCurrent) => {
          const previousEntry = rowsWithCurrent[index + 1] || null;
          const delta = previousEntry
            ? getProbabilityDelta(entry?.dropout_probability, previousEntry?.dropout_probability)
            : null;
          const direction = getTrendDirection(delta);
          return (
            <div
              key={`trend-${entry?.id || entry?.published_at || index}`}
              className="dropout-dashboard__detailSection"
              style={{ marginBottom: 0 }}
            >
              <div className="dropout-dashboard__statusHeader">
                <strong>{index === 0 ? 'Current publish' : `Previous publish ${index}`}</strong>
                <span className={`metric-pill metric-pill--${getRiskChangeDirectionTone(direction)}`}>
                  {direction ? formatRiskChangeDirectionLabel(direction) : 'Anchor'}
                </span>
              </div>
              <div className="dropout-card__metric">
                {formatDateTimeValue(entry?.published_at, 'Not published')}
              </div>
              <div className="dropout-card__metric">
                Risk: {formatRiskStateLabel(entry?.risk_bucket, entry?.dropout_probability)}
              </div>
              <div className="dropout-card__metric">
                Action: {formatRecommendedAction(entry)}
              </div>
              <div className="section-note section-note--dense">
                {formatTrendDeltaLabel(delta)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DropoutRiskPanel({
  patients = [],
  currentUser = null,
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
  const [recentPublishHistory, setRecentPublishHistory] = useState([]);
  const [recentPublishHistoryReady, setRecentPublishHistoryReady] = useState(false);
  const [recentPublishHistoryError, setRecentPublishHistoryError] = useState('');
  const [recentInterventionCases, setRecentInterventionCases] = useState([]);
  const [interventionCasesReady, setInterventionCasesReady] = useState(false);
  const [interventionCaseError, setInterventionCaseError] = useState('');
  const [isUpdatingInterventionCase, setIsUpdatingInterventionCase] = useState(false);
  const [interventionCaseMutationError, setInterventionCaseMutationError] = useState('');

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

  useEffect(() => {
    if (!activeEntry?.userId) {
      setRecentPublishHistory([]);
      setRecentPublishHistoryReady(false);
      setRecentPublishHistoryError('');
      return undefined;
    }

    setRecentPublishHistory([]);
    setRecentPublishHistoryReady(false);
    setRecentPublishHistoryError('');

    return subscribeToRecentDropoutPredictionHistory(
      activeEntry.userId,
      (rows) => {
        setRecentPublishHistory(rows);
        setRecentPublishHistoryReady(true);
        setRecentPublishHistoryError('');
      },
      (nextError) => {
        console.error('Unable to load recent disengagement publish history:', nextError);
        setRecentPublishHistory([]);
        setRecentPublishHistoryReady(true);
        setRecentPublishHistoryError(nextError.message || 'Unable to load recent publish history.');
      },
      { limitCount: Math.max(RECENT_PUBLISH_HISTORY_LIMIT - 1, 1) }
    );
  }, [activeEntry?.userId]);

  useEffect(() => {
    if (!activeEntry?.userId) {
      setRecentInterventionCases([]);
      setInterventionCasesReady(false);
      setInterventionCaseError('');
      setInterventionCaseMutationError('');
      return undefined;
    }

    setRecentInterventionCases([]);
    setInterventionCasesReady(false);
    setInterventionCaseError('');
    setInterventionCaseMutationError('');

    return subscribeToRecentDropoutInterventionCases(
      activeEntry.userId,
      (rows) => {
        setRecentInterventionCases(rows);
        setInterventionCasesReady(true);
        setInterventionCaseError('');
      },
      (nextError) => {
        console.error('Unable to load recent dropout intervention cases:', nextError);
        setRecentInterventionCases([]);
        setInterventionCasesReady(true);
        setInterventionCaseError(nextError.message || 'Unable to load recent intervention cases.');
      },
      { limitCount: RECENT_INTERVENTION_CASE_LIMIT }
    );
  }, [activeEntry?.userId]);

  const activeExplainabilityPayload = useMemo(() => {
    if (!activeExplainabilityReady) return null;
    if (!activeEntry?.userId) return null;
    if (activeExplainabilityUserId !== activeEntry.userId) return null;
    return activeExplainability;
  }, [activeEntry?.userId, activeExplainability, activeExplainabilityReady, activeExplainabilityUserId]);
  const activeInterventionCase = useMemo(
    () => findActiveDropoutInterventionCase(recentInterventionCases),
    [recentInterventionCases]
  );
  const displayedInterventionCase = useMemo(
    () => activeInterventionCase || recentInterventionCases[0] || null,
    [activeInterventionCase, recentInterventionCases]
  );
  const openInterventionCaseCount = useMemo(
    () => recentInterventionCases.filter((entry) => isDropoutInterventionCaseOpen(entry)).length,
    [recentInterventionCases]
  );
  const canUseInterventionCaseLoop = useMemo(
    () => Boolean(activeEntry?.userId && !isEarlyHistorySnapshot(activeEntry) && hasUsableSnapshotForInterventionCase(activeEntry)),
    [activeEntry]
  );
  const shouldAutoSyncActiveInterventionCase = useMemo(() => {
    if (!interventionCasesReady || interventionCaseError || !canUseInterventionCaseLoop) {
      return false;
    }

    return shouldAutoSyncInterventionCase(activeInterventionCase, activeEntry, activeEntry?.patient);
  }, [
    activeEntry,
    activeInterventionCase,
    canUseInterventionCaseLoop,
    interventionCaseError,
    interventionCasesReady,
  ]);

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
  const explainabilityChallengerDrivers = useMemo(() => {
    return buildSignalLines(activeExplainabilityPayload?.challenger_local_drivers);
  }, [activeExplainabilityPayload?.challenger_local_drivers]);
  const explainabilityChallengerSummary = useMemo(
    () => String(activeExplainabilityPayload?.challenger_local_summary || '').trim(),
    [activeExplainabilityPayload?.challenger_local_summary]
  );
  const explainabilityChallengerCrossCheck = useMemo(
    () =>
      buildChallengerCrossCheckItems(
        explainabilityChallengerSummary,
        explainabilityChallengerDrivers,
        explainabilityWhyFlagged
      ),
    [explainabilityChallengerDrivers, explainabilityChallengerSummary, explainabilityWhyFlagged]
  );
  const explainabilityMissingInputs = useMemo(() => {
    return buildSignalLines(activeExplainabilityPayload?.missing_or_weak_inputs);
  }, [activeExplainabilityPayload?.missing_or_weak_inputs]);
  const explainabilityRiskReduction = useMemo(() => {
    return buildSignalLines(activeExplainabilityPayload?.what_could_reduce_risk);
  }, [activeExplainabilityPayload?.what_could_reduce_risk]);
  const explainabilityWhatIfScenarios = useMemo(() => {
    return buildSignalLines(activeExplainabilityPayload?.what_if_scenarios);
  }, [activeExplainabilityPayload?.what_if_scenarios]);
  const explainabilityPatientStabilityHint = useMemo(
    () => String(activeExplainabilityPayload?.patient_stability_hint || '').trim(),
    [activeExplainabilityPayload?.patient_stability_hint]
  );
  const explainabilitySourceCompleteness = useMemo(
    () => buildSourceCompletenessLines(activeExplainabilityPayload?.source_completeness),
    [activeExplainabilityPayload?.source_completeness]
  );
  const explainabilityRiskChangeSummary = useMemo(
    () => String(activeExplainabilityPayload?.risk_change_summary || '').trim(),
    [activeExplainabilityPayload?.risk_change_summary]
  );
  const explainabilityRiskChangeReasons = useMemo(
    () => buildSignalLines(activeExplainabilityPayload?.risk_change_reasons),
    [activeExplainabilityPayload?.risk_change_reasons]
  );
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
  useEffect(() => {
    if (!shouldAutoSyncActiveInterventionCase || isUpdatingInterventionCase || !activeEntry?.userId) {
      return undefined;
    }

    let cancelled = false;

    async function syncActiveInterventionCase() {
      setIsUpdatingInterventionCase(true);
      try {
        await updateActiveDropoutInterventionCase({
          userId: activeEntry.userId,
          patient: activeEntry.patient,
          prediction: activeEntry,
          recentCases: recentInterventionCases,
          currentUser,
        });
        if (!cancelled) {
          setInterventionCaseMutationError('');
        }
      } catch (nextError) {
        console.error('Unable to sync the active dropout intervention case:', nextError);
        if (!cancelled) {
          setInterventionCaseMutationError(nextError.message || 'Unable to sync the active intervention case.');
        }
      } finally {
        if (!cancelled) {
          setIsUpdatingInterventionCase(false);
        }
      }
    }

    syncActiveInterventionCase();
    return () => {
      cancelled = true;
    };
  }, [
    activeEntry,
    currentUser,
    isUpdatingInterventionCase,
    recentInterventionCases,
    shouldAutoSyncActiveInterventionCase,
  ]);

  const openPatientRoster = () => {
    if (activeEntry?.patient && typeof onOpenPatients === 'function') {
      onOpenPatients(activeEntry.patient);
    }
  };

  async function handleInterventionCaseMutation({ actionTaken = '', manualResult = '' } = {}) {
    if (!activeEntry?.userId || isUpdatingInterventionCase) {
      return;
    }

    setIsUpdatingInterventionCase(true);
    try {
      await updateActiveDropoutInterventionCase({
        userId: activeEntry.userId,
        patient: activeEntry.patient,
        prediction: activeEntry,
        recentCases: recentInterventionCases,
        currentUser,
        actionTaken,
        manualResult,
      });
      setInterventionCaseMutationError('');
    } catch (nextError) {
      console.error('Unable to update the dropout intervention case:', nextError);
      setInterventionCaseMutationError(nextError.message || 'Unable to update the intervention case.');
    } finally {
      setIsUpdatingInterventionCase(false);
    }
  }

  async function handleInterventionCaseClose() {
    if (!activeEntry?.userId || !activeInterventionCase?.id || isUpdatingInterventionCase) {
      return;
    }

    setIsUpdatingInterventionCase(true);
    try {
      await closeDropoutInterventionCase({
        userId: activeEntry.userId,
        caseId: activeInterventionCase.id,
        currentUser,
      });
      setInterventionCaseMutationError('');
    } catch (nextError) {
      console.error('Unable to close the dropout intervention case:', nextError);
      setInterventionCaseMutationError(nextError.message || 'Unable to close the intervention case.');
    } finally {
      setIsUpdatingInterventionCase(false);
    }
  }

  const interventionCaseStatusValue = displayedInterventionCase?.status || '';
  const interventionCaseProxyStatusValue = getDropoutInterventionProxyStatus(displayedInterventionCase);
  const interventionCaseActionValue =
    displayedInterventionCase?.action_taken_code || displayedInterventionCase?.action_taken || '';
  const interventionCaseResultValue =
    displayedInterventionCase?.contact_result_status || displayedInterventionCase?.manual_result || '';
  const interventionCaseCloseReasonValue =
    displayedInterventionCase?.close_reason || '';
  const canMutateInterventionCase = Boolean(
    activeEntry?.userId &&
      currentUser?.uid &&
      !isEarlyHistorySnapshot(activeEntry) &&
      hasUsableSnapshotForInterventionCase(activeEntry) &&
      (activeInterventionCase || activeEntry?.isActionable) &&
      !interventionCaseError
  );
  const isPreparingInterventionCase =
    !activeInterventionCase && interventionCasesReady && shouldAutoSyncActiveInterventionCase;
  const recentInterventionCasePreview = recentInterventionCases.slice(0, 3);
  const recentInterventionCasePreviewLines = useMemo(
    () => recentInterventionCasePreview.map((caseEntry) => formatInterventionHistoryEntry(caseEntry)),
    [recentInterventionCasePreview]
  );
  const canCloseInterventionCase = Boolean(
    activeInterventionCase?.id &&
      currentUser?.uid &&
      isDropoutInterventionCaseOpen(activeInterventionCase) &&
      !isUpdatingInterventionCase
  );

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
              hideNote
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
                  </div>
                  <div className="dropout-dashboard__detailActions">
                    <button className="btn btn-secondary btn-small" onClick={openPatientRoster} disabled={!activeEntry.patient}>
                      Open Patient
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

                <RecentPublishTrendSection rows={recentPublishHistory} currentEntry={activeEntry} />
                {recentPublishHistoryError ? (
                  <div
                    className="info-banner"
                    style={{ marginTop: '14px', background: 'var(--warning-soft)', borderColor: '#f0d6a9', color: 'var(--warning)' }}
                  >
                    {recentPublishHistoryError}
                  </div>
                ) : null}
                {!recentPublishHistoryError && recentPublishHistoryReady && recentPublishHistory.length === 0 ? (
                  <div className="section-note section-note--spaced">
                    Recent-publish trend history will appear here after more published disengagement snapshots accumulate for this patient.
                  </div>
                ) : null}

                <div className="dropout-card dropout-card--soft" style={{ marginTop: '18px' }}>
                  <div className="dropout-card__header">
                    <strong>Intervention case</strong>
                    <span
                      className={`metric-pill metric-pill--${getInterventionLifecycleTone(
                        isPreparingInterventionCase ? 'open' : interventionCaseStatusValue
                      )}`}
                    >
                      {isPreparingInterventionCase
                        ? 'Preparing case'
                        : formatWorkflowValueLabel(
                            interventionCaseStatusValue,
                            canUseInterventionCaseLoop ? 'No open case' : 'Not available'
                          )}
                    </span>
                  </div>
                  <div className="dropout-card__metric">
                    Case status:{' '}
                    {isPreparingInterventionCase
                      ? 'Preparing an open case from the latest prediction'
                      : formatWorkflowValueLabel(
                          interventionCaseStatusValue,
                          canUseInterventionCaseLoop ? 'No visible case yet' : 'Not available for this patient'
                        )}
                  </div>
                  <div className="dropout-card__metric">
                    Automatic 7-day observation:{' '}
                    <span className={`metric-pill metric-pill--${getInterventionCaseStatusTone(interventionCaseProxyStatusValue)}`}>
                      {formatInterventionProxyStatusLabel(interventionCaseProxyStatusValue)}
                    </span>
                  </div>
                  <div className="dropout-card__metric">
                    CRC action: {formatWorkflowValueLabel(interventionCaseActionValue, 'Not recorded')}
                  </div>
                  <div className="dropout-card__metric">
                    Manual response: {formatWorkflowValueLabel(interventionCaseResultValue, 'Not recorded')}
                  </div>
                  {interventionCaseCloseReasonValue ? (
                    <div className="dropout-card__metric">
                      Close reason: {formatInterventionCloseReasonLabel(interventionCaseCloseReasonValue)}
                    </div>
                  ) : null}
                  <div className="dropout-card__metric">
                    Latest linked prediction:{' '}
                    {formatDateTimeValue(
                      displayedInterventionCase?.latest_prediction_published_at || activeEntry?.published_at,
                      'No linked prediction yet'
                    )}
                  </div>
                  <div className="dropout-card__metric">
                    Case last updated:{' '}
                    {formatDateTimeValue(
                      displayedInterventionCase?.updated_at || displayedInterventionCase?.created_at,
                      displayedInterventionCase ? 'Draft' : 'No case timestamp'
                    )}
                  </div>

                  {openInterventionCaseCount > 1 ? (
                    <div
                      className="info-banner"
                      style={{ marginTop: '14px', background: 'var(--warning-soft)', borderColor: '#f0d6a9', color: 'var(--warning)' }}
                    >
                      More than one open intervention case is visible for this patient. The CRC UI will keep updating only the most recent open case until the data is cleaned up.
                    </div>
                  ) : null}

                  {interventionCaseError ? (
                    <div
                      className="info-banner"
                      style={{ marginTop: '14px', background: 'var(--warning-soft)', borderColor: '#f0d6a9', color: 'var(--warning)' }}
                    >
                      {interventionCaseError}
                    </div>
                  ) : null}

                  {interventionCaseMutationError ? (
                    <div
                      className="info-banner"
                      style={{ marginTop: '14px', background: 'var(--warning-soft)', borderColor: '#f0d6a9', color: 'var(--warning)' }}
                    >
                      {interventionCaseMutationError}
                    </div>
                  ) : null}

                  <div className="section-note section-note--spaced">
                    Automatic observation updates here automatically.
                  </div>

                  <div className="workspace-actionStrip" style={{ marginTop: '12px' }}>
                    {INTERVENTION_ACTION_BUTTONS.map((actionOption) => (
                      <button
                        key={actionOption.value}
                        type="button"
                        className={`btn ${
                          interventionCaseActionValue === actionOption.value ? 'btn-primary' : 'btn-secondary'
                        } btn-small`}
                        disabled={!canMutateInterventionCase || isUpdatingInterventionCase}
                        onClick={() => handleInterventionCaseMutation({ actionTaken: actionOption.value })}
                      >
                        {actionOption.label}
                      </button>
                    ))}
                  </div>

                  <div className="workspace-actionStrip" style={{ marginTop: '12px' }}>
                    {INTERVENTION_RESULT_BUTTONS.map((resultOption) => (
                      <button
                        key={resultOption.value}
                        type="button"
                        className={`btn ${
                          interventionCaseResultValue === resultOption.value ? 'btn-primary' : 'btn-secondary'
                        } btn-small`}
                        disabled={!canMutateInterventionCase || isUpdatingInterventionCase}
                        onClick={() => handleInterventionCaseMutation({ manualResult: resultOption.value })}
                      >
                        {resultOption.label}
                      </button>
                    ))}
                  </div>

                  {canCloseInterventionCase ? (
                    <div className="workspace-actionStrip" style={{ marginTop: '12px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={handleInterventionCaseClose}
                        disabled={isUpdatingInterventionCase}
                      >
                        Close case
                      </button>
                    </div>
                  ) : null}

                  <div className="section-note section-note--spaced">
                    {canMutateInterventionCase
                      ? isUpdatingInterventionCase
                        ? 'Saving the latest intervention case update...'
                        : 'Update this case only when the CRC action or manual response changes.'
                      : !currentUser?.uid
                        ? 'CRC identity is required before intervention actions can be recorded.'
                        : isEarlyHistorySnapshot(activeEntry)
                          ? 'An intervention case becomes available after this patient has a published scored snapshot.'
                          : !activeInterventionCase && !activeEntry?.isActionable
                            ? 'There is no open intervention case, and the current snapshot is not actionable enough to open one from this panel.'
                          : 'Intervention case controls are temporarily unavailable.'}
                  </div>

                  {recentInterventionCasePreview.length ? (
                    <DetailSection
                      title="Recent case history"
                      items={recentInterventionCasePreviewLines}
                      emptyLabel="No recent intervention case history is available yet."
                    />
                  ) : null}
                </div>

                {isEarlyHistorySnapshot(activeEntry) ? (
                  <div className="info-banner section-note--spaced">{buildEarlyHistorySummary(activeEntry)}</div>
                ) : null}

                <details className="dropout-dashboard__detailSection" style={{ marginTop: '18px' }}>
                  <summary>
                    <strong>Legacy operational context</strong>
                  </summary>
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
                </details>

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
                      <RiskChangeSection
                        summary={explainabilityRiskChangeSummary}
                        direction={activeExplainabilityPayload?.risk_change_direction}
                        previousPublishedAt={activeExplainabilityPayload?.previous_published_at}
                        previousRiskBucket={activeExplainabilityPayload?.previous_risk_bucket}
                        previousProbability={activeExplainabilityPayload?.previous_dropout_probability}
                        currentRiskBucket={activeExplainabilityPayload?.risk_bucket || activeEntry?.risk_bucket}
                        currentProbability={
                          activeExplainabilityPayload?.disengagement_probability ?? activeEntry?.dropout_probability
                        }
                        reasons={explainabilityRiskChangeReasons}
                      />
                      <DetailSection
                        title="Why this patient is flagged"
                        items={explainabilityWhyFlagged}
                        emptyLabel="Why flagged: missing"
                      />
                      <DetailSection
                        title="Challenger cross-check"
                        items={explainabilityChallengerCrossCheck}
                        emptyLabel="No patient-level challenger cross-check was published for this snapshot."
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
                      <DetailSection
                        title="What-if scenarios"
                        items={explainabilityWhatIfScenarios}
                        emptyLabel="No patient-level what-if scenarios were published for this snapshot."
                      />
                      <DetailSection
                        title="Patient stability hint"
                        items={explainabilityPatientStabilityHint ? [explainabilityPatientStabilityHint] : []}
                        emptyLabel="No patient-level stability hint was published for this snapshot."
                      />
                      <DetailSection
                        title="Structured source completeness"
                        items={explainabilitySourceCompleteness}
                        emptyLabel="No structured source completeness summary was published for this snapshot."
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
