import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

export const SEVERITY_OPTIONS = ['mild', 'moderate', 'serious'];

const DEFAULT_NOTIFICATION_POLICY = {
  mild: {
    due_in_hours: 168,
    action_code: 'report_during_next_visit',
    instruction: 'Document at the next protocol visit.',
    notification_tier: 'routine',
  },
  moderate: {
    due_in_hours: 24,
    action_code: 'review_next_day',
    instruction: 'CRC review is due by the next day.',
    notification_tier: 'priority',
  },
  serious: {
    due_in_hours: 1,
    action_code: 'attend_within_next_hour',
    instruction: 'Immediate CRC action is required within the next hour.',
    notification_tier: 'urgent',
  },
};

const SEVERITY_RANK = {
  mild: 1,
  moderate: 2,
  serious: 3,
};

export function getDefaultNotificationPolicy() {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_POLICY));
}

export function normalizeSafetySeverity(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SEVERITY_OPTIONS.includes(normalized) ? normalized : 'moderate';
}

export function isLegacyResolvedIncident(incident = {}) {
  return String(incident?.status || '').trim().toLowerCase() === 'resolved';
}

export function isAeDocumentedIncident(incident = {}) {
  const status = String(incident?.status || '').trim().toLowerCase();
  return (
    incident?.ae_documentation_status === 'documented' ||
    Boolean(incident?.ae_documented_at) ||
    status === 'documented' ||
    status === 'documented_resolved' ||
    isLegacyResolvedIncident(incident)
  );
}

export function isAeClinicallyResolvedIncident(incident = {}) {
  const status = String(incident?.status || '').trim().toLowerCase();
  return (
    incident?.ae_clinical_status === 'resolved' ||
    Boolean(incident?.ae_resolved_at) ||
    status === 'ae_resolved' ||
    status === 'documented_resolved' ||
    isLegacyResolvedIncident(incident)
  );
}

export function deriveIncidentWorkflowStatus(incident = {}) {
  const documented = isAeDocumentedIncident(incident);
  const clinicallyResolved = isAeClinicallyResolvedIncident(incident);

  if (documented && clinicallyResolved) return 'documented_resolved';
  if (documented) return 'documented';
  if (clinicallyResolved) return 'ae_resolved';
  return 'open';
}

export function isOpenIncidentWorkflow(incident = {}) {
  return deriveIncidentWorkflowStatus(incident) === 'open';
}

export function coerceNotificationPolicy(policy = {}) {
  const normalized = getDefaultNotificationPolicy();

  for (const severity of SEVERITY_OPTIONS) {
    const incoming = policy?.[severity] || {};
    normalized[severity] = {
      ...normalized[severity],
      ...incoming,
      due_in_hours: Number.isFinite(Number(incoming.due_in_hours))
        ? Math.max(1, Number(incoming.due_in_hours))
        : normalized[severity].due_in_hours,
      action_code: String(incoming.action_code || normalized[severity].action_code),
      instruction: String(incoming.instruction || normalized[severity].instruction),
      notification_tier: String(incoming.notification_tier || normalized[severity].notification_tier),
    };
  }

  return normalized;
}

export function normalizeEventKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general-safety-event';
}

export function deriveSubjectIdFromProfile(profile = {}, userId = '') {
  return (
    profile.subject_id ||
    profile.subjectId ||
    profile.trial_subject_id ||
    profile.trialSubjectId ||
    userId
  );
}

function addHoursToIso(baseIso, hours) {
  const baseDate = baseIso ? new Date(baseIso) : new Date();
  const safeHours = Number.isFinite(Number(hours)) ? Number(hours) : 0;
  return new Date(baseDate.getTime() + safeHours * 60 * 60 * 1000).toISOString();
}

function getHigherSeverity(left = 'mild', right = 'mild') {
  return (SEVERITY_RANK[right] || 1) > (SEVERITY_RANK[left] || 1) ? right : left;
}

function getEarlierIso(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function uniqBy(items, keyBuilder) {
  const seen = new Map();
  for (const item of items.filter(Boolean)) {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) continue;
    seen.set(key, item);
  }
  return Array.from(seen.values());
}

function buildLinkedPatient(patientId, patientProfile, protocolDoc, primaryCrcId, primaryCrcName) {
  return {
    uid: patientId,
    subject_id: deriveSubjectIdFromProfile(patientProfile, patientId),
    patient_name: patientProfile.nickname || patientProfile.firstName || patientProfile.email || patientId,
    hospital_patient_id: patientProfile.hospitalPatientId || '',
    protocol_id: protocolDoc?.id || patientProfile.protocolId || null,
    protocol_name: protocolDoc?.name || patientProfile.protocolName || null,
    primary_crc_id: primaryCrcId || null,
    primary_crc_name: primaryCrcName || null,
  };
}

function buildReportLink(patientId, reportId, reportData) {
  if (!reportId) return null;

  return {
    uid: patientId,
    report_id: reportId,
    report_path: `users/${patientId}/side_effect_reports/${reportId}`,
    submitted_at: reportData.submitted_at || new Date().toISOString(),
    symptom_title: reportData.symptom_title,
    severity: reportData.severity,
    protocol_covered:
      typeof reportData.protocol_covered === 'boolean' ? reportData.protocol_covered : null,
    source_system: reportData.source_system || null,
    audit_trail: reportData.audit_trail || null,
  };
}

async function loadAssignedProtocol(patientProfile = {}) {
  if (patientProfile.protocolId) {
    const protocolSnapshot = await getDoc(doc(db, 'protocols', patientProfile.protocolId));
    if (protocolSnapshot.exists()) {
      return { id: protocolSnapshot.id, ...protocolSnapshot.data() };
    }
  }

  if (patientProfile.protocolName) {
    const protocolQuery = query(
      collection(db, 'protocols'),
      where('name', '==', patientProfile.protocolName),
      limit(1)
    );
    const protocolSnapshot = await getDocs(protocolQuery);
    if (!protocolSnapshot.empty) {
      const firstDoc = protocolSnapshot.docs[0];
      return { id: firstDoc.id, ...firstDoc.data() };
    }
  }

  return null;
}

export async function loadPatientSafetyProfile(userId) {
  const patientSnapshot = await getDoc(doc(db, 'users', userId));
  if (!patientSnapshot.exists()) {
    throw new Error('Patient profile not found.');
  }

  const patientProfile = patientSnapshot.data();
  const protocolDoc = await loadAssignedProtocol(patientProfile);

  return {
    patientId: userId,
    patientProfile,
    protocolDoc,
  };
}

async function findMatchingOpenIncident(primaryCrcId, eventKey) {
  if (!primaryCrcId || !eventKey) return null;

  const incidentQuery = query(
    collection(db, 'incident_records'),
    where('primary_crc_id', '==', primaryCrcId),
    where('event_key', '==', eventKey),
    limit(10)
  );
  const incidentSnapshot = await getDocs(incidentQuery);

  const candidates = incidentSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((incident) => !isAeClinicallyResolvedIncident(incident))
    .sort((left, right) => {
      const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightTime - leftTime;
    });

  return candidates[0] || null;
}

function buildRoutingSnapshot(policy, severity, immediateHelpRequested, protocolDoc) {
  const normalizedSeverity = normalizeSafetySeverity(severity);
  const notificationPolicy = coerceNotificationPolicy(policy);
  const protocolRule = notificationPolicy[normalizedSeverity];
  const dueAt = addHoursToIso(new Date().toISOString(), protocolRule.due_in_hours);
  const incidentType =
    immediateHelpRequested || normalizedSeverity === 'serious' ? 'emergency' : 'side_effect';

  return {
    incident_type: incidentType,
    urgency: protocolRule.notification_tier,
    due_at: dueAt,
    protocol_rule_snapshot: {
      severity: normalizedSeverity,
      ...protocolRule,
    },
    protocol_snapshot: protocolDoc
      ? {
          protocol_id: protocolDoc.id,
          protocol_name: protocolDoc.name || null,
          notification_policy: notificationPolicy,
        }
      : {
          protocol_id: null,
          protocol_name: null,
          notification_policy: notificationPolicy,
        },
  };
}

export async function upsertSafetyIncident({
  patientId,
  patientProfile,
  protocolDoc,
  eventTitle,
  eventKey,
  severity,
  details,
  onsetAt,
  immediateHelpRequested = false,
  sourceSystem,
  linkedReport,
  linkedAlertPath,
  incidentTypeOverride,
}) {
  const nowIso = new Date().toISOString();
  const primaryCrcId =
    patientProfile.primary_crc_id ||
    patientProfile.primaryCrcId ||
    patientProfile.assigned_crc_id ||
    null;
  const primaryCrcName =
    patientProfile.primary_crc_name ||
    patientProfile.primaryCrcName ||
    patientProfile.assigned_crc_name ||
    null;
  const linkedPatient = buildLinkedPatient(
    patientId,
    patientProfile,
    protocolDoc,
    primaryCrcId,
    primaryCrcName
  );
  const normalizedSeverity = normalizeSafetySeverity(severity);
  const routingSnapshot = buildRoutingSnapshot(
    protocolDoc?.notification_policy,
    normalizedSeverity,
    immediateHelpRequested,
    protocolDoc
  );
  const finalIncidentType = incidentTypeOverride || routingSnapshot.incident_type;
  const finalEventKey = eventKey || normalizeEventKey(eventTitle);
  const matchedIncident = await findMatchingOpenIncident(primaryCrcId, finalEventKey);

  if (matchedIncident) {
    const mergedPatients = uniqBy(
      [...(matchedIncident.linked_patients || []), linkedPatient],
      (item) => item.uid
    );
    const mergedReports = uniqBy(
      [...(matchedIncident.linked_reports || []), linkedReport],
      (item) => item?.report_path
    );
    const mergedAlertPaths = uniqBy(
      [...(matchedIncident.linked_alert_paths || []), linkedAlertPath],
      (item) => item
    );
    const updatedSeverity = getHigherSeverity(matchedIncident.severity, normalizedSeverity);
    const updatedDueAt = getEarlierIso(matchedIncident.due_at, routingSnapshot.due_at);

    const updatePayload = {
      updated_at: nowIso,
      last_event_at: nowIso,
      incident_type: finalIncidentType,
      severity: updatedSeverity,
      urgency: routingSnapshot.urgency,
      due_at: updatedDueAt,
      event_title: eventTitle,
      details_preview: details || matchedIncident.details_preview || '',
      onset_at: onsetAt || matchedIncident.onset_at || nowIso,
      immediate_help_requested:
        Boolean(immediateHelpRequested) || Boolean(matchedIncident.immediate_help_requested),
      protocol_rule_snapshot: routingSnapshot.protocol_rule_snapshot,
      protocol_snapshot: routingSnapshot.protocol_snapshot,
      linked_patients: mergedPatients,
      linked_patient_ids: mergedPatients.map((item) => item.uid),
      linked_reports: mergedReports,
      linked_alert_paths: mergedAlertPaths,
      latest_source_system: sourceSystem || matchedIncident.latest_source_system || 'unknown',
      source_systems: uniqBy(
        [...(matchedIncident.source_systems || []), sourceSystem],
        (item) => item
      ),
      compare_ready: mergedPatients.length > 1,
      patient_count: mergedPatients.length,
      report_count: mergedReports.length,
    };
    updatePayload.status = deriveIncidentWorkflowStatus({
      ...matchedIncident,
      ...updatePayload,
    });

    await updateDoc(doc(db, 'incident_records', matchedIncident.id), updatePayload);

    return {
      id: matchedIncident.id,
      ...matchedIncident,
      ...updatePayload,
    };
  }

  const incidentPayload = {
    incident_type: finalIncidentType,
    event_key: finalEventKey,
    event_title: eventTitle,
    severity: normalizedSeverity,
    urgency: routingSnapshot.urgency,
    status: 'open',
    ae_documentation_status: 'pending',
    ae_clinical_status: 'ongoing',
    created_at: nowIso,
    updated_at: nowIso,
    last_event_at: nowIso,
    due_at: routingSnapshot.due_at,
    onset_at: onsetAt || nowIso,
    immediate_help_requested: Boolean(immediateHelpRequested),
    details_preview: details || '',
    primary_crc_id: primaryCrcId,
    primary_crc_name: primaryCrcName,
    linked_patients: [linkedPatient],
    linked_patient_ids: [linkedPatient.uid],
    linked_reports: linkedReport ? [linkedReport] : [],
    linked_alert_paths: linkedAlertPath ? [linkedAlertPath] : [],
    latest_source_system: sourceSystem || 'unknown',
    source_systems: sourceSystem ? [sourceSystem] : [],
    protocol_rule_snapshot: routingSnapshot.protocol_rule_snapshot,
    protocol_snapshot: routingSnapshot.protocol_snapshot,
    compare_ready: false,
    patient_count: 1,
    report_count: linkedReport ? 1 : 0,
    crc_note: '',
  };

  const incidentRef = await addDoc(collection(db, 'incident_records'), incidentPayload);

  return {
    id: incidentRef.id,
    ...incidentPayload,
  };
}

export async function syncPatientEmergencyToIncident({
  userId,
  reason,
  message,
  alertPath,
}) {
  const { patientProfile, protocolDoc } = await loadPatientSafetyProfile(userId);

  return upsertSafetyIncident({
    patientId: userId,
    patientProfile,
    protocolDoc,
    eventTitle: reason || 'Emergency alert',
    eventKey: normalizeEventKey(reason || message || 'emergency-alert'),
    severity: 'serious',
    details: message || '',
    onsetAt: new Date().toISOString(),
    immediateHelpRequested: true,
    sourceSystem: 'patient_emergency_chat',
    linkedAlertPath: alertPath,
    incidentTypeOverride: 'emergency',
  });
}

export function getIncidentDueState(incident) {
  if (!incident) return 'unknown';
  if (!isOpenIncidentWorkflow(incident)) return deriveIncidentWorkflowStatus(incident);

  const dueAt = incident.due_at ? new Date(incident.due_at).getTime() : null;
  if (!dueAt) return 'untracked';

  const now = Date.now();
  if (dueAt <= now) return 'overdue';
  if (dueAt - now <= 24 * 60 * 60 * 1000) return 'due_24h';
  return 'scheduled';
}

function getLinkedPatientIds(incident = {}) {
  const fromIds = Array.isArray(incident.linked_patient_ids) ? incident.linked_patient_ids : [];
  const fromPatients = Array.isArray(incident.linked_patients)
    ? incident.linked_patients.map((patient) => patient?.uid || patient?.patient_id)
    : [];
  return Array.from(new Set([...fromIds, ...fromPatients].map((value) => String(value || '').trim()).filter(Boolean)));
}

function getIncidentEventKeys(incident = {}) {
  return new Set(
    [
      incident.event_key,
      incident.event_title,
      incident.reason,
      ...(Array.isArray(incident.linked_reports)
        ? incident.linked_reports.map((report) => report?.symptom_title)
        : []),
    ]
      .map((value) => normalizeEventKey(value))
      .filter(Boolean)
  );
}

function shouldMarkAlertForResolvedIncident(alert = {}, incidentEventKeys = new Set()) {
  const alertType = String(alert.type || '').trim().toLowerCase();
  const alertStatus = String(alert.status || '').trim().toLowerCase();
  if (alertType === 'message') return false;
  if (['read', 'resolved', 'closed'].includes(alertStatus)) return false;

  const alertEventKeys = [
    alert.reason,
    alert.symptom_title,
    alert.event_title,
    alert.message,
  ].map((value) => normalizeEventKey(value));

  return alertEventKeys.some((key) => incidentEventKeys.has(key));
}

async function collectAlertRefsForIncidentResolution(incidentId, incident = {}) {
  const alertRefsByPath = new Map();
  const linkedAlertPaths = Array.isArray(incident.linked_alert_paths)
    ? incident.linked_alert_paths
    : [];

  linkedAlertPaths
    .map((path) => String(path || '').trim())
    .filter(Boolean)
    .forEach((path) => {
      alertRefsByPath.set(path, doc(db, path));
    });

  const patientIds = getLinkedPatientIds(incident);
  const incidentEventKeys = getIncidentEventKeys(incident);

  await Promise.all(patientIds.map(async (patientId) => {
    const alertsRef = collection(db, 'users', patientId, 'alerts');

    try {
      const sourceSnapshot = await getDocs(
        query(alertsRef, where('source_incident_id', '==', incidentId), limit(20))
      );
      sourceSnapshot.docs.forEach((entry) => {
        alertRefsByPath.set(entry.ref.path, entry.ref);
      });
    } catch (error) {
      console.warn('Unable to collect source-linked alert threads for incident resolution:', error);
    }

    try {
      const recentSnapshot = await getDocs(
        query(alertsRef, orderBy('timestamp', 'desc'), limit(50))
      );
      recentSnapshot.docs.forEach((entry) => {
        if (shouldMarkAlertForResolvedIncident(entry.data(), incidentEventKeys)) {
          alertRefsByPath.set(entry.ref.path, entry.ref);
        }
      });
    } catch (error) {
      console.warn('Unable to collect event-matched alert threads for incident resolution:', error);
    }
  }));

  return Array.from(alertRefsByPath.values());
}

export function subscribeToIncidentRecords(onUpdate, onError, options = {}) {
  const safeLimit = Math.min(Math.max(Number(options?.limitCount) || 40, 1), 1000);
  const scopedCrcId = String(options?.crcId || '').trim();
  const scopedPatientId = String(options?.patientId || '').trim();
  const baseQuery = query(collection(db, 'incident_records'), orderBy('updated_at', 'desc'), limit(safeLimit));

  return onSnapshot(
    baseQuery,
    (snapshot) => {
      const incidents = snapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .filter((incident) => {
          if (scopedPatientId) {
            const linkedIds = Array.isArray(incident.linked_patient_ids) ? incident.linked_patient_ids : [];
            const linkedPatients = Array.isArray(incident.linked_patients) ? incident.linked_patients : [];
            const patientMatch =
              linkedIds.includes(scopedPatientId) ||
              linkedPatients.some(
                (patient) => patient?.patient_id === scopedPatientId || patient?.uid === scopedPatientId
              );
            if (!patientMatch) return false;
          }

          if (scopedCrcId) {
            const owner = String(incident.primary_crc_id || '').trim();
            if (owner && owner !== scopedCrcId) {
              return false;
            }
          }

          return true;
        })
        .sort((left, right) => {
          const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
          const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
          return rightTime - leftTime;
        });

      onUpdate(incidents);
    },
    onError
  );
}

export async function updateIncidentNote(incidentId, crcNote) {
  await updateDoc(doc(db, 'incident_records', incidentId), {
    crc_note: String(crcNote || ''),
    updated_at: new Date().toISOString(),
  });
}

function compactString(value, fallback = '') {
  return String(value || '').trim() || fallback;
}

function formatSummaryDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
}

function buildSafetyCaseSummary(incident, linkedPatient) {
  const linkedReports = Array.isArray(incident?.linked_reports)
    ? incident.linked_reports.filter(Boolean)
    : [];
  const latestReport = linkedReports[0] || null;
  const protocolRule = incident?.protocol_rule_snapshot || {};
  const protocolSnapshot = incident?.protocol_snapshot || {};
  const protocolName = compactString(protocolSnapshot.protocol_name, linkedPatient?.protocol_name || 'No protocol assigned');
  const coverageLabel =
    latestReport?.protocol_covered === true
      ? 'Protocol listed'
      : latestReport?.protocol_covered === false
        ? 'Protocol not listed'
        : 'Protocol coverage could not be confirmed automatically';
  const actionInstruction = compactString(
    protocolRule.instruction,
    incident?.severity === 'serious'
      ? 'Immediate CRC action is required.'
      : 'CRC follow-up is required according to the active safety workflow.'
  );

  return {
    title: compactString(incident?.event_title, 'Safety follow-up'),
    patientName: compactString(linkedPatient?.patient_name, 'Patient'),
    severity: compactString(incident?.severity, 'not set'),
    incidentType: compactString(incident?.incident_type, 'safety'),
    dueAt: compactString(incident?.due_at),
    reportedAt: compactString(incident?.last_event_at || incident?.updated_at || incident?.created_at),
    protocolName,
    protocolCoverage: coverageLabel,
    reportCount: linkedReports.length,
    latestReportTitle: compactString(latestReport?.symptom_title),
    latestReportAt: formatSummaryDate(latestReport?.submitted_at),
    details: compactString(incident?.details_preview, 'No detailed symptom narrative was captured.'),
    triageSummary: compactString(
      incident?.ai_triage_summary || incident?.triage_summary,
      incident?.immediate_help_requested
        ? 'Patient requested immediate help or reported symptoms requiring urgent CRC attention.'
        : 'Review the linked report, patient context, and protocol before documenting follow-up.'
    ),
    recommendedAction: actionInstruction,
  };
}

function buildPatientThreadIntro(incident) {
  const title = compactString(incident?.event_title, 'your safety report');
  return `CRC opened a follow-up thread for ${title}. Please reply here with symptom updates, questions, or any change in your condition.`;
}

export async function ensureIncidentAlertThread(incident, linkedPatient, crcMeta = {}) {
  const patientUid = String(linkedPatient?.uid || linkedPatient?.patient_id || '').trim();
  const incidentId = String(incident?.id || '').trim();

  if (!patientUid || !incidentId) {
    throw new Error('Incident and linked patient are required to open a thread.');
  }

  const existingPath = (Array.isArray(incident?.linked_alert_paths) ? incident.linked_alert_paths : []).find((path) =>
    String(path || '').startsWith(`users/${patientUid}/alerts/`)
  );

  if (existingPath) {
    await updateDoc(doc(db, existingPath), {
      safety_case_summary: buildSafetyCaseSummary(incident, linkedPatient),
      source_incident_id: incidentId,
      source_system: 'crc_incident_thread',
      updated_at: new Date().toISOString(),
    });
    return existingPath;
  }

  const nowIso = new Date().toISOString();
  const reason = incident?.event_title || incident?.reason || 'Safety follow-up';
  const senderName = crcMeta.name || crcMeta.email || 'CRC';
  const messageText = buildPatientThreadIntro(incident);
  const safetyCaseSummary = buildSafetyCaseSummary(incident, linkedPatient);
  const alertRef = doc(collection(db, 'users', patientUid, 'alerts'));
  const messageRef = doc(collection(alertRef, 'messages'));
  const incidentRef = doc(db, 'incident_records', incidentId);
  const batch = writeBatch(db);

  batch.set(alertRef, {
    type: 'URGENT',
    reason,
    message: messageText,
    timestamp: nowIso,
    status: 'unread',
    senderRole: 'crc',
    senderName,
    lastSender: 'crc',
    source_incident_id: incidentId,
    source_system: 'crc_incident_thread',
    incident_type: incident?.incident_type || null,
    side_effect_severity: incident?.severity || null,
    safety_case_summary: safetyCaseSummary,
  });

  batch.set(messageRef, {
    sender: 'crc',
    senderName,
    text: messageText,
    timestamp: nowIso,
  });

  batch.update(incidentRef, {
    linked_alert_paths: arrayUnion(alertRef.path),
    updated_at: nowIso,
  });

  await batch.commit();
  return alertRef.path;
}

function buildIncidentStatusPatch(incident = {}, patch = {}) {
  const nextIncident = {
    ...incident,
    ...patch,
  };

  return {
    ...patch,
    status: deriveIncidentWorkflowStatus(nextIncident),
  };
}

export async function documentIncidentAe(incidentId, crcMeta = {}) {
  const nowIso = new Date().toISOString();
  const incidentRef = doc(db, 'incident_records', incidentId);
  const incidentSnapshot = await getDoc(incidentRef);
  const incident = incidentSnapshot.exists() ? incidentSnapshot.data() : {};
  const alertRefsToDocument = await collectAlertRefsForIncidentResolution(incidentId, incident);
  const patch = buildIncidentStatusPatch(incident, {
    ae_documentation_status: 'documented',
    ae_documented_at: nowIso,
    ae_documented_by: crcMeta.uid || null,
    ae_documented_by_name: crcMeta.name || crcMeta.email || null,
  });
  const batch = writeBatch(db);

  batch.update(incidentRef, {
    ...patch,
    updated_at: nowIso,
  });

  alertRefsToDocument.forEach((alertRef) => {
    batch.set(alertRef, {
      ae_documentation_status: 'documented',
      ae_documented_at: nowIso,
      ae_documented_by: crcMeta.uid || null,
      ae_documented_by_name: crcMeta.name || crcMeta.email || null,
      updated_at: nowIso,
    }, { merge: true });
  });

  await batch.commit();
}

export async function resolveIncidentAe(incidentId, crcMeta = {}) {
  const nowIso = new Date().toISOString();
  const incidentRef = doc(db, 'incident_records', incidentId);
  const incidentSnapshot = await getDoc(incidentRef);
  const incident = incidentSnapshot.exists() ? incidentSnapshot.data() : {};
  const alertRefsToResolve = await collectAlertRefsForIncidentResolution(incidentId, incident);
  const patch = buildIncidentStatusPatch(incident, {
    ae_clinical_status: 'resolved',
    ae_resolved_at: nowIso,
    ae_resolved_by: crcMeta.uid || null,
    ae_resolved_by_name: crcMeta.name || crcMeta.email || null,
  });
  const batch = writeBatch(db);

  batch.update(incidentRef, {
    ...patch,
    updated_at: nowIso,
  });

  alertRefsToResolve.forEach((alertRef) => {
    batch.set(alertRef, {
      ae_clinical_status: 'resolved',
      ae_resolved_at: nowIso,
      ae_resolved_by: crcMeta.uid || null,
      ae_resolved_by_name: crcMeta.name || crcMeta.email || null,
      updated_at: nowIso,
    }, { merge: true });
  });

  await batch.commit();
}

export const resolveIncident = resolveIncidentAe;

export async function hydrateIncidentPatientContext(incident) {
  const linkedPatients = incident?.linked_patients || [];
  const contexts = await Promise.all(
    linkedPatients.map(async (linkedPatient) => {
      const patientId = linkedPatient.uid;
      const patientSnapshot = await getDoc(doc(db, 'users', patientId));
      const patientProfile = patientSnapshot.exists() ? patientSnapshot.data() : {};
      const vitalQuery = query(
        collection(db, 'users', patientId, 'vitals'),
        orderBy('timestamp', 'desc'),
        limit(3)
      );
      const vitalSnapshot = await getDocs(vitalQuery);
      const vitals = vitalSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

      return {
        ...linkedPatient,
        patient_profile: patientProfile,
        latest_vitals: vitals,
      };
    })
  );

  return contexts;
}

export function buildLinkedReportReference(patientId, reportId, reportData) {
  return buildReportLink(patientId, reportId, reportData);
}
