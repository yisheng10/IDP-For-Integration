import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function formatDateOnlyValue(value, emptyLabel = 'N/A') {
  if (!value) return emptyLabel;
  const nextValue = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(nextValue.getTime())
    ? emptyLabel
    : nextValue.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimeOnlyValue(value, emptyLabel = 'N/A') {
  if (!value) return emptyLabel;
  const nextValue = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(nextValue.getTime())
    ? emptyLabel
    : nextValue.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
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

function MetricCard({
  label,
  value,
  tone = 'default',
  supportingCopy = '',
  trailingMeta = '',
  metaTitle = '',
  metaPrimary = '',
  metaSecondary = '',
}) {
  return (
    <div className={`dropout-dashboard__metric dropout-dashboard__metric--${tone}`}>
      <div className="dropout-dashboard__metricBody">
        <label>{label}</label>
        <strong>{value}</strong>
        {supportingCopy ? <small>{supportingCopy}</small> : null}
      </div>
      {metaTitle || metaPrimary || metaSecondary || trailingMeta ? (
        <div className="dropout-dashboard__metricMeta">
          {metaTitle ? <span className="dropout-dashboard__metricMetaTitle">{metaTitle}</span> : null}
          {metaPrimary ? <strong className="dropout-dashboard__metricMetaPrimary">{metaPrimary}</strong> : null}
          {metaSecondary ? <span className="dropout-dashboard__metricMetaSecondary">{metaSecondary}</span> : null}
          {!metaTitle && !metaPrimary && !metaSecondary && trailingMeta ? <span>{trailingMeta}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function DashboardIcon({ type = 'info' }) {
  const commonProps = {
    width: '16',
    height: '16',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };

  if (type === 'trend') {
    return (
      <svg {...commonProps}>
        <path d="M3 17l6-6 4 4 8-9" />
        <path d="M14 6h7v7" />
      </svg>
    );
  }
  if (type === 'target') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    );
  }
  if (type === 'shield') {
    return (
      <svg {...commonProps}>
        <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-5" />
      </svg>
    );
  }
  if (type === 'alert') {
    return (
      <svg {...commonProps}>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 4.3L2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  }
  if (type === 'spark') {
    return (
      <svg {...commonProps}>
        <path d="M13 2L4 14h7l-1 8 10-13h-7l0-7z" />
      </svg>
    );
  }
  if (type === 'link') {
    return (
      <svg {...commonProps}>
        <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
      </svg>
    );
  }
  if (type === 'database') {
    return (
      <svg {...commonProps}>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
        <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </svg>
  );
}

function getExplainabilityIcon(title = '') {
  const normalized = String(title || '').toLowerCase();
  if (normalized.includes('risk change')) return 'trend';
  if (normalized.includes('why')) return 'target';
  if (normalized.includes('challenger') || normalized.includes('model')) return 'shield';
  if (normalized.includes('data') || normalized.includes('missing') || normalized.includes('source')) return 'database';
  if (normalized.includes('reduce') || normalized.includes('what-if')) return 'spark';
  if (normalized.includes('stability') || normalized.includes('confidence')) return 'shield';
  return 'info';
}

function SectionTitle({ title, icon = 'info' }) {
  return (
    <div className="dropout-dashboard__sectionTitle">
      <span className="dropout-dashboard__panelIcon">
        <DashboardIcon type={icon} />
      </span>
      <strong>{title}</strong>
    </div>
  );
}

function DetailSection({ title, items, emptyLabel }) {
  const icon = getExplainabilityIcon(title);
  if (!items.length) {
    return (
      <div className="dropout-dashboard__detailSection">
        <SectionTitle title={title} icon={icon} />
        <div className="section-note">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="dropout-dashboard__detailSection">
      <SectionTitle title={title} icon={icon} />
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
  const icon = getExplainabilityIcon(title);
  if (!summary) {
    return (
      <div className="dropout-dashboard__detailSection">
        <SectionTitle title={title} icon={icon} />
        <div className="section-note">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="dropout-dashboard__detailSection">
      <div className="dropout-dashboard__statusHeader">
        <SectionTitle title={title} icon={icon} />
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
          <SectionTitle title="Risk change since last publish" icon="trend" />
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
        <SectionTitle title="Risk change since last publish" icon="trend" />
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
    netDelta,
  };
}

function getTrendDirectionTone(direction) {
  if (direction === 'rising') return 'warning';
  if (direction === 'falling') return 'success';
  if (direction === 'stable') return 'default';
  return 'default';
}

function formatWeekTrendLabel(delta) {
  if (delta == null) return 'No week baseline';
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${(delta * 100).toFixed(1)} pts`;
}

function truncateSignalItems(items = [], limitCount = 3) {
  return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, limitCount);
}

function scrollToSection(ref) {
  ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderInlineActionButton(label, onClick) {
  return (
    <button type="button" className="dropout-dashboard__inlineLink" onClick={onClick}>
      {label}
    </button>
  );
}

function HighlightSummaryCard({
  title,
  badge = '',
  badgeTone = 'default',
  icon = 'info',
  accent = 'default',
  summary = '',
  items = [],
  ctaLabel = '',
  onCtaClick = null,
}) {
  const visibleItems = truncateSignalItems(items, 2);

  return (
    <div className={`dropout-dashboard__highlightCard dropout-dashboard__highlightCard--${accent}`}>
      <div className="dropout-dashboard__highlightHeader">
        <div className="dropout-dashboard__highlightTitle">
          <span className="dropout-dashboard__panelIcon">
            <DashboardIcon type={icon} />
          </span>
          <strong>{title}</strong>
        </div>
        {badge ? <span className={`metric-pill metric-pill--${badgeTone}`}>{badge}</span> : null}
      </div>
      {summary ? <div className="dropout-dashboard__highlightSummary">{summary}</div> : null}
      {visibleItems.length ? (
        <ul className="dropout-dashboard__highlightList">
          {visibleItems.map((item) => (
            <li key={`${title}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : null}
      {ctaLabel && onCtaClick ? renderInlineActionButton(ctaLabel, onCtaClick) : null}
    </div>
  );
}

function addDaysToDate(value, days) {
  const nextValue = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(nextValue.getTime())) {
    return null;
  }
  const cloned = new Date(nextValue);
  cloned.setDate(cloned.getDate() + days);
  return cloned;
}

function buildInterventionTimelineStages(caseEntry = {}) {
  const actionCode = String(caseEntry?.action_taken_code || caseEntry?.action_taken || '').trim().toLowerCase();
  const manualResult = String(caseEntry?.contact_result_status || caseEntry?.manual_result || '').trim().toLowerCase();
  const proxyStatus = getDropoutInterventionProxyStatus(caseEntry);
  const closeReason = String(caseEntry?.close_reason || '').trim().toLowerCase();

  const openedAt = caseEntry?.opened_at || caseEntry?.created_at || null;
  const observationAt = caseEntry?.anchor_prediction_published_at || caseEntry?.latest_prediction_published_at || openedAt;
  const actionAt = caseEntry?.action_taken_at || null;
  const responseAt = caseEntry?.contact_result_recorded_at || null;
  const autoEvaluationAt =
    caseEntry?.proxy_reengagement_evaluated_at ||
    caseEntry?.closed_at ||
    addDaysToDate(observationAt, Number(caseEntry?.proxy_window_days) || 0);

  return [
    {
      key: 'opened',
      label: 'Case opened',
      timestamp: openedAt,
      state: openedAt ? 'complete' : 'pending',
      tone: 'success',
    },
    {
      key: 'observation',
      label: 'Observation window open',
      timestamp: observationAt,
      state: observationAt ? 'complete' : 'pending',
      tone: 'brand',
    },
    {
      key: 'action',
      label: 'Outreach attempted',
      timestamp: actionCode === 'outreach_attempted' ? actionAt : null,
      caption: actionCode === 'monitor_only' ? 'Monitor only selected' : '',
      state: actionCode === 'outreach_attempted' ? 'complete' : actionCode === 'monitor_only' ? 'active' : 'pending',
      tone: actionCode === 'outreach_attempted' ? 'brand' : 'default',
    },
    {
      key: 'response',
      label: manualResult === 'responded' ? 'Responded' : 'No response yet',
      timestamp: responseAt,
      state: manualResult ? 'active' : 'pending',
      tone: manualResult === 'responded' ? 'success' : manualResult === 'no_response_yet' ? 'danger' : 'default',
    },
    {
      key: 'auto',
      label:
        closeReason === 'manual_crc_close'
          ? 'Closed'
          : proxyStatus === 'reengaged_observed'
            ? 'Re-engagement observed'
            : proxyStatus === 'no_reengagement_observed'
              ? 'No re-engagement observed'
              : proxyStatus === 'source_incomplete'
                ? 'Source data incomplete'
                : 'Auto evaluation in progress',
      timestamp: autoEvaluationAt,
      caption:
        closeReason === 'manual_crc_close'
          ? 'Closed manually by CRC'
          : proxyStatus === 'window_open'
            ? `Due by ${formatDateTimeValue(autoEvaluationAt, 'N/A')}`
            : '',
      state:
        closeReason === 'manual_crc_close' || proxyStatus === 'reengaged_observed' || proxyStatus === 'no_reengagement_observed'
          ? 'complete'
          : proxyStatus === 'source_incomplete' || proxyStatus === 'window_open'
            ? 'active'
            : 'pending',
      tone:
        closeReason === 'manual_crc_close'
          ? 'default'
          : proxyStatus === 'reengaged_observed'
            ? 'success'
            : proxyStatus === 'no_reengagement_observed' || proxyStatus === 'source_incomplete'
              ? 'warning'
              : 'default',
    },
  ];
}

function InterventionTimelineSection({
  caseEntry,
  isPreparing,
  canUseCaseLoop,
  canMutate,
  canClose,
  isUpdating,
  actionValue,
  resultValue,
  proxyStatusValue,
  lifecycleStatusValue,
  closeReasonValue,
  recentCases,
  onAction,
  onResult,
  onClose,
  errorMessage = '',
  mutationError = '',
  sectionRef = null,
}) {
  const stages = buildInterventionTimelineStages(caseEntry || {});
  const [showFullHistory, setShowFullHistory] = useState(false);
  const allHistoryRows = Array.isArray(recentCases) ? recentCases : [];
  const historyRows = (showFullHistory ? allHistoryRows : allHistoryRows.slice(0, 4));
  const hasMoreHistory = allHistoryRows.length > 4;
  const renderStageLabel = (stage) => {
    if (stage?.key === 'auto') {
      return (
        <>
          <span>Auto evaluation</span>
          <span>in progress</span>
        </>
      );
    }
    return stage.label;
  };

  return (
    <section ref={sectionRef} className="dropout-dashboard__timelineCard">
      <div className="dropout-dashboard__cardHeader">
        <div>
          <strong>Intervention Case Timeline</strong>
        </div>
        <span className={`metric-pill metric-pill--${getInterventionLifecycleTone(isPreparing ? 'open' : lifecycleStatusValue)}`}>
          {isPreparing
            ? 'Preparing case'
            : formatWorkflowValueLabel(lifecycleStatusValue, canUseCaseLoop ? 'No open case' : 'Not available')}
        </span>
      </div>

        <div className="dropout-dashboard__timelineRail">
        {stages.map((stage, index) => {
          const timestampLabel = formatDateTimeValue(stage.timestamp, stage.state === 'pending' ? 'Pending' : 'N/A');
          const shouldShowTimestamp = !(stage.key === 'auto' && stage.caption);
          const stageAccessibleLabel = [stage.label, shouldShowTimestamp ? timestampLabel : '', stage.caption].filter(Boolean).join(', ');
          return (
            <div
              key={stage.key}
              className={`dropout-dashboard__timelineStage dropout-dashboard__timelineStage--${stage.state} dropout-dashboard__timelineStage--${stage.key}`}
            >
              {index < stages.length - 1 ? <div className="dropout-dashboard__timelineConnector" /> : null}
              <div
                className={`dropout-dashboard__timelineDot dropout-dashboard__timelineDot--${stage.tone}`}
                aria-label={stageAccessibleLabel}
              >
                <span>{stage.state === 'complete' ? '✓' : index + 1}</span>
              </div>
              <div className="dropout-dashboard__timelineLabel">{renderStageLabel(stage)}</div>
              {shouldShowTimestamp ? <div className="dropout-dashboard__timelineMeta">{timestampLabel}</div> : null}
              {stage.caption ? <div className="dropout-dashboard__timelineCaption">{stage.caption}</div> : null}
            </div>
          );
        })}
      </div>

      <div className="dropout-dashboard__timelineStatusGrid">
        <div>
          <span>Case status</span>
          <strong>{isPreparing ? 'Preparing open case' : formatWorkflowValueLabel(lifecycleStatusValue, 'Not available')}</strong>
        </div>
        <div>
          <span>Observation window</span>
          <strong>{formatInterventionProxyStatusLabel(proxyStatusValue)}</strong>
        </div>
        <div>
          <span>CRC action</span>
          <strong>{formatWorkflowValueLabel(actionValue, 'Not recorded')}</strong>
        </div>
        <div>
          <span>Manual response</span>
          <strong>{formatWorkflowValueLabel(resultValue, 'Not recorded')}</strong>
        </div>
        <div>
          <span>Close reason</span>
          <strong>{closeReasonValue ? formatInterventionCloseReasonLabel(closeReasonValue) : '—'}</strong>
        </div>
      </div>

      <div className="dropout-dashboard__timelineMetaGrid">
        <div>
          <span>Last linked prediction</span>
          <strong>{formatDateTimeValue(caseEntry?.latest_prediction_published_at, 'No linked prediction yet')}</strong>
        </div>
        <div>
          <span>Last case update</span>
          <strong>{formatDateTimeValue(caseEntry?.updated_at || caseEntry?.created_at, 'Draft')}</strong>
        </div>
        <div>
          <span>Source case history</span>
          <strong>{caseEntry?.anchor_prediction_published_at ? `Open (${formatDateTimeValue(caseEntry.anchor_prediction_published_at)})` : 'No anchor yet'}</strong>
        </div>
      </div>

      {errorMessage ? (
        <div className="info-banner" style={{ marginTop: '14px', background: 'var(--warning-soft)', borderColor: '#f0d6a9', color: 'var(--warning)' }}>
          {errorMessage}
        </div>
      ) : null}

      {mutationError ? (
        <div className="info-banner" style={{ marginTop: '14px', background: 'var(--warning-soft)', borderColor: '#f0d6a9', color: 'var(--warning)' }}>
          {mutationError}
        </div>
      ) : null}

      <div className="dropout-dashboard__timelineActions">
        {INTERVENTION_ACTION_BUTTONS.map((actionOption) => (
          <button
            key={actionOption.value}
            type="button"
            className={`btn ${actionValue === actionOption.value ? 'btn-primary' : 'btn-secondary'} btn-small dropout-dashboard__timelineActionButton`}
            disabled={!canMutate || isUpdating}
            onClick={() => onAction(actionOption.value)}
          >
            {actionOption.label}
          </button>
        ))}
        {INTERVENTION_RESULT_BUTTONS.map((resultOption) => (
          <button
            key={resultOption.value}
            type="button"
            className={`btn ${resultValue === resultOption.value ? 'btn-primary' : 'btn-secondary'} btn-small dropout-dashboard__timelineActionButton`}
            disabled={!canMutate || isUpdating}
            onClick={() => onResult(resultOption.value)}
          >
            {resultOption.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-small dropout-dashboard__timelineActionButton dropout-dashboard__timelineActionButton--danger"
          disabled={!canClose || isUpdating}
          onClick={onClose}
        >
          Close case
        </button>
      </div>

      <div className="section-note section-note--spaced">
        {canMutate
          ? isUpdating
            ? 'Saving the latest intervention case update...'
            : 'Update this case only when the CRC action or manual response changes.'
          : 'Automatic observation updates here automatically.'}
      </div>

      <div className="dropout-dashboard__historyBlock">
        <div className="dropout-dashboard__historyHeader">
          <strong>Recent case history</strong>
          <span className="section-note">Latest 4 visible case events</span>
        </div>
        <div className="dropout-dashboard__historyRows">
          {historyRows.length ? (
            historyRows.map((caseHistoryEntry) => {
              const sourceNote =
                caseHistoryEntry?.last_synced_by_name
                  ? `CRC: ${caseHistoryEntry.last_synced_by_name}`
                  : caseHistoryEntry?.sync_source === 'crc_panel_case_loop'
                    ? 'Automatic (daily sync)'
                    : '';
              return (
                <div key={caseHistoryEntry.id || caseHistoryEntry.case_id || formatInterventionHistoryEntry(caseHistoryEntry)} className="dropout-dashboard__historyRow">
                  <div className="dropout-dashboard__historyTime">
                    {formatDateTimeValue(caseHistoryEntry?.updated_at || caseHistoryEntry?.created_at, 'No timestamp')}
                  </div>
                  <div className="dropout-dashboard__historySummary">
                    {formatInterventionHistoryEntry(caseHistoryEntry)}
                  </div>
                  <div className="dropout-dashboard__historySource">{sourceNote || '—'}</div>
                </div>
              );
            })
          ) : (
            <div className="section-note">No recent intervention case history is available yet.</div>
          )}
        </div>
        {hasMoreHistory ? (
          <button
            type="button"
            className="dropout-dashboard__historyExpand"
            onClick={() => setShowFullHistory((value) => !value)}
          >
            {showFullHistory ? 'Show recent case history' : 'View full case timeline'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function CurrentRiskBriefCard({ entry, trendData, onOpenPatient, canOpenPatient }) {
  const delta = trendData?.latestDelta ?? null;
  const trendDirection = trendData?.trendDirection || 'building';
  return (
    <div className="dropout-dashboard__currentRiskCard">
      <div className="dropout-dashboard__cardHeader">
        <div>
          <strong>Current risk</strong>
          <div className="dropout-dashboard__cardSubtitle">This publish</div>
        </div>
        <span className={`dropout-card__bucket dropout-card__bucket--${String(entry?.risk_bucket || 'low').toLowerCase()}`}>
          {renderSnapshotStateLabel(entry)}
        </span>
      </div>
      <div className="dropout-dashboard__currentRiskTopline">
        <div className="dropout-dashboard__currentRiskValue">{formatSnapshotProbabilityPercent(entry)}</div>
        <div className="dropout-dashboard__currentRiskMeta">
          <div>
            <span>Risk</span>
            <strong>{renderSnapshotStateLabel(entry)}</strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{getConfidenceLabel(entry?.data_quality_flags)}</strong>
          </div>
        </div>
      </div>
      <div className="dropout-dashboard__currentRiskActionRow">
        <div>
          <span>Recommended action</span>
          <strong>{formatRecommendedAction(entry)}</strong>
        </div>
        <button type="button" className="btn btn-primary btn-small" onClick={onOpenPatient} disabled={!canOpenPatient}>
          Open Patient
        </button>
      </div>
      <div className="dropout-dashboard__currentRiskFooter">
        <span>Last publish: {formatDateTimeValue(entry?.published_at, 'N/A')}</span>
        <span>{formatTrendDeltaLabel(delta)}</span>
        <span className={`metric-pill metric-pill--${getTrendDirectionTone(trendDirection)}`}>
          {formatRecentTrendDirectionLabel(trendDirection)}
        </span>
      </div>
    </div>
  );
}

function ModelContractBriefCard({ entry }) {
  return (
    <div className="dropout-dashboard__modelCard">
      <div className="dropout-dashboard__cardHeader">
        <div>
          <strong>Model contract</strong>
        </div>
      </div>
      <div className="dropout-dashboard__modelGrid">
        <span>Stage</span>
        <strong>{entry?.routed_stage || 'N/A'}</strong>
        <span>Prediction horizon</span>
        <strong>{entry?.pred_horizon_days || 'N/A'} days</strong>
        <span>History window</span>
        <strong>{entry?.history_window_days || 'N/A'} days</strong>
        <span>Model version</span>
        <strong>{entry?.model_version || 'N/A'}</strong>
      </div>
    </div>
  );
}

function QueueRow({ entry, rank, isSelected, onSelect }) {
  return (
    <button
      type="button"
      className={`dropout-dashboard__queueRow ${isSelected ? 'dropout-dashboard__queueRow--selected' : ''}`}
      onClick={onSelect}
    >
      <div className="dropout-dashboard__queueRowRank">{rank}</div>
      <div className="dropout-dashboard__queueRowBody">
        <div className="dropout-dashboard__queueRowTop">
          <div>
            <div className="dropout-dashboard__queuePatientName">{entry.patientName}</div>
            <div className="dropout-dashboard__queuePatientMeta">{entry.subjectId}</div>
          </div>
          <div className="dropout-dashboard__queueBadges">
            <span className={`dropout-card__bucket dropout-card__bucket--${String(entry?.risk_bucket || 'low').toLowerCase()}`}>
              {renderSnapshotStateLabel(entry)}
            </span>
          </div>
        </div>
        <div className="dropout-dashboard__queueStats">
          <div>
            <span>Risk probability</span>
            <strong className="dropout-dashboard__queueProbability">{formatSnapshotProbabilityPercent(entry)}</strong>
          </div>
          <div>
            <span>Recommended action</span>
            <strong className="dropout-dashboard__queueAction">{formatRecommendedAction(entry)}</strong>
          </div>
        </div>
        <div className="dropout-dashboard__queueFoot">
          <span>Last publish: {entry.published_at ? new Date(entry.published_at).toLocaleString() : 'Not published'}</span>
        </div>
      </div>
    </button>
  );
}

function formatHighlightBadgeText(status, items = []) {
  if (status) {
    return formatStatusLabel(status);
  }
  if (!items.length) {
    return 'None';
  }
  return `${items.length} noted`;
}

function deriveDataGapBadge(items = []) {
  return !items.length ? 'None' : 'Review';
}

function deriveDataGapTone(items = []) {
  return !items.length ? 'success' : 'warning';
}

function getDetailedGridClassName(index) {
  if (index < 4) return 'dropout-dashboard__detailCell dropout-dashboard__detailCell--quarter';
  if (index < 6) return 'dropout-dashboard__detailCell dropout-dashboard__detailCell--half dropout-dashboard__detailCell--action';
  if (index < 9) return 'dropout-dashboard__detailCell dropout-dashboard__detailCell--third';
  return 'dropout-dashboard__detailCell dropout-dashboard__detailCell--third';
}

function formatScoredBreakdown(scoredCount, loadedCount) {
  if (!Number.isFinite(scoredCount) || loadedCount <= 0) {
    return '';
  }
  return `${((scoredCount / loadedCount) * 100).toFixed(1)}% of loaded`;
}

function formatSubsetBreakdown(count, total) {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) {
    return '';
  }
  return `${((count / total) * 100).toFixed(1)}% of scored`;
}

function buildDetailedExplainabilitySections({
  explainabilityRiskChangeSummary,
  activeExplainabilityPayload,
  activeEntry,
  explainabilityRiskChangeReasons,
  explainabilityWhyFlagged,
  explainabilityChallengerCrossCheck,
  explainabilityMissingInputs,
  explainabilityRiskReduction,
  explainabilityWhatIfScenarios,
  explainabilityPatientStabilityHint,
  explainabilitySourceCompleteness,
  explainabilityModelAgreement,
  explainabilityConfidence,
  explainabilityMissingRequiredSections,
  explainabilitySourceErrors,
}) {
  return [
    ({ className }) => (
      <div className={className}>
        <RiskChangeSection
          summary={explainabilityRiskChangeSummary}
          direction={activeExplainabilityPayload?.risk_change_direction}
          previousPublishedAt={activeExplainabilityPayload?.previous_published_at}
          previousRiskBucket={activeExplainabilityPayload?.previous_risk_bucket}
          previousProbability={activeExplainabilityPayload?.previous_dropout_probability}
          currentRiskBucket={activeExplainabilityPayload?.risk_bucket || activeEntry?.risk_bucket}
          currentProbability={activeExplainabilityPayload?.disengagement_probability ?? activeEntry?.dropout_probability}
          reasons={explainabilityRiskChangeReasons}
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection title="Why this patient is flagged" items={explainabilityWhyFlagged} emptyLabel="Why flagged: missing" />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="Challenger cross-check"
          items={explainabilityChallengerCrossCheck}
          emptyLabel="No patient-level challenger cross-check was published for this snapshot."
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="Data gaps affecting confidence"
          items={explainabilityMissingInputs}
          emptyLabel="Missing or weak inputs: missing"
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="What might reduce disengagement risk"
          items={explainabilityRiskReduction}
          emptyLabel="What could reduce risk: missing"
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="What-if scenarios"
          items={explainabilityWhatIfScenarios}
          emptyLabel="No patient-level what-if scenarios were published for this snapshot."
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="Patient stability hint"
          items={explainabilityPatientStabilityHint ? [explainabilityPatientStabilityHint] : []}
          emptyLabel="No patient-level stability hint was published for this snapshot."
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="Structured source completeness"
          items={explainabilitySourceCompleteness}
          emptyLabel="No structured source completeness summary was published for this snapshot."
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <StatusSummarySection
          title="Model agreement"
          status={explainabilityModelAgreement.status}
          summary={explainabilityModelAgreement.summary}
          emptyLabel="Model agreement: not published in this workflow scope"
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <StatusSummarySection
          title="Confidence and stability"
          status={explainabilityConfidence.status}
          summary={explainabilityConfidence.summary}
          emptyLabel="Confidence and stability: limited / not published"
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="Missing mirror sections"
          items={explainabilityMissingRequiredSections}
          emptyLabel="No required mirror sections are missing."
        />
      </div>
    ),
    ({ className }) => (
      <div className={className}>
        <DetailSection
          title="Live source read errors"
          items={explainabilitySourceErrors}
          emptyLabel="No live source read errors were reported for this mirror."
        />
      </div>
    ),
  ];
}

function RecentPublishTrendSection({ rows, currentEntry, sectionRef = null, onViewDetailedTrend = null }) {
  const trendData = buildRecentPublishTrendData(rows, currentEntry);
  const { chronologicalRows, trendDirection, headline, jumpSummary, latestDelta, netDelta } = trendData;

  if (!currentEntry) {
    return null;
  }

  const chartWidth = 480;
  const chartHeight = 136;
  const leftPadding = 22;
  const rightPadding = 18;
  const topPadding = 18;
  const bottomPadding = 26;
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
  const latestAction = formatRecommendedAction(currentEntry);

  return (
    <section ref={sectionRef} className="dropout-dashboard__trendCard">
      <div className="dropout-dashboard__cardHeader">
        <div>
          <strong>Recent 7 publishes</strong>
          <div className="dropout-dashboard__cardSubtitle">Risk trend</div>
        </div>
        <span className={`metric-pill metric-pill--${getTrendDirectionTone(trendDirection)}`}>
          {formatRecentTrendDirectionLabel(trendDirection)}
        </span>
      </div>
      <div className="dropout-dashboard__trendHeadline">
        {headline || 'This trend view will fill in as more published disengagement snapshots accumulate for this patient.'}
      </div>
      <div className="dropout-dashboard__trendLayout">
        <div className="dropout-dashboard__trendChartSurface">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} width="100%" height="184" aria-label="Recent disengagement publish trend">
            <line x1={leftPadding} y1={topPadding} x2={chartWidth - rightPadding} y2={topPadding} stroke="rgba(33, 74, 111, 0.12)" strokeWidth="1" />
            <line x1={leftPadding} y1={chartHeight / 2} x2={chartWidth - rightPadding} y2={chartHeight / 2} stroke="rgba(33, 74, 111, 0.08)" strokeWidth="1" />
            <line
              x1={leftPadding}
              y1={chartHeight - bottomPadding}
              x2={chartWidth - rightPadding}
              y2={chartHeight - bottomPadding}
              stroke="rgba(33, 74, 111, 0.18)"
              strokeWidth="1"
            />
          {polylinePoints ? (
            <polyline
              fill="none"
              stroke="rgba(47, 96, 146, 0.44)"
              strokeWidth="2.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={polylinePoints}
            />
          ) : null}
          {chartPoints.map((point, index) => {
            const label = `${(point.probability * 100).toFixed(1)}%`;
            const entry = chronologicalRows[index];
            return (
              <g key={point.key}>
                <text
                  x={point.x}
                  y={Math.max(point.y - 10, 10)}
                  textAnchor="middle"
                  fontSize="10"
                  fill="rgba(38, 62, 86, 0.88)"
                  fontWeight="700"
                >
                  {label}
                </text>
                {point.isCurrent ? (
                  <circle cx={point.x} cy={point.y} r="8" fill="rgba(27, 92, 151, 0.14)" stroke="none" />
                ) : null}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={point.isCurrent ? 4.8 : 4}
                  fill={point.color}
                  stroke="#ffffff"
                  strokeWidth={point.isCurrent ? 2.2 : 1.6}
                />
                <text
                  x={point.x}
                  y={chartHeight - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="rgba(76, 99, 122, 0.94)"
                >
                  {entry?.published_at ? new Date(entry.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'N/A'}
                </text>
                <text
                  x={point.x}
                  y={chartHeight - 18}
                  textAnchor="middle"
                  fontSize="9"
                  fill="rgba(98, 120, 143, 0.86)"
                >
                  {entry?.published_at ? new Date(entry.published_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}
                </text>
              </g>
            );
          })}
          </svg>
          <div className="dropout-dashboard__trendLegend">
            <span><i style={{ background: getRiskBucketTone('high') }} />High (≥ 60%)</span>
            <span><i style={{ background: getRiskBucketTone('medium') }} />Medium (30–59%)</span>
            <span><i style={{ background: getRiskBucketTone('low') }} />Low (&lt; 30%)</span>
          </div>
        </div>
        <aside className="dropout-dashboard__trendMeta">
          <div className="dropout-dashboard__trendMetaRow">
            <span>Latest action</span>
            <strong>{latestAction}</strong>
          </div>
          <div className="dropout-dashboard__trendMetaRow">
            <span>Change vs prior</span>
            <strong>{formatTrendDeltaLabel(latestDelta)}</strong>
          </div>
          <div className="dropout-dashboard__trendMetaRow">
            <span>Trend vs week</span>
            <strong className={netDelta != null && netDelta > 0 ? 'text-red' : netDelta != null && netDelta < 0 ? 'text-green' : ''}>
              {formatWeekTrendLabel(netDelta)}
            </strong>
          </div>
          {jumpSummary ? <div className="dropout-dashboard__trendJump">{jumpSummary}</div> : null}
          {onViewDetailedTrend ? renderInlineActionButton('View full trend', onViewDetailedTrend) : null}
        </aside>
      </div>
    </section>
  );
}

export default function DropoutRiskPanel({
  patients = [],
  currentUser = null,
  onOpenPatients,
}) {
  const trendSectionRef = useRef(null);
  const interventionSectionRef = useRef(null);
  const explainabilitySectionRef = useRef(null);
  const queuePanelRef = useRef(null);
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
  const [queuePanelHeight, setQueuePanelHeight] = useState(null);

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
  const activeTrendData = useMemo(
    () => buildRecentPublishTrendData(recentPublishHistory, activeEntry),
    [activeEntry, recentPublishHistory]
  );

  useEffect(() => {
    const queueNode = queuePanelRef.current;
    const timelineNode = interventionSectionRef.current;
    if (!queueNode || !timelineNode || typeof window === 'undefined') return undefined;

    let frameId = 0;
    const syncQueueHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const queueRect = queueNode.getBoundingClientRect();
        const timelineRect = timelineNode.getBoundingClientRect();
        const nextHeight = Math.ceil(timelineRect.bottom - queueRect.top);
        if (!Number.isFinite(nextHeight) || nextHeight < 320) return;
        setQueuePanelHeight((currentHeight) => (
          Math.abs((currentHeight || 0) - nextHeight) > 1 ? nextHeight : currentHeight
        ));
      });
    };

    syncQueueHeight();
    window.addEventListener('resize', syncQueueHeight);
    window.visualViewport?.addEventListener('resize', syncQueueHeight);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncQueueHeight);
      resizeObserver.observe(queueNode);
      resizeObserver.observe(timelineNode);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', syncQueueHeight);
      window.visualViewport?.removeEventListener('resize', syncQueueHeight);
      resizeObserver?.disconnect();
    };
  }, [activeEntry?.userId, visibleRows.length, recentInterventionCases.length, interventionCaseMutationError, interventionCaseError]);

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
  const fallbackMetricSnapshot = useMemo(() => {
    const scoredRows = visibleSourceRows.filter((entry) => !isEarlyHistorySnapshot(entry));
    const highRiskRows = scoredRows.filter((entry) => String(entry?.risk_bucket || '').trim().toLowerCase() === 'high');
    const actionableRows = scoredRows.filter((entry) => isActionableSnapshot(entry));
    const probabilityValues = scoredRows
      .map((entry) => getProbabilityNumber(entry?.dropout_probability))
      .filter((value) => value != null);

    return {
      scoredCount: scoredRows.length,
      highRiskCount: highRiskRows.length,
      actionableCount: actionableRows.length,
      averageProbability: probabilityValues.length
        ? probabilityValues.reduce((sum, value) => sum + value, 0) / probabilityValues.length
        : null,
    };
  }, [visibleSourceRows]);
  const effectiveSummaryMetrics = useMemo(
    () => ({
      scoredCount: dashboardMetrics.scoredCount ?? fallbackMetricSnapshot.scoredCount,
      highRiskCount: dashboardMetrics.highRiskCount ?? fallbackMetricSnapshot.highRiskCount,
      actionableCount: dashboardMetrics.actionableCount ?? fallbackMetricSnapshot.actionableCount,
      averageProbability: dashboardMetrics.averageProbability ?? fallbackMetricSnapshot.averageProbability,
      publishedAt: dashboardMetrics.publishedAt,
    }),
    [dashboardMetrics, fallbackMetricSnapshot]
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
  const visibleDetailedExplainabilitySections = useMemo(
    () =>
      buildDetailedExplainabilitySections({
        explainabilityRiskChangeSummary,
        activeExplainabilityPayload,
        activeEntry,
        explainabilityRiskChangeReasons,
        explainabilityWhyFlagged,
        explainabilityChallengerCrossCheck,
        explainabilityMissingInputs,
        explainabilityRiskReduction,
        explainabilityWhatIfScenarios,
        explainabilityPatientStabilityHint,
        explainabilitySourceCompleteness,
        explainabilityModelAgreement,
        explainabilityConfidence,
        explainabilityMissingRequiredSections,
        explainabilitySourceErrors,
      }),
    [
      activeEntry,
      activeExplainabilityPayload,
      explainabilityChallengerCrossCheck,
      explainabilityConfidence,
      explainabilityMissingInputs,
      explainabilityMissingRequiredSections,
      explainabilityModelAgreement,
      explainabilityPatientStabilityHint,
      explainabilityRiskChangeReasons,
      explainabilityRiskChangeSummary,
      explainabilityRiskReduction,
      explainabilitySourceCompleteness,
      explainabilitySourceErrors,
      explainabilityWhatIfScenarios,
      explainabilityWhyFlagged,
    ]
  );
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
  const previousExplainabilityRiskLabel = formatRiskStateLabel(
    activeExplainabilityPayload?.previous_risk_bucket,
    activeExplainabilityPayload?.previous_dropout_probability
  );
  const currentExplainabilityRiskLabel = formatRiskStateLabel(
    activeExplainabilityPayload?.risk_bucket || activeEntry?.risk_bucket,
    activeExplainabilityPayload?.disengagement_probability ?? activeEntry?.dropout_probability
  );
  const riskChangeHighlightSummary = explainabilityRiskChangeSummary
    ? `${previousExplainabilityRiskLabel} → ${currentExplainabilityRiskLabel}`
    : activeExplainabilityReady
      ? 'No prior publish available for comparison.'
      : 'Loading explainability summary...';
  const riskChangeHighlightItems = explainabilityRiskChangeSummary
    ? [
        formatTrendDeltaLabel(activeTrendData?.latestDelta ?? null),
        `Previous: ${formatDateTimeValue(activeExplainabilityPayload?.previous_published_at, 'No prior publish')}`,
      ]
    : [];
  const whyFlaggedHighlightSummary = explainabilityWhyFlagged.length
    ? ''
    : activeExplainabilityReady
      ? 'No patient-level flags were published for this snapshot.'
      : 'Loading explainability summary...';
  const challengerHighlightStatus = activeExplainabilityPayload?.model_agreement?.status || '';
  const challengerHighlightSummary = explainabilityChallengerCrossCheck.length
    ? explainabilityChallengerCrossCheck[0]
    : activeExplainabilityReady
      ? 'No challenger cross-check was published for this snapshot.'
      : 'Loading explainability summary...';
  const dataGapHighlightSummary = explainabilityMissingInputs.length
    ? explainabilityMissingInputs[0]
    : activeExplainabilityReady
      ? 'No missing-input issues were reported for the current snapshot.'
      : 'Loading explainability summary...';
  const queuePanelStyle = queuePanelHeight
    ? { '--dropout-queue-panel-height': `${queuePanelHeight}px` }
    : undefined;
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
        <div className="dropout-dashboard__metrics">
          <MetricCard
            label="Scored patients"
            value={effectiveSummaryMetrics.scoredCount ?? 'N/A'}
            supportingCopy={formatScoredBreakdown(effectiveSummaryMetrics.scoredCount, visibleSourceRows.length)}
          />
          <MetricCard
            label="High-risk patients"
            value={effectiveSummaryMetrics.highRiskCount ?? 'N/A'}
            tone="warning"
            supportingCopy={formatSubsetBreakdown(effectiveSummaryMetrics.highRiskCount, effectiveSummaryMetrics.scoredCount)}
          />
          <MetricCard
            label="Actionable patients"
            value={effectiveSummaryMetrics.actionableCount ?? 'N/A'}
            tone="brand"
            supportingCopy={formatSubsetBreakdown(effectiveSummaryMetrics.actionableCount, effectiveSummaryMetrics.scoredCount)}
          />
          <MetricCard
            label="Average risk"
            value={
              effectiveSummaryMetrics.averageProbability == null
                ? 'N/A'
                : formatProbabilityPercent(effectiveSummaryMetrics.averageProbability)
            }
            supportingCopy="Across all scored"
            metaTitle={effectiveSummaryMetrics.publishedAt ? 'Snapshot as of' : ''}
            metaPrimary={effectiveSummaryMetrics.publishedAt ? formatDateOnlyValue(effectiveSummaryMetrics.publishedAt) : ''}
            metaSecondary={effectiveSummaryMetrics.publishedAt ? `${formatTimeOnlyValue(effectiveSummaryMetrics.publishedAt)} GMT+8` : ''}
          />
        </div>

        <div className="dropout-dashboard__a2Layout">
          <aside className="dropout-dashboard__queuePanel" ref={queuePanelRef} style={queuePanelStyle}>
            <div className="dropout-dashboard__queueHeader">
              <div>
                <h4 className="mt-0">Risk-ranked patient queue</h4>
              </div>
              <span className="metric-pill">{loadedRowsLabel}</span>
            </div>

            <input
              type="text"
              className="dropout-dashboard__search"
              placeholder="Search patients, IDs, or email"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSnapshotPage(1);
              }}
            />

            <div className="dropout-dashboard__queueControls">
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
            </div>

            <div className="dropout-dashboard__queueList">
              {visibleRows.length ? (
                visibleRows.map((entry, index) => {
                  const isSelected = entry.userId === activeEntry?.userId;
                  const absoluteRank = (effectiveSnapshotPage - 1) * snapshotPageSize + index + 1;
                  return (
                    <QueueRow
                      key={entry.userId}
                      entry={entry}
                      rank={absoluteRank}
                      isSelected={isSelected}
                      onSelect={() => setSelectedUserId(entry.userId)}
                    />
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

            <div className="dropout-dashboard__queueFooter">
              <span>
                {filteredRows.length
                  ? `${(effectiveSnapshotPage - 1) * snapshotPageSize + 1}-${Math.min(effectiveSnapshotPage * snapshotPageSize, filteredRows.length)} of ${filteredRows.length}`
                  : '0 results'}
              </span>
            </div>
          </aside>

          <section className="dropout-dashboard__workspacePanel">
            {activeEntry ? (
              <>
                <div className="dropout-dashboard__briefTopRow">
                  <CurrentRiskBriefCard
                    entry={activeEntry}
                    trendData={activeTrendData}
                    onOpenPatient={openPatientRoster}
                    canOpenPatient={Boolean(activeEntry.patient)}
                  />
                  <ModelContractBriefCard entry={activeEntry} />
                </div>

                <div className="dropout-dashboard__highlightGrid">
                  <HighlightSummaryCard
                    title="Risk change since last publish"
                    icon="trend"
                    accent="trend"
                    badge={explainabilityRiskChangeSummary ? formatRiskChangeDirectionLabel(activeExplainabilityPayload?.risk_change_direction) : 'Pending'}
                    badgeTone={getRiskChangeDirectionTone(activeExplainabilityPayload?.risk_change_direction)}
                    summary={riskChangeHighlightSummary}
                    items={riskChangeHighlightItems}
                    ctaLabel="View trend"
                    onCtaClick={() => scrollToSection(explainabilitySectionRef)}
                  />
                  <HighlightSummaryCard
                    title="Why flagged"
                    icon="target"
                    accent="flagged"
                    items={explainabilityWhyFlagged}
                    summary={whyFlaggedHighlightSummary}
                    ctaLabel="View details"
                    onCtaClick={() => scrollToSection(explainabilitySectionRef)}
                  />
                  <HighlightSummaryCard
                    title="Challenger cross-check"
                    icon="shield"
                    accent="model"
                    badge={formatHighlightBadgeText(challengerHighlightStatus)}
                    badgeTone={challengerHighlightStatus ? (String(challengerHighlightStatus).toLowerCase() === 'aligned' ? 'success' : 'default') : 'default'}
                    summary={challengerHighlightSummary}
                    items={explainabilityChallengerCrossCheck.slice(1)}
                    ctaLabel="View details"
                    onCtaClick={() => scrollToSection(explainabilitySectionRef)}
                  />
                  <HighlightSummaryCard
                    title="Data gaps affecting confidence"
                    icon="database"
                    accent="data"
                    badge={deriveDataGapBadge(explainabilityMissingInputs)}
                    badgeTone={deriveDataGapTone(explainabilityMissingInputs)}
                    summary={dataGapHighlightSummary}
                    items={explainabilityMissingInputs.slice(1)}
                    ctaLabel="View details"
                    onCtaClick={() => scrollToSection(explainabilitySectionRef)}
                  />
                </div>

                <RecentPublishTrendSection
                  rows={recentPublishHistory}
                  currentEntry={activeEntry}
                  sectionRef={trendSectionRef}
                  onViewDetailedTrend={() => scrollToSection(explainabilitySectionRef)}
                />

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

                <InterventionTimelineSection
                  caseEntry={displayedInterventionCase}
                  isPreparing={isPreparingInterventionCase}
                  canUseCaseLoop={canUseInterventionCaseLoop}
                  canMutate={canMutateInterventionCase}
                  canClose={canCloseInterventionCase}
                  isUpdating={isUpdatingInterventionCase}
                  actionValue={interventionCaseActionValue}
                  resultValue={interventionCaseResultValue}
                  proxyStatusValue={interventionCaseProxyStatusValue}
                  lifecycleStatusValue={interventionCaseStatusValue}
                  closeReasonValue={interventionCaseCloseReasonValue}
                  recentCases={recentInterventionCases}
                  onAction={(actionTaken) => handleInterventionCaseMutation({ actionTaken })}
                  onResult={(manualResult) => handleInterventionCaseMutation({ manualResult })}
                  onClose={handleInterventionCaseClose}
                  errorMessage={interventionCaseError || (openInterventionCaseCount > 1
                    ? 'More than one open intervention case is visible for this patient. The CRC UI will keep updating only the most recent open case until the data is cleaned up.'
                    : '')}
                  mutationError={interventionCaseMutationError}
                  sectionRef={interventionSectionRef}
                />
              </>
            ) : (
              <div className="empty-panel">Select a ranked patient to inspect the current disengagement snapshot.</div>
            )}
          </section>
        </div>

        {activeEntry ? (
          <>
            {isEarlyHistorySnapshot(activeEntry) ? (
              <div className="info-banner section-note--spaced">{buildEarlyHistorySummary(activeEntry)}</div>
            ) : null}

            <details className="dropout-dashboard__legacyContext">
              <summary>
                <strong>Legacy operational context</strong>
              </summary>
              <div className="dropout-dashboard__legacyGrid">
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
              </div>
            </details>

            <section ref={explainabilitySectionRef} className="dropout-dashboard__detailedExplainability">
              <div className="dropout-dashboard__detailedHeader">
                <div>
                  <h3 className="mt-0">Explainability Summary <span className="dropout-dashboard__inlineQualifier">(detailed)</span></h3>
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
                  <div className="dropout-dashboard__detailedGrid">
                    {visibleDetailedExplainabilitySections.map((renderSection, index) =>
                      renderSection({ className: getDetailedGridClassName(index) })
                    )}
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
            </section>
          </>
        ) : null}
      </>
    );
  })();

  return <div className="dropout-board-root intelligence-card--dropout">{content}</div>;
}
