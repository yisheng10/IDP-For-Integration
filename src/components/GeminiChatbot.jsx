import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import ReactMarkdown from 'react-markdown';
import { db } from '../firebase';
import {
  CRC_GUIDANCE_TRACE_STREAM_ENABLED,
  SIDE_EFFECT_GUIDANCE_MODEL,
  SIDE_EFFECT_GUIDANCE_PROVIDER,
} from '../config';
import { SAFETY_INSTRUCTIONS } from '../safetyInstructions';
import { routeGuidanceRequest } from '../services/guidanceRouterService';
import {
  requestSideEffectGuidance,
  requestSideEffectGuidanceTraceStream,
} from '../services/sideEffectGuidanceService';

const CRC_AI_NAME = 'Adverse Event Guidance';
const CHAT_HISTORY_LIMIT = 100;
const CONTEXT_WINDOW_LIMIT = 50;
const TRACE_HISTORY_LIMIT = 20;
const TRACE_EVENT_LIMIT = 100;

function buildThinkingLabel(step, options = {}) {
  const ctcaeCount = Number(options.ctcaeCount) || 0;
  const protocolCount = Number(options.protocolCount) || 0;
  const routeDecision = String(options.routeDecision || '');

  switch (step) {
    case 'context':
      return 'Reading patient context';
    case 'route':
      return 'Deciding whether retrieval is needed';
    case 'retrieval-scoped':
      return 'Searching CTCAE and the active protocol';
    case 'retrieval-global':
      return 'Searching the guidance library';
    case 'retrieval-cache':
      return 'Reusing recent grounded excerpts';
    case 'draft':
      if (routeDecision === 'skip') {
        return 'Drafting without retrieval';
      }
      return `Drafting grounded answer (CTCAE ${ctcaeCount}, protocol ${protocolCount})`;
    default:
      return 'Thinking';
  }
}

function buildProviderUserMessage(error) {
  if (error?.message) {
    return error.message;
  }

  return 'AI Error. Adverse Event Guidance is unavailable right now.';
}

function serializeForPrompt(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function sortByRecentTimestamp(entries = [], keys = []) {
  return [...entries].sort((left, right) => {
    const leftTime =
      keys.map((key) => new Date(left?.[key] || 0).getTime()).find((value) => value > 0) || 0;
    const rightTime =
      keys.map((key) => new Date(right?.[key] || 0).getTime()).find((value) => value > 0) || 0;
    return rightTime - leftTime;
  });
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getMostRelevantTimestamp(entry = {}, keys = []) {
  return keys
    .map((key) => String(entry?.[key] || '').trim())
    .find((value) => value && !Number.isNaN(new Date(value).getTime())) || null;
}

function getTimestampMs(entry = {}, keys = []) {
  const timestamp = getMostRelevantTimestamp(entry, keys);
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getAlertDocumentPath(alert = {}) {
  return String(
    alert?.ref?.path ||
      alert?.path ||
      alert?.alert_path ||
      alert?.sourcePath ||
      ''
  ).trim();
}

function normalizeEventKeyForGuidance(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getAlertOperationalState(alert = {}) {
  const status = normalizeText(alert.status);
  const type = normalizeText(alert.type);

  if (type === 'message') {
    return 'direct_message_thread';
  }

  if (status === 'unread' || status === 'open' || status === 'active') {
    return 'active';
  }

  if (alert.ae_clinical_status === 'resolved' || alert.ae_resolved_at) {
    return 'resolved';
  }

  if (status === 'read' || status === 'closed' || status === 'documented' || alert.threadClosed) {
    return 'documented_ongoing';
  }

  return 'unknown';
}

function getIncidentOperationalState(incident = {}) {
  const status = normalizeText(incident.status || 'open');
  if (
    incident.ae_clinical_status === 'resolved' ||
    incident.ae_resolved_at ||
    status === 'ae_resolved' ||
    status === 'documented_resolved' ||
    status === 'resolved'
  ) {
    return 'resolved';
  }
  if (
    incident.ae_documentation_status === 'documented' ||
    incident.ae_documented_at ||
    status === 'documented'
  ) {
    return 'documented_ongoing';
  }
  if (status === 'open' || status === 'unread' || status === 'active' || status === 'closed' || status === 'read') {
    return 'active';
  }
  return 'unknown';
}

function findResolvedIncidentCoveringAlert(alert = {}, incidents = []) {
  const alertPath = getAlertDocumentPath(alert);
  const sourceIncidentId = String(alert.source_incident_id || '').trim();
  const alertEventKeys = [
    alert.reason,
    alert.symptom_title,
    alert.event_title,
    alert.message,
  ]
    .map((value) => normalizeEventKeyForGuidance(value))
    .filter(Boolean);
  const alertTime = getTimestampMs(alert, ['timestamp', 'updated_at', 'created_at']);

  return incidents.find((incident) => {
    if (incident.operational_state !== 'resolved') {
      return false;
    }

    if (sourceIncidentId && incident.id === sourceIncidentId) {
      return true;
    }

    const linkedPaths = Array.isArray(incident.linked_alert_paths) ? incident.linked_alert_paths : [];
    if (alertPath && linkedPaths.includes(alertPath)) {
      return true;
    }

    const incidentEventKeys = [
      incident.event_key,
      incident.event_title,
      incident.reason,
    ]
      .map((value) => normalizeEventKeyForGuidance(value))
      .filter(Boolean);
    const resolvedTime = getTimestampMs(incident, ['ae_resolved_at', 'resolved_at', 'resolvedAt', 'updated_at']);

    return Boolean(
      alertTime &&
        resolvedTime &&
        alertTime <= resolvedTime &&
        alertEventKeys.some((key) => incidentEventKeys.includes(key))
    );
  }) || null;
}

function buildEmergencyAeResolutionStatus({ alerts = [], incidents = [], audienceRole = 'crc' }) {
  const isPatientAudience = audienceRole === 'patient';
  const aeIncidents = (Array.isArray(incidents) ? incidents : []).map((incident) => {
    const operationalState = getIncidentOperationalState(incident);
    return {
      id: incident.id || null,
      event_key: incident.event_key || null,
      event_title: incident.event_title || incident.reason || null,
      incident_type: incident.incident_type || null,
      severity: incident.severity || null,
      status: incident.status || null,
      ae_documentation_status: incident.ae_documentation_status || null,
      ae_documented_at: incident.ae_documented_at || null,
      ae_clinical_status: incident.ae_clinical_status || null,
      ae_resolved_at: incident.ae_resolved_at || null,
      operational_state: operationalState,
      is_current_active: operationalState === 'active' || operationalState === 'documented_ongoing',
      resolved_at: incident.ae_resolved_at || incident.resolved_at || incident.resolvedAt || null,
      last_event_at: getMostRelevantTimestamp(incident, ['updated_at', 'last_event_at', 'created_at']),
      ...(isPatientAudience
        ? {}
        : {
            resolved_by: incident.resolved_by_name || incident.resolvedByName || incident.resolved_by || null,
            linked_alert_paths: incident.linked_alert_paths || [],
            linked_report_count: Array.isArray(incident.linked_reports) ? incident.linked_reports.length : 0,
          }),
    };
  });

  const aeAlerts = (Array.isArray(alerts) ? alerts : [])
    .filter((alert) => normalizeText(alert?.type) !== 'message')
    .map((alert) => {
      const resolvedIncident = findResolvedIncidentCoveringAlert(alert, aeIncidents);
      const rawOperationalState = getAlertOperationalState(alert);
      const operationalState = resolvedIncident ? 'resolved' : rawOperationalState;
      return {
        id: alert.id || null,
        type: alert.type || null,
        reason: alert.reason || alert.symptom_title || alert.event_title || null,
        raw_status: alert.status || null,
        operational_state: operationalState,
        is_current_active: operationalState === 'active' || operationalState === 'documented_ongoing',
        resolved_at: alert.ae_resolved_at || alert.resolvedAt || alert.resolved_at || null,
        operational_state_reason: resolvedIncident
          ? 'The alert is covered by a linked or event-matched resolved incident, so it is treated as historical even if the raw alert status is still unread.'
          : null,
        thread_closed: Boolean(alert.threadClosed),
        last_event_at: getMostRelevantTimestamp(alert, ['timestamp', 'updated_at', 'created_at']),
        last_sender: alert.lastSender || alert.senderRole || null,
        latest_message: alert.message || null,
        ...(isPatientAudience
          ? {}
          : {
              path: getAlertDocumentPath(alert) || null,
              resolved_by_incident_id: resolvedIncident?.id || null,
            }),
      };
    });

  const activeAlerts = aeAlerts.filter((alert) => alert.is_current_active);
  const activeIncidents = aeIncidents.filter((incident) => incident.is_current_active);

  return {
    interpretation_rule:
      'Use this section before describing an emergency or adverse event as current, active, unresolved, or ongoing. operational_state is the source of truth. Items with operational_state "resolved" are clinically resolved. Items with operational_state "documented_ongoing" are CRC-documented but not clinically resolved, so do not describe them as recovered.',
    active_emergency_or_ae_count: activeAlerts.length + activeIncidents.length,
    resolved_emergency_or_ae_count:
      aeAlerts.filter((alert) => alert.operational_state === 'resolved').length +
      aeIncidents.filter((incident) => incident.operational_state === 'resolved').length,
    has_current_active_emergency_or_ae: activeAlerts.length + activeIncidents.length > 0,
    vital_sign_records_have_direct_resolution_state: false,
    vital_sign_note:
      'Vitals are measurement history. A vital value is only an active AE/emergency if a linked active alert or incident remains unresolved.',
    active_alerts: activeAlerts,
    resolved_alerts: aeAlerts.filter((alert) => alert.operational_state === 'resolved'),
    active_incidents: activeIncidents,
    resolved_incidents: aeIncidents.filter((incident) => incident.operational_state === 'resolved'),
    documented_ongoing_items: [
      ...aeAlerts.filter((alert) => alert.operational_state === 'documented_ongoing'),
      ...aeIncidents.filter((incident) => incident.operational_state === 'documented_ongoing'),
    ],
    unknown_status_items: [
      ...aeAlerts.filter((alert) => alert.operational_state === 'unknown'),
      ...aeIncidents.filter((incident) => incident.operational_state === 'unknown'),
    ],
  };
}

function coerceChatTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return Number.isNaN(converted?.getTime?.()) ? null : converted;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildCalendarDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfCalendarDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatWhatsappStyleTime(date) {
  return date
    .toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace('AM', 'am')
    .replace('PM', 'pm');
}

function formatWhatsappStyleDayLabel(date, now = new Date()) {
  const messageDay = startOfCalendarDay(date);
  const currentDay = startOfCalendarDay(now);
  const diffInDays = Math.floor((currentDay.getTime() - messageDay.getTime()) / 86400000);

  if (diffInDays <= 3) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function buildTraceHistoryOptionLabel(traceSummary = {}) {
  const timestamp =
    coerceChatTimestamp(traceSummary?.completedAt) || coerceChatTimestamp(traceSummary?.startedAt);
  const timestampLabel = timestamp
    ? `${formatWhatsappStyleDayLabel(timestamp)} · ${formatWhatsappStyleTime(timestamp)}`
    : 'Saved trace';
  const question = String(traceSummary?.questionText || '')
    .trim()
    .replace(/\s+/g, ' ');
  const questionPreview = question
    ? question.length > 78
      ? `${question.slice(0, 75)}...`
      : question
    : 'Saved adverse event guidance turn';
  return `${timestampLabel} — ${questionPreview}`;
}

function buildGuidanceTimeline(messages = []) {
  const items = [];
  let lastDayKey = null;
  const now = new Date();

  messages.forEach((message, index) => {
    const timestamp = coerceChatTimestamp(message?.timestamp);
    const dayKey = timestamp ? buildCalendarDateKey(timestamp) : null;

    if (dayKey && dayKey !== lastDayKey) {
      items.push({
        type: 'date-separator',
        key: `separator-${dayKey}`,
        label: formatWhatsappStyleDayLabel(timestamp, now),
      });
      lastDayKey = dayKey;
    }

    items.push({
      type: 'message',
      key: message.id || `message-${index}`,
      message,
      timestamp,
      timeLabel: timestamp ? formatWhatsappStyleTime(timestamp) : '',
    });
  });

  return items;
}

function buildTraceKey(patientUid, traceId) {
  const safePatientUid = String(patientUid || '').trim();
  const safeTraceId = String(traceId || '').trim();
  if (!safePatientUid || !safeTraceId) return '';
  return `${safePatientUid}:${safeTraceId}`;
}

function normalizeTraceDetailLines(details = []) {
  if (!Array.isArray(details)) return [];
  return details
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeTraceSourceExcerpts(sourceExcerpts = []) {
  if (!Array.isArray(sourceExcerpts)) return [];
  return sourceExcerpts
    .map((entry) => ({
      sourceType: String(entry?.sourceType || '').trim() || 'source',
      documentTitle: String(entry?.documentTitle || '').trim() || 'Source',
      citationLabel: String(entry?.citationLabel || '').trim() || 'Source',
      excerptText: String(entry?.excerptText || '').trim(),
      relevanceReason: String(entry?.relevanceReason || '').trim(),
    }))
    .filter((entry) => entry.excerptText);
}

function normalizeTraceEvent(entry = {}) {
  return {
    type: String(entry?.type || '').trim(),
    stepKey: String(entry?.stepKey || '').trim(),
    title: String(entry?.title || '').trim() || 'Trace event',
    summary: String(entry?.summary || '').trim() || 'No summary available.',
    details: normalizeTraceDetailLines(entry?.details),
    status: String(entry?.status || 'completed').trim(),
    sourceExcerpts: normalizeTraceSourceExcerpts(entry?.sourceExcerpts),
    meta: entry?.meta && typeof entry.meta === 'object' ? entry.meta : {},
    seq: Number.isFinite(Number(entry?.seq)) ? Number(entry.seq) : 0,
    timestamp: entry?.timestamp || null,
  };
}

function normalizeTraceSummary(entry = {}) {
  const explicitPersisted = entry?.persisted;
  const isPendingTrace =
    explicitPersisted == null &&
    (entry?.loading === true || String(entry?.traceStatus || '').toLowerCase() === 'in_progress');

  return {
    traceId: String(entry?.traceId || '').trim() || null,
    sessionId: String(entry?.sessionId || '').trim() || null,
    patientUid: String(entry?.patientUid || '').trim() || null,
    subjectId: String(entry?.subjectId || '').trim() || null,
    questionText: String(entry?.questionText || '').trim() || '',
    finalAnswerText: String(entry?.finalAnswerText || '').trim() || '',
    provider: String(entry?.provider || '').trim() || '',
    model: String(entry?.model || '').trim() || '',
    sourceMask: String(entry?.sourceMask || '').trim() || 'none',
    retrievalUsed: Boolean(entry?.retrievalUsed),
    protocolId: String(entry?.protocolId || '').trim() || null,
    protocolName: String(entry?.protocolName || '').trim() || null,
    traceStatus: String(entry?.traceStatus || 'completed').trim() || 'completed',
    displaySummary: String(entry?.displaySummary || '').trim() || '',
    latestStepTitle: String(entry?.latestStepTitle || '').trim() || 'Trace',
    completedAt: entry?.completedAt || null,
    startedAt: entry?.startedAt || null,
    traceRecordPath: String(entry?.traceRecordPath || '').trim() || null,
    persisted: isPendingTrace
      ? null
      : explicitPersisted == null
        ? Boolean(entry?.traceRecordPath)
        : Boolean(explicitPersisted),
  };
}

function buildTraceRef(summary = {}) {
  const normalized = normalizeTraceSummary(summary);
  if (!normalized.traceId || !normalized.patientUid) {
    return null;
  }

  return {
    traceId: normalized.traceId,
    patientUid: normalized.patientUid,
    subjectId: normalized.subjectId,
    sourceMask: normalized.sourceMask,
    displaySummary: normalized.displaySummary,
    latestStepTitle: normalized.latestStepTitle,
    traceRecordPath: normalized.traceRecordPath,
    persisted: normalized.persisted,
  };
}

function buildStableSystemPrompt(aiName, role = 'crc') {
  if (role === 'patient') {
    return [
      `You are ${aiName}.`,
      'Role: patient-facing TrialLight safety assistant.',
      'The current user is the patient. Speak directly to the patient in clear, calm language.',
      'Use the directly injected patient context as the live source of truth.',
      'You may explain whether the patient currently has active AE/emergency items, which safety events are CRC-documented, and which events are clinically resolved.',
      'Do not expose CRC-only or internal operational details, including internal prediction scores, prioritization labels, staff workflow recommendations, CRC ownership or routing, staff resolver identity, linked record paths, patient-id lists, report-linkage details, source-system metadata, rule snapshots, internal notes, or explanation-signal details.',
      'Do not present yourself as a diagnosis service or autonomous emergency care. TrialLight chat is a support and documentation layer and does not replace direct emergency escalation.',
      'Before describing an emergency or adverse event as current, active, unresolved, or ongoing, check the injected EMERGENCY / AE OPERATIONAL STATUS section. operational_state is the source of truth.',
      'If an item is listed as operational_state "documented_ongoing", explain that CRC has documented or handled it, but do not say the patient has clinically recovered.',
      'If an unread raw alert is listed there as operational_state "resolved" because it is covered by a clinically resolved incident, do not call it active. Explain it as a historical clinically resolved event if relevant.',
      'Treat vital sign records as measurements, not as resolved/unresolved cases by themselves. A vital value is only a current active AE/emergency if a linked active alert or incident remains unresolved.',
      'If the patient describes severe or worsening symptoms, advise them to use the study emergency number or local emergency services immediately.',
      '',
      '=== SAFETY & RULES ===',
      SAFETY_INSTRUCTIONS,
    ].join('\n');
  }

  return [
    `You are ${aiName}.`,
    'Role: CRC Copilot for the CRC workspace.',
    'The current user is always a Clinical Research Coordinator (CRC).',
    'You only operate inside the CRC website.',
    'Use the directly injected workspace context and patient context as the live source of truth.',
    'Do not treat the CRC as the patient.',
    'Do not expose dropout model internals to the patient side.',
    'Use retrieved CTCAE and protocol excerpts as the only cited source material for clinical or protocol claims.',
    'If protocol excerpts are missing, say protocol grounding was not retrieved.',
    'Before describing an emergency or adverse event as current, active, unresolved, or ongoing, check the injected EMERGENCY / AE OPERATIONAL STATUS section. Treat documented_ongoing as CRC-documented but not clinically resolved.',
    'Only operational_state "resolved" means clinically resolved. Do not treat documented, read, closed, or threadClosed by themselves as clinical recovery.',
    'If an unread raw alert is listed there as operational_state "resolved" because it is covered by a clinically resolved incident, do not call it active. Mention it only as stale or historical operational data if relevant.',
    'Treat vital sign records as measurements, not as resolved/unresolved cases by themselves. If abnormal vitals are historical and no linked active alert or incident remains open, say that clearly.',
    '',
    '=== SAFETY & RULES ===',
    SAFETY_INSTRUCTIONS,
  ].join('\n');
}

function buildPatientContextText({
  profile,
  patientSnapshot,
  vitals,
  appointments,
  alerts,
  eproEntries,
  incidents,
  protocol,
  audienceRole = 'crc',
}) {
  const isPatientAudience = audienceRole === 'patient';
  const emergencyAeResolutionStatus = buildEmergencyAeResolutionStatus({
    alerts,
    incidents,
    audienceRole,
  });
  const promptAlerts = isPatientAudience
    ? (Array.isArray(alerts) ? alerts : []).map((alert) => ({
        id: alert.id || null,
        type: alert.type || null,
        reason: alert.reason || null,
        message: alert.message || null,
        status: alert.status || null,
        ae_documentation_status: alert.ae_documentation_status || null,
        ae_documented_at: alert.ae_documented_at || null,
        ae_clinical_status: alert.ae_clinical_status || null,
        ae_resolved_at: alert.ae_resolved_at || null,
        timestamp: alert.timestamp || null,
        threadClosed: Boolean(alert.threadClosed),
        resolvedAt: alert.resolvedAt || alert.resolved_at || null,
        lastSender: alert.lastSender || alert.senderRole || null,
        source_incident_id: alert.source_incident_id || null,
      }))
    : alerts;
  const promptIncidents = isPatientAudience
    ? (Array.isArray(incidents) ? incidents : []).map((incident) => ({
        id: incident.id || null,
        event_key: incident.event_key || null,
        event_title: incident.event_title || incident.reason || null,
        incident_type: incident.incident_type || null,
        severity: incident.severity || null,
        status: incident.status || null,
        ae_documentation_status: incident.ae_documentation_status || null,
        ae_documented_at: incident.ae_documented_at || null,
        ae_clinical_status: incident.ae_clinical_status || null,
        ae_resolved_at: incident.ae_resolved_at || null,
        created_at: incident.created_at || null,
        updated_at: incident.updated_at || null,
        resolved_at: incident.resolved_at || incident.resolvedAt || null,
      }))
    : incidents;

  return [
    '=== PATIENT PROFILE ===',
    serializeForPrompt(profile),
    '=== ACTIVE PATIENT SNAPSHOT ===',
    serializeForPrompt(patientSnapshot),
    '=== VITALS ===',
    serializeForPrompt(vitals),
    '=== APPOINTMENTS ===',
    serializeForPrompt(appointments),
    '=== EMERGENCY / AE OPERATIONAL STATUS (CHECK BEFORE SAYING CURRENT/ONGOING) ===',
    serializeForPrompt(emergencyAeResolutionStatus),
    '=== ALERT HISTORY ===',
    serializeForPrompt(promptAlerts),
    '=== EPRO SUBMISSIONS ===',
    serializeForPrompt(eproEntries),
    '=== INCIDENT RECORDS ===',
    serializeForPrompt(promptIncidents),
    '=== ACTIVE PROTOCOL ===',
    serializeForPrompt(protocol),
  ].join('\n\n');
}

function buildWorkspaceContextText({
  patients,
  urgentAlerts,
  alerts,
  eproEntries,
  incidents,
  selectedPatient,
}) {
  return [
    '=== SELECTED PATIENT ===',
    serializeForPrompt(selectedPatient),
    '=== CRC PATIENT ROSTER WINDOW ===',
    serializeForPrompt(patients),
    '=== URGENT ALERTS ===',
    serializeForPrompt(urgentAlerts),
    '=== ALERT HISTORY WINDOW ===',
    serializeForPrompt(alerts),
    '=== EPRO WINDOW ===',
    serializeForPrompt(eproEntries),
    '=== INCIDENT WINDOW ===',
    serializeForPrompt(incidents),
  ].join('\n\n');
}

export default function GeminiChatbot({
  role = 'crc',
  userId,
  userNickname = '',
  patientData,
  patientVitals = [],
  patientAppointments = [],
  patientAlerts = [],
  patientEproEntries = [],
  patientIncidents = [],
  activeProtocolId = null,
  activeProtocolName = null,
  onEmergencyTrigger,
  allPatients = [],
  workspaceAlerts = [],
  workspaceUrgentAlerts = [],
  workspaceEproEntries = [],
  workspaceIncidents = [],
  protocolUrl,
  presentation = 'floating',
  titleOverride,
  panelDescription,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [activeContextPatient, setActiveContextPatient] = useState(null);
  const [thinkingLabel, setThinkingLabel] = useState('');
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [runtimeMeta, setRuntimeMeta] = useState({
    provider: SIDE_EFFECT_GUIDANCE_PROVIDER,
    model: SIDE_EFFECT_GUIDANCE_MODEL,
  });
  const [activeTrace, setActiveTrace] = useState(null);
  const [expandedTraceKeys, setExpandedTraceKeys] = useState({});
  const [traceDetailCache, setTraceDetailCache] = useState({});
  const [traceHistory, setTraceHistory] = useState([]);
  const [traceHistoryLoading, setTraceHistoryLoading] = useState(false);
  const [selectedHistoryTraceKey, setSelectedHistoryTraceKey] = useState('');
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  const chatAreaRef = useRef(null);
  const chatSessionRef = useRef(null);
  const pendingOutputAutoScrollRef = useRef(false);
  const systemPromptRef = useRef('');
  const lastRetrievalRef = useRef(null);
  const lastRetrievalTurnIndexRef = useRef(0);
  const turnSequenceRef = useRef(0);
  const chatSessionIdRef = useRef('');

  const isDocked = presentation === 'docked';
  const chatVisible = isDocked || isOpen;
  const currentAiName = titleOverride || CRC_AI_NAME;
  const currentTracePatient = activeContextPatient || patientData || null;
  const historyCollectionRef = useMemo(
    () => (userId ? collection(db, 'users', userId, 'ai_chat_history') : null),
    [userId]
  );
  const traceHistoryCollectionRef = useMemo(
    () =>
      currentTracePatient?.id
        ? collection(db, 'users', currentTracePatient.id, 'guidance_traces')
        : null,
    [currentTracePatient?.id]
  );
  const workspaceContextText = useMemo(
    () =>
      buildWorkspaceContextText({
        patients: allPatients,
        urgentAlerts: workspaceUrgentAlerts,
        alerts: workspaceAlerts,
        eproEntries: workspaceEproEntries,
        incidents: workspaceIncidents,
        selectedPatient: patientData,
    }),
    [allPatients, patientData, workspaceAlerts, workspaceEproEntries, workspaceIncidents, workspaceUrgentAlerts]
  );
  const chatTimeline = useMemo(() => buildGuidanceTimeline(messages), [messages]);

  const saveMessage = useCallback(async (messageRole, text, extraPayload = {}) => {
    if (!historyCollectionRef || !text) return;

    try {
      await addDoc(historyCollectionRef, {
        role: messageRole,
        text,
        timestamp: serverTimestamp(),
        ...(extraPayload && typeof extraPayload === 'object' ? extraPayload : {}),
      });
    } catch (error) {
      console.error('Failed to save AI history:', error);
    }
  }, [historyCollectionRef]);

  const loadTraceEvents = useCallback(async (traceRef) => {
    const traceId = String(traceRef?.traceId || '').trim();
    const patientUid = String(traceRef?.patientUid || '').trim();
    if (!traceId || !patientUid) {
      return null;
    }

    const traceKey = buildTraceKey(patientUid, traceId);
    if (!traceKey) {
      return null;
    }

    if (traceDetailCache[traceKey]) {
      return traceDetailCache[traceKey];
    }

    const traceSummaryRef = doc(db, 'users', patientUid, 'guidance_traces', traceId);
    const [traceSummarySnapshot, traceEventsSnapshot] = await Promise.all([
      getDoc(traceSummaryRef),
      getDocs(
        query(
          collection(db, 'users', patientUid, 'guidance_traces', traceId, 'events'),
          orderBy('seq', 'asc'),
          limit(TRACE_EVENT_LIMIT)
        )
      ),
    ]);

    const traceSummary = traceSummarySnapshot.exists()
      ? normalizeTraceSummary({
          traceId,
          patientUid,
          ...traceSummarySnapshot.data(),
        })
      : normalizeTraceSummary({
          traceId,
          patientUid,
          ...traceRef,
        });

    const traceDetail = {
      ...traceSummary,
      events: traceEventsSnapshot.docs.map((entry) => normalizeTraceEvent(entry.data())),
    };

    setTraceDetailCache((previous) => ({
      ...previous,
      [traceKey]: traceDetail,
    }));

    return traceDetail;
  }, [traceDetailCache]);

  const toggleTraceExpanded = useCallback(async (traceRef) => {
    const traceKey = buildTraceKey(traceRef?.patientUid, traceRef?.traceId);
    if (!traceKey) return;

    const isCurrentlyExpanded = Boolean(expandedTraceKeys[traceKey]);
    setExpandedTraceKeys((previous) => ({
      ...previous,
      [traceKey]: !isCurrentlyExpanded,
    }));

    if (!isCurrentlyExpanded && traceRef?.persisted !== false) {
      try {
        await loadTraceEvents(traceRef);
      } catch (error) {
        console.error('Failed to load trace events:', error);
      }
    }
  }, [expandedTraceKeys, loadTraceEvents]);

  const initializeGuidance = useCallback(async () => {
    try {
      if (!['crc', 'patient'].includes(role)) {
        throw new Error('Adverse Event Guidance is restricted to TrialLight CRC or patient users.');
      }

      systemPromptRef.current = buildStableSystemPrompt(currentAiName, role);
      chatSessionRef.current = true;
      if (!chatSessionIdRef.current) {
        chatSessionIdRef.current = `${role}-guidance-${userId || 'unknown'}-${Date.now()}`;
      }

      if (messages.length === 0) {
        await saveMessage(
          'model',
          role === 'patient'
            ? `**${currentAiName} ready.**\nI can help explain your TrialLight safety status using the current patient-facing record.`
            : `**${currentAiName} ready.**\nRunning through ${SIDE_EFFECT_GUIDANCE_PROVIDER} with ${SIDE_EFFECT_GUIDANCE_MODEL}. I can use routed retrieval with CTCAE and protocol grounding when needed.`
        );
      }
    } catch (error) {
      console.error('AI initialization failed:', error);
    }
  }, [currentAiName, messages.length, role, saveMessage, userId]);

  useEffect(() => {
    if (!historyCollectionRef) return undefined;

    const historyQuery = query(
      historyCollectionRef,
      orderBy('timestamp', 'desc'),
      limit(CHAT_HISTORY_LIMIT)
    );
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const nextMessages = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).reverse();
      setMessages(nextMessages);
      setIsHistoryLoaded(true);
    });

    return () => unsubscribe();
  }, [historyCollectionRef]);

  useEffect(() => {
    if (patientData) {
      setActiveContextPatient(patientData);
    } else {
      setActiveContextPatient(null);
    }
  }, [patientData]);

  useEffect(() => {
    setSelectedHistoryTraceKey('');
  }, [currentTracePatient?.id]);

  useEffect(() => {
    lastRetrievalRef.current = null;
    lastRetrievalTurnIndexRef.current = 0;
    turnSequenceRef.current = 0;
    chatSessionIdRef.current = '';
    setActiveTrace(null);
    setTraceHistory([]);
    setSelectedHistoryTraceKey('');
  }, [userId]);

  useEffect(() => {
    if (chatVisible && userId && isHistoryLoaded && !chatSessionRef.current) {
      initializeGuidance();
    }
  }, [activeProtocolId, activeProtocolName, chatVisible, initializeGuidance, isHistoryLoaded, protocolUrl, userId]);

  useEffect(() => {
    if (!activeTrace?.traceId || !activeTrace?.patientUid) {
      return;
    }

    const matchingMessage = messages.find(
      (message) =>
        message?.guidanceTrace?.traceId === activeTrace.traceId &&
        message?.guidanceTrace?.patientUid === activeTrace.patientUid
    );

    if (matchingMessage) {
      setActiveTrace(null);
    }
  }, [activeTrace, messages]);

  useEffect(() => {
    if (!chatVisible || !traceHistoryCollectionRef) {
      if (!traceHistoryCollectionRef) {
        setTraceHistory([]);
        setSelectedHistoryTraceKey('');
      }
      return;
    }

    let cancelled = false;
    const loadHistory = async () => {
      setTraceHistoryLoading(true);
      try {
        const snapshot = await getDocs(
          query(traceHistoryCollectionRef, orderBy('completedAt', 'desc'), limit(TRACE_HISTORY_LIMIT))
        );

        if (cancelled) {
          return;
        }

        const nextHistory = snapshot.docs.map((entry) =>
          normalizeTraceSummary({
            traceId: entry.id,
            patientUid: currentTracePatient?.id || null,
            ...entry.data(),
          })
        );

        setTraceHistory(nextHistory);
      } catch (error) {
        console.error('Failed to load patient guidance trace history:', error);
        if (!cancelled) {
          setTraceHistory([]);
        }
      } finally {
        if (!cancelled) {
          setTraceHistoryLoading(false);
        }
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [chatVisible, currentTracePatient?.id, historyRefreshToken, traceHistoryCollectionRef]);

  useEffect(() => {
    if (!chatVisible || !pendingOutputAutoScrollRef.current || !chatAreaRef.current) {
      return;
    }

    const latestMessage = messages[messages.length - 1];
    if (!latestMessage || latestMessage.role !== 'model') {
      return;
    }

    const chatArea = chatAreaRef.current;
    const timer = window.setTimeout(() => {
      chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: 'smooth',
      });
      pendingOutputAutoScrollRef.current = false;
      setShowJumpToBottom(false);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [chatVisible, messages]);

  useEffect(() => {
    if (!chatVisible || !chatAreaRef.current) {
      return;
    }

    const chatArea = chatAreaRef.current;
    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    setShowJumpToBottom(distanceFromBottom > 120);
  }, [chatVisible, isLoading, messages]);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      chatSessionRef.current = null;
      systemPromptRef.current = '';
      lastRetrievalRef.current = null;
      lastRetrievalTurnIndexRef.current = 0;
      turnSequenceRef.current = 0;
      await initializeGuidance();
      await saveMessage('system', '**AI memory refreshed.** Latest CRC guidance context is active.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Clear chat history?') || !historyCollectionRef) return;

    setIsLoading(true);
    try {
      const snapshot = await getDocs(
        query(historyCollectionRef, orderBy('timestamp', 'desc'), limit(CHAT_HISTORY_LIMIT))
      );
      const batch = writeBatch(db);
      snapshot.docs.forEach((entry) => batch.delete(entry.ref));
      await batch.commit();
      setMessages([]);
      chatSessionRef.current = null;
      systemPromptRef.current = '';
      lastRetrievalRef.current = null;
      lastRetrievalTurnIndexRef.current = 0;
      turnSequenceRef.current = 0;
      await initializeGuidance();
    } catch (error) {
      console.error('Failed to clear chat history:', error);
      window.alert('Failed to clear chat history.');
    } finally {
      setIsLoading(false);
    }
  };

  const detectPatientInInput = (text) => {
    if (!allPatients.length) return null;

    const lowerText = String(text || '').toLowerCase();
    const sortedPatients = [...allPatients].sort(
      (left, right) => (right.nickname?.length || 0) - (left.nickname?.length || 0)
    );

    return (
      sortedPatients.find((patient) => {
        const name = String(patient.nickname || '').toLowerCase();
        return name && name.length > 2 && lowerText.includes(name);
      }) || null
    );
  };

  const loadPatientPromptContext = async (targetPatient) => {
    if (!targetPatient?.id) {
      return {
        patientId: null,
        patientName: 'No active patient',
        subjectId: null,
        protocolId: null,
        protocolName: null,
        promptText: 'No single patient is selected. Use the CRC workspace context for workspace-level questions.',
      };
    }

    const isSelectedPatient = patientData?.id === targetPatient.id;

    if (isSelectedPatient) {
      const protocol = {
        protocolId: activeProtocolId || patientData?.protocolId || null,
        protocolName: activeProtocolName || patientData?.protocolName || null,
        protocolUrl: protocolUrl || patientData?.protocolUrl || null,
        protocolStatus: patientData?.protocolStatus || null,
      };

      return {
        patientId: patientData?.id || targetPatient.id,
        patientName: patientData?.nickname || targetPatient.nickname || targetPatient.id,
        subjectId: patientData?.subject_id || patientData?.subjectId || targetPatient.id,
        protocolId: protocol.protocolId,
        protocolName: protocol.protocolName,
        promptText: buildPatientContextText({
          profile: patientData,
          patientSnapshot: patientData,
          vitals: patientVitals,
          appointments: patientAppointments,
          alerts: patientAlerts,
          eproEntries: patientEproEntries,
          incidents: patientIncidents,
          protocol,
          audienceRole: role,
        }),
      };
    }

    const profileSnapshot = await getDoc(doc(db, 'users', targetPatient.id));
    const profile = profileSnapshot.exists()
      ? { id: targetPatient.id, ...profileSnapshot.data() }
      : { id: targetPatient.id, ...targetPatient };

    const [vitalsSnapshot, appointmentsSnapshot, alertsSnapshot, eproSnapshot, incidentSnapshot] =
      await Promise.all([
        getDocs(
          query(
            collection(db, 'users', targetPatient.id, 'vitals'),
            orderBy('timestamp', 'desc'),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
        getDocs(
          query(
            collection(db, 'users', targetPatient.id, 'appointments'),
            orderBy('datetime', 'asc'),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
        getDocs(
          query(
            collection(db, 'users', targetPatient.id, 'alerts'),
            orderBy('timestamp', 'desc'),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
        getDocs(query(collection(db, 'users', targetPatient.id, 'epro_submissions'), limit(CONTEXT_WINDOW_LIMIT))),
        getDocs(
          query(
            collection(db, 'incident_records'),
            where('linked_patient_ids', 'array-contains', targetPatient.id),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
      ]);

    const vitals = vitalsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const appointments = appointmentsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const alerts = alertsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const eproEntries = sortByRecentTimestamp(
      eproSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      ['submitted_at', 'updated_at', 'assigned_at']
    );
    const incidents = sortByRecentTimestamp(
      incidentSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      ['updated_at', 'created_at']
    );

    const protocol = {
      protocolId: profile.protocolId || null,
      protocolName: profile.protocolName || null,
      protocolUrl: profile.protocolUrl || null,
      protocolStatus: profile.protocolStatus || null,
    };

    return {
      patientId: profile.id || targetPatient.id,
      patientName: profile.nickname || targetPatient.nickname || targetPatient.id,
      subjectId: profile.subject_id || profile.subjectId || profile.id || targetPatient.id,
      protocolId: protocol.protocolId,
      protocolName: protocol.protocolName,
      promptText: buildPatientContextText({
        profile,
        patientSnapshot: targetPatient,
        vitals,
        appointments,
        alerts,
        eproEntries,
        incidents,
        protocol,
        audienceRole: role,
      }),
    };
  };

  const handleSend = async (event) => {
    if (event) event.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!chatSessionRef.current) {
      await initializeGuidance();
    }
    if (!chatSessionRef.current) return;

    const userText = input.trim();
    turnSequenceRef.current += 1;
    setInput('');
    setIsLoading(true);
    setThinkingLabel(buildThinkingLabel('context'));
    pendingOutputAutoScrollRef.current = true;
    setActiveTrace(null);
    await saveMessage('user', userText);

    try {
      const mentionedPatient = detectPatientInInput(userText);
      const targetPatient = mentionedPatient || activeContextPatient || patientData || null;
      if (mentionedPatient) {
        setActiveContextPatient(mentionedPatient);
      }

      const patientContext = await loadPatientPromptContext(targetPatient);
      setThinkingLabel(buildThinkingLabel('route'));

      const routedGuidance = await routeGuidanceRequest({
        userText,
        workspaceContext: role === 'crc' ? workspaceContextText : '',
        patientContext: patientContext.promptText,
        patientId: patientContext.patientId,
        protocolId: patientContext.protocolId,
        protocolName: patientContext.protocolName,
        hasPatientContext: Boolean(patientContext.patientId),
        historyMessages: messages,
        retrievalCache: lastRetrievalRef.current,
        currentTurnIndex: turnSequenceRef.current,
        lastRetrievalTurnIndex: lastRetrievalTurnIndexRef.current,
        audienceRole: role,
        onStageChange: (stage) => {
          setThinkingLabel(buildThinkingLabel(stage));
        },
      });

      setThinkingLabel(
        buildThinkingLabel('draft', {
          ctcaeCount: routedGuidance.ctcaeCount,
          protocolCount: routedGuidance.protocolCount,
          routeDecision: routedGuidance.routeDecision,
        })
      );

      const conversation = messages
        .filter((message) => message.role === 'user' || message.role === 'model')
        .map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: message.text,
        }));
      let finalAnswerText = '';
      let finalAnswerProvider = SIDE_EFFECT_GUIDANCE_PROVIDER;
      let finalAnswerModel = SIDE_EFFECT_GUIDANCE_MODEL;
      let finalTraceSummary = null;
      let streamedTraceEventCount = 0;
      let streamedTraceEvents = [];

      const sharedTracePayload = {
        sessionId:
          chatSessionIdRef.current || `${role}-guidance-${userId || 'unknown'}-${Date.now()}`,
        systemPrompt: systemPromptRef.current,
        messages: conversation,
        originalUserText: userText,
        routedPrompt: routedGuidance.prompt,
        routeDecision: routedGuidance.routeDecision,
        routeReason: routedGuidance.routeReason,
        sourceMask: routedGuidance.sourceMask || 'none',
        usedCache: routedGuidance.usedCache,
        ctcaeChunks: routedGuidance.ctcaeChunks,
        protocolChunks: routedGuidance.protocolChunks,
        patientUid: patientContext.patientId,
        patientName: patientContext.patientName,
        subjectId: patientContext.subjectId,
        protocolId: patientContext.protocolId,
        protocolName: patientContext.protocolName,
        crcDisplayName: role === 'crc' ? userNickname || '' : '',
      };

      const startTraceState = () => {
        const pendingTraceId = `${sharedTracePayload.sessionId}-pending`;
        const pendingPatientUid = patientContext.patientId || 'ephemeral';
        setExpandedTraceKeys((previous) => ({
          ...previous,
          [buildTraceKey(pendingPatientUid, pendingTraceId)]: true,
        }));
        setActiveTrace({
          traceId: pendingTraceId,
          sessionId: sharedTracePayload.sessionId,
          patientUid: pendingPatientUid,
          patientName: patientContext.patientName,
          subjectId: patientContext.subjectId,
          sourceMask: sharedTracePayload.sourceMask,
          events: [],
          finalAnswerText: '',
          displaySummary: '',
          latestStepTitle: 'Thinking',
          persisted: null,
          traceRecordPath: null,
          error: '',
          loading: true,
        });
      };

      const applyTraceEvent = (traceEvent) => {
        const normalizedTraceEvent = normalizeTraceEvent(traceEvent);
        streamedTraceEventCount += 1;
        const liveTraceKey = buildTraceKey(
          traceEvent?.patientUid || patientContext.patientId || 'ephemeral',
          traceEvent?.traceId || `${sharedTracePayload.sessionId}-pending`
        );
        if (liveTraceKey) {
          setExpandedTraceKeys((previous) => ({
            ...previous,
            [liveTraceKey]: true,
          }));
        }
        setThinkingLabel(normalizedTraceEvent.summary || normalizedTraceEvent.title || 'Thinking');
        streamedTraceEvents = [...streamedTraceEvents, normalizedTraceEvent];
        setActiveTrace((previous) => {
          const nextEvents = [...(previous?.events || []), normalizedTraceEvent];
          return {
            ...(previous || {}),
            traceId: traceEvent?.traceId || previous?.traceId || null,
            sessionId: traceEvent?.sessionId || previous?.sessionId || sharedTracePayload.sessionId,
            patientUid: traceEvent?.patientUid || previous?.patientUid || patientContext.patientId,
            subjectId: traceEvent?.subjectId || previous?.subjectId || patientContext.subjectId,
            sourceMask: traceEvent?.meta?.sourceMask || previous?.sourceMask || sharedTracePayload.sourceMask,
            events: nextEvents,
            latestStepTitle: normalizedTraceEvent.title,
            displaySummary: normalizedTraceEvent.summary || previous?.displaySummary || '',
            loading: normalizedTraceEvent.stepKey !== 'trace_failed',
          };
        });
      };

      const saveStreamedModelMessage = async () => {
        const traceRef = buildTraceRef(finalTraceSummary || {});
        const shouldAttachPersistedTrace = Boolean(traceRef?.traceId && traceRef?.patientUid && traceRef?.persisted);

        if (shouldAttachPersistedTrace) {
          const traceKey = buildTraceKey(traceRef.patientUid, traceRef.traceId);
          if (traceKey) {
            setTraceDetailCache((previous) => ({
              ...previous,
              [traceKey]: {
                ...normalizeTraceSummary({
                  ...(finalTraceSummary || {}),
                  traceId: traceRef.traceId,
                  patientUid: traceRef.patientUid,
                }),
                events: streamedTraceEvents,
              },
            }));
          }
        }

        await saveMessage(
          'model',
          finalAnswerText,
          shouldAttachPersistedTrace ? { guidanceTrace: traceRef } : {}
        );

        if (!shouldAttachPersistedTrace) {
          setActiveTrace((previous) =>
            previous
              ? {
                  ...previous,
                  finalAnswerText: '',
                  loading: false,
                }
              : previous
          );
        }
      };

      if (CRC_GUIDANCE_TRACE_STREAM_ENABLED) {
        startTraceState();

        try {
          await requestSideEffectGuidanceTraceStream(sharedTracePayload, {
            onTraceEvent: (traceEvent) => {
              applyTraceEvent(traceEvent);
            },
            onFinalAnswer: (finalAnswerEvent) => {
              finalAnswerText = String(finalAnswerEvent?.text || '').trim();
              finalAnswerProvider = finalAnswerEvent?.provider || SIDE_EFFECT_GUIDANCE_PROVIDER;
              finalAnswerModel = finalAnswerEvent?.model || SIDE_EFFECT_GUIDANCE_MODEL;
              setRuntimeMeta({
                provider: finalAnswerProvider,
                model: finalAnswerModel,
              });
              setActiveTrace((previous) => ({
                ...(previous || {}),
                traceId: finalAnswerEvent?.traceId || previous?.traceId || null,
                finalAnswerText,
              }));
            },
            onTraceComplete: (traceCompleteEvent) => {
              finalTraceSummary = normalizeTraceSummary(traceCompleteEvent?.traceSummary || {});
              const completedTraceKey = buildTraceKey(
                finalTraceSummary.patientUid || patientContext.patientId,
                finalTraceSummary.traceId
              );
              if (completedTraceKey) {
                setExpandedTraceKeys((previous) => ({
                  ...previous,
                  [completedTraceKey]: true,
                }));
              }
              setActiveTrace((previous) => ({
                ...(previous || {}),
                traceId: finalTraceSummary.traceId || previous?.traceId || null,
                sessionId: finalTraceSummary.sessionId || previous?.sessionId || sharedTracePayload.sessionId,
                patientUid: finalTraceSummary.patientUid || previous?.patientUid || patientContext.patientId,
                subjectId: finalTraceSummary.subjectId || previous?.subjectId || patientContext.subjectId,
                displaySummary:
                  finalTraceSummary.displaySummary || previous?.displaySummary || '',
                latestStepTitle:
                  finalTraceSummary.latestStepTitle || previous?.latestStepTitle || 'Trace',
                persisted: Boolean(traceCompleteEvent?.persisted),
                traceRecordPath: finalTraceSummary.traceRecordPath || null,
                loading: false,
              }));
            },
            onTraceError: (traceErrorEvent) => {
              setActiveTrace((previous) => ({
                ...(previous || {}),
                traceId: traceErrorEvent?.traceId || previous?.traceId || null,
                error: String(traceErrorEvent?.message || '').trim(),
                loading: false,
              }));
            },
          });
        } catch (streamError) {
          if (streamedTraceEventCount > 0) {
            throw streamError;
          }

          const fallbackResponse = await requestSideEffectGuidance({
            provider: SIDE_EFFECT_GUIDANCE_PROVIDER,
            systemPrompt: systemPromptRef.current,
            messages: conversation,
            userMessage: routedGuidance.prompt,
          });

          finalAnswerText = fallbackResponse.text;
          finalAnswerProvider = fallbackResponse.provider || SIDE_EFFECT_GUIDANCE_PROVIDER;
          finalAnswerModel = fallbackResponse.model || SIDE_EFFECT_GUIDANCE_MODEL;
          setRuntimeMeta({
            provider: finalAnswerProvider,
            model: finalAnswerModel,
          });
          setActiveTrace(null);
        }
      } else {
        const fallbackResponse = await requestSideEffectGuidance({
          provider: SIDE_EFFECT_GUIDANCE_PROVIDER,
          systemPrompt: systemPromptRef.current,
          messages: conversation,
          userMessage: routedGuidance.prompt,
        });

        finalAnswerText = fallbackResponse.text;
        finalAnswerProvider = fallbackResponse.provider || SIDE_EFFECT_GUIDANCE_PROVIDER;
        finalAnswerModel = fallbackResponse.model || SIDE_EFFECT_GUIDANCE_MODEL;
        setRuntimeMeta({
          provider: finalAnswerProvider,
          model: finalAnswerModel,
        });
      }

      if (!finalAnswerText) {
      throw new Error('AI Error. Adverse Event Guidance did not return a final answer.');
      }

      const emergencyMatch = finalAnswerText.match(/\*\*\*EMERGENCY: (.*?)\*\*\*/);
      if (emergencyMatch && onEmergencyTrigger) {
        onEmergencyTrigger(emergencyMatch[1].trim());
      }

      await saveStreamedModelMessage();

      if (finalTraceSummary?.patientUid) {
        setHistoryRefreshToken((previous) => previous + 1);
      }

      if (routedGuidance.routeDecision === 'retrieve' && routedGuidance.nextRetrievalCache) {
        lastRetrievalRef.current = routedGuidance.nextRetrievalCache;
        lastRetrievalTurnIndexRef.current = turnSequenceRef.current;
      } else if (routedGuidance.routeDecision === 'reuse_cache' && lastRetrievalRef.current) {
        lastRetrievalTurnIndexRef.current = turnSequenceRef.current;
      }
    } catch (error) {
      console.error('AI chat request failed:', error);
      await saveMessage('model', buildProviderUserMessage(error));
      chatSessionRef.current = null;
    } finally {
      setIsLoading(false);
      setThinkingLabel('');
    }
  };

  const updateJumpToBottomState = () => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    setShowJumpToBottom(distanceFromBottom > 120);
  };

  const handleChatAreaManualInteraction = () => {
    pendingOutputAutoScrollRef.current = false;
    updateJumpToBottomState();
  };

  const handleJumpToBottom = () => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: 'smooth',
    });
    pendingOutputAutoScrollRef.current = false;
    setShowJumpToBottom(false);
  };

  const handleHistoryTraceSelect = useCallback(async (traceSummary) => {
    const traceRef = buildTraceRef(traceSummary);
    const traceKey = buildTraceKey(traceRef?.patientUid, traceRef?.traceId);
    if (!traceKey) return;

    setSelectedHistoryTraceKey(traceKey);

    if (traceRef && traceRef.persisted !== false) {
      try {
        await loadTraceEvents(traceRef);
      } catch (error) {
        console.error('Failed to load historical trace detail:', error);
      }
    }
  }, [loadTraceEvents]);

  const handleHistoryTraceChange = useCallback(async (event) => {
    const nextTraceKey = String(event.target.value || '');
    if (!nextTraceKey) {
      setSelectedHistoryTraceKey('');
      return;
    }

    const nextTrace = traceHistory.find((traceSummary) => {
      const traceRef = buildTraceRef(traceSummary);
      return buildTraceKey(traceRef?.patientUid, traceRef?.traceId) === nextTraceKey;
    });

    if (!nextTrace) {
      setSelectedHistoryTraceKey('');
      return;
    }

    await handleHistoryTraceSelect(nextTrace);
  }, [traceHistory, handleHistoryTraceSelect]);

  const renderTraceEventCard = (traceEvent, eventIndex) => (
    <div key={`${traceEvent.stepKey}-${traceEvent.seq}-${eventIndex}`} style={styles.traceEventCard}>
      <div style={styles.traceEventHeader}>
        <div>
          <div style={styles.traceEventTitle}>{traceEvent.title}</div>
          <div style={styles.traceEventSummary}>{traceEvent.summary}</div>
        </div>
        <span style={styles.traceEventStatus}>
          {traceEvent.status === 'started' ? 'Live' : 'Done'}
        </span>
      </div>
      {traceEvent.details.length ? (
        <ul style={styles.traceDetailList}>
          {traceEvent.details.map((detail, detailIndex) => (
            <li key={`${traceEvent.seq}-detail-${detailIndex}`}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {traceEvent.sourceExcerpts.length ? (
        <div style={styles.traceExcerptList}>
          {traceEvent.sourceExcerpts.map((excerpt, excerptIndex) => (
            <div key={`${traceEvent.seq}-excerpt-${excerptIndex}`} style={styles.traceExcerptCard}>
              <div style={styles.traceExcerptHeader}>
                <span style={styles.traceExcerptChip}>{excerpt.sourceType.toUpperCase()}</span>
                <span style={styles.traceExcerptCitation}>{excerpt.citationLabel}</span>
              </div>
              <div style={styles.traceExcerptText}>{excerpt.excerptText}</div>
              {excerpt.relevanceReason ? (
                <div style={styles.traceExcerptReason}>{excerpt.relevanceReason}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  const renderTracePanel = (traceRef, { label = 'Detailed reasoning trace' } = {}) => {
    const traceKey = buildTraceKey(traceRef?.patientUid, traceRef?.traceId);
    if (!traceKey) return null;

    const isExpanded = Boolean(expandedTraceKeys[traceKey]);
    const cachedTraceDetail = traceDetailCache[traceKey];
    const traceEvents = cachedTraceDetail?.events || traceRef?.events || [];
    const traceSummary = normalizeTraceSummary({
      ...traceRef,
      ...(cachedTraceDetail || {}),
    });
    const saveStatusLabel =
      traceSummary.persisted == null
        ? 'Save status pending'
        : traceSummary.persisted
          ? 'Saved'
          : 'Not saved';

    return (
      <div style={styles.tracePanel}>
        <button
          type="button"
          style={styles.traceToggleButton}
          onClick={() => toggleTraceExpanded(traceRef)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
            <span style={styles.traceToggleTitle}>{label}</span>
            <span style={styles.traceToggleSummary}>
              {traceSummary.displaySummary || traceSummary.latestStepTitle || 'Open trace'}
            </span>
          </div>
          <span style={styles.traceToggleCaret}>{isExpanded ? 'Hide' : 'Show'}</span>
        </button>
        {isExpanded ? (
          <div style={styles.tracePanelBody}>
            <div style={styles.traceMetaRow}>
              <span>Source mask: {traceSummary.sourceMask || 'none'}</span>
              <span>{saveStatusLabel}</span>
            </div>
            {traceEvents.length ? (
              <div style={styles.traceEventList}>
                {traceEvents
                  .filter((traceEvent) => traceEvent.type === 'trace_event')
                  .map((traceEvent, eventIndex) => renderTraceEventCard(traceEvent, eventIndex))}
              </div>
            ) : (
              <div style={styles.traceEmptyState}>
                {traceSummary.persisted == null
                  ? 'The reasoning trace is still running. Save status will be shown after completion.'
                  : traceSummary.persisted === false
                  ? 'This answer did not save a patient-linked trace.'
                  : 'Trace details are loading or were not available.'}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const currentHistoryTraceDetail = selectedHistoryTraceKey
    ? traceDetailCache[selectedHistoryTraceKey] || null
    : null;

  const historyPanel = isDocked ? (
    <section style={styles.traceHistorySection}>
      <div style={styles.traceHistoryHeader}>
        <div>
          <div style={styles.traceHistoryTitle}>Patient AI Adverse Event History</div>
        </div>
        <span style={styles.traceHistoryBadge}>
          {currentTracePatient?.nickname || 'No patient selected'}
        </span>
      </div>
      {!currentTracePatient?.id ? (
        <div style={styles.traceEmptyState}>
          Select or mention a patient to review patient-linked adverse event guidance traces.
        </div>
      ) : traceHistoryLoading ? (
        <div style={styles.traceEmptyState}>Loading saved guidance traces…</div>
      ) : !traceHistory.length ? (
        <div style={styles.traceEmptyState}>
          No saved patient-linked adverse event guidance turns were found for this patient yet.
        </div>
      ) : (
        <>
        <div style={styles.traceHistoryControls}>
          <label style={styles.traceHistorySelectField}>
            <select
              value={selectedHistoryTraceKey}
              onChange={handleHistoryTraceChange}
                style={styles.traceHistorySelect}
              >
                <option value="">Select a saved adverse event guidance turn...</option>
                {traceHistory.map((traceSummary) => {
                  const traceRef = buildTraceRef(traceSummary);
                  const traceKey = buildTraceKey(traceRef?.patientUid, traceRef?.traceId);

                  return (
                    <option key={traceKey} value={traceKey}>
                      {buildTraceHistoryOptionLabel(traceSummary)}
                    </option>
                  );
                })}
            </select>
          </label>
          <div style={styles.traceHistoryCountBadge}>
              {traceHistory.length} turn{traceHistory.length === 1 ? '' : 's'}
          </div>
        </div>

          {currentHistoryTraceDetail ? (
            <div style={styles.traceHistoryDetail}>
              <div style={styles.traceHistoryDetailHeader}>
                <div style={styles.traceHistoryDetailTitle}>
                  {currentHistoryTraceDetail.displaySummary || 'Saved adverse event reasoning trace'}
                </div>
                <div style={styles.traceHistoryDetailMeta}>
                  Subject: {currentHistoryTraceDetail.subjectId || 'Unknown'} | Source mask:{' '}
                  {currentHistoryTraceDetail.sourceMask || 'none'}
                </div>
              </div>
              {currentHistoryTraceDetail.finalAnswerText ? (
                <div style={styles.traceHistoryAnswerCard}>
                  <ReactMarkdown>{currentHistoryTraceDetail.finalAnswerText}</ReactMarkdown>
                </div>
              ) : null}
              <div style={styles.traceEventList}>
                {currentHistoryTraceDetail.events
                  .filter((traceEvent) => traceEvent.type === 'trace_event')
                  .map((traceEvent, eventIndex) => renderTraceEventCard(traceEvent, eventIndex))}
              </div>
            </div>
          ) : selectedHistoryTraceKey ? (
            <div style={styles.traceEmptyState}>Loading the saved reasoning trace...</div>
          ) : null}
        </>
      )}
    </section>
  ) : null;

  if (!chatVisible) {
    return (
      <button onClick={() => setIsOpen(true)} style={styles.fab}>
        <span style={styles.fabText}>{currentAiName}</span>
      </button>
    );
  }

  const headerBlock = (
    <div className={isDocked ? 'guidance-panel__header' : ''} style={isDocked ? undefined : styles.header}>
      <div
        className={isDocked ? 'guidance-panel__headerCopy' : ''}
        style={isDocked ? undefined : { display: 'flex', flexDirection: 'column', gap: '4px' }}
      >
        <span className={isDocked ? 'guidance-panel__title' : ''} style={isDocked ? undefined : styles.title}>
          {currentAiName}
        </span>
        {panelDescription ? <span className="guidance-panel__description">{panelDescription}</span> : null}
        <span className={isDocked ? 'guidance-panel__context' : ''} style={isDocked ? undefined : styles.secondaryLine}>
          Active context: <strong>{activeContextPatient?.nickname || 'No patient selected'}</strong>
        </span>
        <span className={isDocked ? 'guidance-panel__runtime' : ''} style={isDocked ? undefined : styles.runtimeInfo}>
          Runtime: <strong>{String(runtimeMeta.provider || SIDE_EFFECT_GUIDANCE_PROVIDER).toUpperCase()}</strong> using{' '}
          <strong>{runtimeMeta.model || SIDE_EFFECT_GUIDANCE_MODEL}</strong>
        </span>
      </div>

      <div
        className={isDocked ? 'guidance-panel__actions' : ''}
        style={isDocked ? undefined : { display: 'flex', alignItems: 'center', gap: '10px' }}
      >
        <button onClick={handleRefresh} style={styles.iconButton} title="Refresh AI data">
          Refresh
        </button>
        <button onClick={handleClearHistory} style={styles.iconButton} title="Clear chat history">
          Clear
        </button>
        {!isDocked ? (
          <button onClick={() => setIsOpen(false)} style={styles.iconButton}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );

  const messagesBlock = (
    <div className={isDocked ? 'guidance-panel__chatShell' : ''} style={isDocked ? undefined : styles.chatShell}>
      <div
        ref={chatAreaRef}
        className={isDocked ? 'guidance-panel__chatArea' : ''}
        style={isDocked ? undefined : styles.chatArea}
        onScroll={updateJumpToBottomState}
        onWheel={handleChatAreaManualInteraction}
        onTouchStart={handleChatAreaManualInteraction}
        onPointerDown={handleChatAreaManualInteraction}
      >
        {chatTimeline.map((entry, index) => {
          if (entry.type === 'date-separator') {
            return (
              <div key={entry.key} className="guidance-panel__dateRow">
                <span className="guidance-panel__dateBadge">{entry.label}</span>
              </div>
            );
          }

          const message = entry.message;
          const messageTraceRef = buildTraceRef(message?.guidanceTrace || {});
          return (
            <div
              key={entry.key || index}
              className={isDocked ? `guidance-panel__messageRow guidance-panel__messageRow--${message.role}` : ''}
              style={
                isDocked
                  ? undefined
                  : {
                      ...styles.messageRow,
                      justifyContent:
                        message.role === 'user'
                          ? 'flex-end'
                          : message.role === 'system'
                            ? 'center'
                            : 'flex-start',
                    }
              }
            >
              {message.role === 'system' ? (
                <small
                  className={isDocked ? 'guidance-panel__systemMessage' : ''}
                  style={isDocked ? undefined : styles.systemMessage}
                >
                  <ReactMarkdown>{message.text}</ReactMarkdown>
                </small>
              ) : (
                <div
                  className={
                    isDocked
                      ? `guidance-panel__bubble ${message.role === 'user' ? 'guidance-panel__bubble--user' : 'guidance-panel__bubble--model'}`
                      : ''
                  }
                  style={
                    isDocked
                      ? undefined
                      : {
                          ...styles.bubble,
                          backgroundColor: message.role === 'user' ? '#0f609b' : '#f8fbff',
                          color: message.role === 'user' ? 'white' : '#243b53',
                          border: message.role === 'user' ? 'none' : '1px solid #dbe5f0',
                        }
                  }
                >
                  <div className="guidance-panel__bubbleContent">
                    {message.role === 'model' ? <ReactMarkdown>{message.text}</ReactMarkdown> : message.text}
                  </div>
                  {message.role === 'model' && messageTraceRef ? renderTracePanel(messageTraceRef) : null}
                  {entry.timeLabel ? (
                    <div
                      className={`guidance-panel__bubbleTimestamp guidance-panel__bubbleTimestamp--${message.role}`}
                    >
                      {entry.timeLabel}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
        {activeTrace ? (
          <div
            className={isDocked ? 'guidance-panel__messageRow guidance-panel__messageRow--model' : ''}
            style={
              isDocked
                ? undefined
                : {
                    ...styles.messageRow,
                    justifyContent: 'flex-start',
                  }
            }
          >
            <div
              className={isDocked ? 'guidance-panel__bubble guidance-panel__bubble--model' : ''}
              style={
                isDocked
                  ? undefined
                  : {
                      ...styles.bubble,
                      backgroundColor: '#f8fbff',
                      color: '#243b53',
                      border: '1px solid #dbe5f0',
                    }
              }
            >
              {!activeTrace.loading && activeTrace.finalAnswerText ? (
                <div className="guidance-panel__bubbleContent">
                  <ReactMarkdown>{activeTrace.finalAnswerText}</ReactMarkdown>
                </div>
              ) : null}
              {renderTracePanel(
                {
                  traceId: activeTrace.traceId,
                  patientUid: activeTrace.patientUid,
                  subjectId: activeTrace.subjectId,
                  sourceMask: activeTrace.sourceMask,
                  displaySummary: activeTrace.displaySummary,
                  latestStepTitle: activeTrace.latestStepTitle,
                  traceRecordPath: activeTrace.traceRecordPath,
                  persisted: activeTrace.persisted,
                  events: activeTrace.events,
                },
                {
                  label: activeTrace.loading ? 'Live reasoning trace' : 'Latest reasoning trace',
                }
              )}
              {activeTrace.error ? (
                <div style={styles.traceErrorText}>{activeTrace.error}</div>
              ) : null}
            </div>
          </div>
        ) : null}
        {isLoading ? (
          <div className={isDocked ? 'guidance-panel__loading' : ''} style={isDocked ? undefined : styles.loadingState}>
            <span className={isDocked ? 'guidance-panel__thinkingBadge' : ''} style={isDocked ? undefined : styles.thinkingBadge}>
              Think
            </span>
            <span>{thinkingLabel || 'Thinking'}</span>
          </div>
        ) : null}
      </div>
      {showJumpToBottom ? (
        <button
          type="button"
          className={isDocked ? 'guidance-panel__jumpButton' : ''}
          style={isDocked ? undefined : styles.jumpButton}
          onClick={handleJumpToBottom}
          title="Scroll to latest"
          aria-label="Scroll to latest message"
        >
          <span
            className={isDocked ? 'guidance-panel__jumpButtonIcon' : ''}
            style={isDocked ? undefined : styles.jumpIcon}
            aria-hidden="true"
          >
            ↓
          </span>
        </button>
      ) : null}
    </div>
  );

  const dockedBodyBlock = isDocked ? (
    <div style={styles.traceWorkspaceBody}>
      {historyPanel}
      <div style={styles.traceWorkspaceChatSlot}>{messagesBlock}</div>
    </div>
  ) : null;

  const inputBlock = (
    <form
      onSubmit={handleSend}
      className={isDocked ? 'guidance-panel__inputArea' : ''}
      style={isDocked ? undefined : styles.inputArea}
    >
      <input
        type="text"
        className={isDocked ? 'guidance-panel__input' : ''}
        style={isDocked ? undefined : styles.input}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="Describe an adverse event, protocol rule, vitals concern, or follow-up action..."
      />
      <button
        type="submit"
        className={isDocked ? 'guidance-panel__sendButton' : ''}
        style={isDocked ? undefined : styles.sendButton}
        disabled={isLoading}
      >
        Send
      </button>
    </form>
  );

  if (isDocked) {
    return (
      <section className="card workspace-card intelligence-card intelligence-card--guidance">
        {headerBlock}
        {dockedBodyBlock}
        {inputBlock}
      </section>
    );
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.window}>
        {headerBlock}
        {messagesBlock}
        {inputBlock}
      </div>
    </div>
  );
}

const styles = {
  fab: {
    position: 'fixed',
    bottom: '30px',
    left: '24px',
    backgroundColor: '#0f609b',
    padding: '14px 20px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.3)',
    boxShadow: '0 16px 32px rgba(15, 96, 155, 0.35)',
    cursor: 'pointer',
    zIndex: 9999,
  },
  fabText: {
    color: 'white',
    fontWeight: '700',
    fontSize: '15px',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    zIndex: 10000,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  window: {
    width: '100%',
    maxWidth: '680px',
    height: '88%',
    backgroundColor: 'white',
    borderTopLeftRadius: '24px',
    borderTopRightRadius: '24px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 -24px 80px rgba(15, 23, 42, 0.24)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '18px 20px',
    borderBottom: '1px solid #e5edf6',
    backgroundColor: '#f8fbff',
  },
  title: {
    fontWeight: '700',
    fontSize: '18px',
    color: '#14324a',
  },
  secondaryLine: {
    fontSize: '12px',
    color: '#52606d',
  },
  runtimeInfo: {
    fontSize: '12px',
    color: '#64748b',
  },
  iconButton: {
    border: '1px solid #d7e3f0',
    background: 'white',
    color: '#0f609b',
    borderRadius: '10px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontWeight: '600',
  },
  chatShell: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
  },
  chatArea: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    backgroundColor: '#f6f9fc',
  },
  messageRow: {
    display: 'flex',
    marginBottom: '12px',
    width: '100%',
  },
  systemMessage: {
    color: '#64748b',
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '88%',
    padding: '12px 14px',
    borderRadius: '16px',
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  loadingState: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '6px',
    padding: '10px 12px',
    borderRadius: '999px',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    border: '1px solid #dbe5f0',
    color: '#52606d',
    width: 'fit-content',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
  },
  thinkingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '48px',
    height: '28px',
    padding: '0 10px',
    borderRadius: '999px',
    backgroundColor: '#e8f1fb',
    color: '#0f609b',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.02em',
  },
  jumpButton: {
    position: 'absolute',
    right: '18px',
    bottom: '18px',
    width: '54px',
    height: '54px',
    borderRadius: '999px',
    border: '1px solid rgba(15, 23, 42, 0.1)',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    color: '#ffffff',
    boxShadow: '0 14px 28px rgba(15, 23, 42, 0.24)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
    zIndex: 2,
  },
  jumpIcon: {
    fontSize: '30px',
    lineHeight: 1,
    transform: 'translateY(-1px)',
  },
  inputArea: {
    display: 'flex',
    padding: '16px 20px 20px',
    borderTop: '1px solid #e5edf6',
    backgroundColor: 'white',
    gap: '12px',
  },
  input: {
    flex: 1,
    padding: '14px 16px',
    borderRadius: '14px',
    border: '1px solid #c7d4e2',
    outline: 'none',
    fontSize: '14px',
  },
  sendButton: {
    minWidth: '84px',
    backgroundColor: '#0f609b',
    borderRadius: '14px',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    fontWeight: '700',
    padding: '0 18px',
  },
  tracePanel: {
    marginTop: '12px',
    borderTop: '1px solid #e5edf6',
    paddingTop: '12px',
  },
  traceToggleButton: {
    width: '100%',
    border: '1px solid #d7e3f0',
    background: '#f8fbff',
    borderRadius: '14px',
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
  },
  traceToggleTitle: {
    fontSize: '12px',
    fontWeight: '800',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    color: '#0f609b',
  },
  traceToggleSummary: {
    fontSize: '13px',
    color: '#35526b',
    lineHeight: 1.5,
  },
  traceToggleCaret: {
    color: '#0f609b',
    fontWeight: '700',
    whiteSpace: 'nowrap',
  },
  tracePanelBody: {
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  traceMetaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    fontSize: '12px',
    color: '#64748b',
  },
  traceEventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  traceEventCard: {
    border: '1px solid #dbe7f2',
    borderRadius: '14px',
    padding: '12px 14px',
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  traceEventHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  traceEventTitle: {
    fontSize: '13px',
    fontWeight: '800',
    color: '#153551',
  },
  traceEventSummary: {
    marginTop: '4px',
    fontSize: '13px',
    color: '#35526b',
    lineHeight: 1.55,
  },
  traceEventStatus: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#0f609b',
    background: '#e8f1fb',
    borderRadius: '999px',
    padding: '5px 9px',
    whiteSpace: 'nowrap',
  },
  traceDetailList: {
    margin: 0,
    paddingLeft: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    color: '#35526b',
    fontSize: '13px',
    lineHeight: 1.55,
  },
  traceExcerptList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  traceExcerptCard: {
    background: '#f8fbff',
    border: '1px solid #dbe7f2',
    borderRadius: '12px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  traceExcerptHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  traceExcerptChip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '58px',
    height: '24px',
    borderRadius: '999px',
    background: '#dfeefb',
    color: '#0f609b',
    fontSize: '11px',
    fontWeight: '800',
    letterSpacing: '0.02em',
  },
  traceExcerptCitation: {
    fontSize: '12px',
    color: '#4a647e',
    fontWeight: '600',
  },
  traceExcerptText: {
    fontSize: '13px',
    color: '#243b53',
    lineHeight: 1.55,
  },
  traceExcerptReason: {
    fontSize: '12px',
    color: '#52606d',
    lineHeight: 1.5,
  },
  traceEmptyState: {
    border: '1px dashed #c6d6e6',
    borderRadius: '14px',
    padding: '14px',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.55,
    background: '#fbfdff',
  },
  traceErrorText: {
    marginTop: '10px',
    color: '#a61b1b',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  traceHistorySection: {
    borderBottom: '1px solid #e5edf6',
    padding: '14px 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    background: 'linear-gradient(180deg, #fcfeff 0%, #f8fbff 100%)',
  },
  traceHistoryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
  },
  traceHistoryTitle: {
    fontSize: '14px',
    fontWeight: '800',
    color: '#153551',
  },
  traceHistorySubtitle: {
    marginTop: '4px',
    fontSize: '12px',
    color: '#64748b',
    lineHeight: 1.5,
  },
  traceHistoryBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '999px',
    padding: '6px 10px',
    background: '#edf5fb',
    color: '#0f609b',
    fontSize: '12px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
  },
  traceHistoryControls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'end',
    gap: '12px',
  },
  traceHistorySelectField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: '1 1 360px',
  },
  traceHistoryFieldLabel: {
    fontSize: '11px',
    fontWeight: '800',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#4a647e',
  },
  traceHistorySelect: {
    width: '100%',
    minHeight: '44px',
    borderRadius: '14px',
    border: '1px solid #c7d4e2',
    background: '#ffffff',
    color: '#153551',
    fontSize: '13px',
    padding: '0 14px',
    outline: 'none',
    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.04)',
  },
  traceHistoryCountBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '44px',
    padding: '0 12px',
    borderRadius: '14px',
    background: '#edf5fb',
    color: '#0f609b',
    fontSize: '12px',
    fontWeight: '800',
    whiteSpace: 'nowrap',
  },
  traceHistoryBody: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)',
    gap: '12px',
    alignItems: 'start',
  },
  traceHistoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '280px',
    overflowY: 'auto',
    paddingRight: '4px',
  },
  traceHistoryRow: {
    border: '1px solid #dbe7f2',
    borderRadius: '14px',
    background: '#ffffff',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  traceHistoryRowActive: {
    borderColor: '#0f609b',
    boxShadow: '0 0 0 1px rgba(15, 96, 155, 0.15)',
    background: '#f8fbff',
  },
  traceHistoryRowTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '8px',
    alignItems: 'center',
  },
  traceHistoryRowTime: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '700',
  },
  traceHistoryRowMask: {
    fontSize: '11px',
    color: '#0f609b',
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  traceHistoryRowQuestion: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#153551',
    lineHeight: 1.45,
  },
  traceHistoryRowSummary: {
    fontSize: '12px',
    color: '#52606d',
    lineHeight: 1.5,
  },
  traceHistoryDetail: {
    minHeight: '220px',
    border: '1px solid #dbe7f2',
    borderRadius: '16px',
    padding: '14px',
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  traceHistoryDetailHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  traceHistoryDetailTitle: {
    fontSize: '14px',
    fontWeight: '800',
    color: '#153551',
  },
  traceHistoryDetailMeta: {
    fontSize: '12px',
    color: '#64748b',
    lineHeight: 1.5,
  },
  traceHistoryAnswerCard: {
    border: '1px solid #dbe7f2',
    borderRadius: '14px',
    padding: '12px 14px',
    background: '#f8fbff',
    color: '#243b53',
    lineHeight: 1.6,
  },
  traceHistoryHintCard: {
    border: '1px dashed #c6d6e6',
    borderRadius: '14px',
    padding: '14px',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.55,
    background: '#fbfdff',
  },
  traceWorkspaceBody: {
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    overflow: 'hidden',
  },
  traceWorkspaceChatSlot: {
    minHeight: 0,
    overflow: 'hidden',
  },
};
