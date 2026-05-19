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
import {
  buildConversationTimelineEventData,
  queueConversationTimelineMirror,
} from './conversationTimelineService';

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
    .filter((incident) => String(incident.status || 'open').trim().toLowerCase() !== 'resolved')
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
      status: 'open',
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
  if (incident.status === 'resolved') return 'resolved';

  const dueAt = incident.due_at ? new Date(incident.due_at).getTime() : null;
  if (!dueAt) return 'untracked';

  const now = Date.now();
  if (dueAt <= now) return 'overdue';
  if (dueAt - now <= 24 * 60 * 60 * 1000) return 'due_24h';
  return 'scheduled';
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
    return existingPath;
  }

  const nowIso = new Date().toISOString();
  const reason = incident?.event_title || incident?.reason || 'Safety follow-up';
  const senderName = crcMeta.name || crcMeta.email || 'CRC';
  const messageText = `CRC follow-up thread opened for safety case: ${reason}.`;
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
  });

  batch.set(messageRef, {
    sender: 'crc',
    senderName,
    text: messageText,
    timestamp: nowIso,
  });

  queueConversationTimelineMirror(batch, patientUid, buildConversationTimelineEventData({
    actorType: 'crc',
    channelType: 'crc_chat',
    threadType: 'urgent_alert',
    alertId: alertRef.id,
    sourcePath: messageRef.path,
    messageText,
    timestamp: nowIso,
    displayName: senderName,
    threadLabel: reason,
  }));

  batch.update(incidentRef, {
    linked_alert_paths: arrayUnion(alertRef.path),
    updated_at: nowIso,
  });

  await batch.commit();
  return alertRef.path;
}

export async function resolveIncident(incidentId, crcMeta = {}) {
  const nowIso = new Date().toISOString();
  const incidentRef = doc(db, 'incident_records', incidentId);
  const incidentSnapshot = await getDoc(incidentRef);
  const incident = incidentSnapshot.exists() ? incidentSnapshot.data() : {};
  const batch = writeBatch(db);

  batch.update(incidentRef, {
    status: 'resolved',
    resolved_at: nowIso,
    resolved_by: crcMeta.uid || null,
    resolved_by_name: crcMeta.name || crcMeta.email || null,
    updated_at: nowIso,
  });

  const linkedAlertPaths = Array.isArray(incident.linked_alert_paths)
    ? incident.linked_alert_paths
    : [];
  linkedAlertPaths
    .filter((path) => typeof path === 'string' && path.trim())
    .forEach((path) => {
      batch.set(doc(db, path.trim()), {
        status: 'resolved',
        threadClosed: true,
        resolvedAt: nowIso,
        resolvedBy: crcMeta.uid || null,
        resolvedByName: crcMeta.name || crcMeta.email || null,
      }, { merge: true });
    });

  await batch.commit();
}

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
