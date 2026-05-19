import admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const MAX_BATCH_WRITES = 400;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

async function ensureCrcAccessByUid(uid, token = {}) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'CRC authentication is required.');
  }

  const email = String(token.email || '').toLowerCase();
  if (email.endsWith('@hospital.com')) {
    return {
      uid,
      role: 'crc',
      email,
      displayName: token.name || token.email || 'CRC user',
    };
  }

  try {
    const userSnapshot = await db.collection('users').doc(uid).get();
    if (!userSnapshot.exists) {
      throw new HttpsError('permission-denied', 'CRC profile not found.');
    }

    const userData = userSnapshot.data() || {};
    if (userData.role !== 'crc') {
      throw new HttpsError('permission-denied', 'Only CRC users can perform this action.');
    }

    return {
      uid,
      ...userData,
    };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    console.error('CRC profile lookup failed:', error);
    throw new HttpsError('unavailable', 'CRC profile lookup is temporarily unavailable.');
  }
}

async function assertAuthenticatedCrcRequest(request) {
  return ensureCrcAccessByUid(request.auth?.uid, request.auth?.token || {});
}

function normalizePatientUid(value) {
  return String(value || '').trim();
}

function sanitizeTimelineTraceSummary(guidanceTrace = null) {
  if (!guidanceTrace || typeof guidanceTrace !== 'object') {
    return null;
  }

  const traceId = String(guidanceTrace.traceId || '').trim();
  const patientUid = String(guidanceTrace.patientUid || '').trim();
  if (!traceId || !patientUid) {
    return null;
  }

  return {
    traceId,
    patientUid,
    displaySummary: String(guidanceTrace.displaySummary || '').trim(),
    latestStepTitle: String(guidanceTrace.latestStepTitle || '').trim(),
    sourceMask: String(guidanceTrace.sourceMask || '').trim() || 'none',
    persisted:
      guidanceTrace.persisted == null ? null : Boolean(guidanceTrace.persisted),
  };
}

function buildConversationTimelineEventData({
  actorType,
  channelType,
  threadType = 'none',
  alertId = null,
  sourcePath = '',
  messageText = '',
  timestamp = null,
  displayName = '',
  threadLabel = '',
  guidanceTrace = null,
}) {
  const safeTimestamp =
    String(timestamp || '').trim() || new Date().toISOString();

  return {
    actorType: String(actorType || '').trim() || 'system',
    channelType: String(channelType || '').trim() || 'crc_chat',
    threadType: String(threadType || '').trim() || 'none',
    alertId: String(alertId || '').trim() || null,
    sourcePath: String(sourcePath || '').trim(),
    messageText: String(messageText || '').trim(),
    timestamp: safeTimestamp,
    displayName: String(displayName || '').trim() || 'System',
    threadLabel: String(threadLabel || '').trim() || '',
    guidanceTrace: sanitizeTimelineTraceSummary(guidanceTrace),
  };
}

function queueConversationTimelineMirror(batch, patientUid, eventData) {
  const safePatientUid = String(patientUid || '').trim();
  if (!safePatientUid) {
    return null;
  }

  const timelineRef = db
    .collection('users')
    .doc(safePatientUid)
    .collection('conversation_timeline')
    .doc();
  batch.set(timelineRef, buildConversationTimelineEventData(eventData));
  return timelineRef;
}

function splitIntoChunks(items, size = MAX_BATCH_WRITES) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function findLatestDirectMessageThread(alertsRef, limitCount = 25) {
  const snapshot = await alertsRef
    .orderBy('timestamp', 'desc')
    .limit(limitCount)
    .get();

  return (
    snapshot.docs.find((entry) => normalizeText(entry.data()?.type) === 'message') || null
  );
}

function incidentReferencesPatient(incident = {}, patientUid) {
  const linkedIds = Array.isArray(incident.linked_patient_ids) ? incident.linked_patient_ids : [];
  const linkedPatients = Array.isArray(incident.linked_patients) ? incident.linked_patients : [];

  return (
    linkedIds.includes(patientUid) ||
    linkedPatients.some((entry) => {
      const linkedUid = String(entry?.uid || entry?.patient_id || '').trim();
      return linkedUid === patientUid;
    })
  );
}

function buildIncidentPurgeUpdate(incident = {}, patientUid) {
  const nextLinkedPatients = (Array.isArray(incident.linked_patients) ? incident.linked_patients : []).filter(
    (entry) => {
      const linkedUid = String(entry?.uid || entry?.patient_id || '').trim();
      return linkedUid && linkedUid !== patientUid;
    }
  );
  const nextLinkedPatientIds = (Array.isArray(incident.linked_patient_ids) ? incident.linked_patient_ids : []).filter(
    (entry) => String(entry || '').trim() !== patientUid
  );
  const nextLinkedReports = (Array.isArray(incident.linked_reports) ? incident.linked_reports : []).filter(
    (entry) => String(entry?.uid || '').trim() !== patientUid
  );
  const nextLinkedAlertPaths = (Array.isArray(incident.linked_alert_paths) ? incident.linked_alert_paths : []).filter(
    (path) => !String(path || '').startsWith(`users/${patientUid}/alerts/`)
  );

  if (!nextLinkedPatients.length && !nextLinkedPatientIds.length) {
    return null;
  }

  return {
    linked_patients: nextLinkedPatients,
    linked_patient_ids: nextLinkedPatientIds,
    linked_reports: nextLinkedReports,
    linked_alert_paths: nextLinkedAlertPaths,
    patient_count: nextLinkedPatients.length || nextLinkedPatientIds.length,
    report_count: nextLinkedReports.length,
    compare_ready: (nextLinkedPatients.length || nextLinkedPatientIds.length) > 1,
    updated_at: new Date().toISOString(),
  };
}

async function planIncidentPurge(patientUid) {
  const snapshot = await db.collection('incident_records').get();
  const operations = [];

  snapshot.docs.forEach((entry) => {
    const data = entry.data() || {};
    if (!incidentReferencesPatient(data, patientUid)) {
      return;
    }

    const updatePayload = buildIncidentPurgeUpdate(data, patientUid);
    if (!updatePayload) {
      operations.push({
        type: 'delete',
        ref: entry.ref,
      });
      return;
    }

    operations.push({
      type: 'update',
      ref: entry.ref,
      data: updatePayload,
    });
  });

  return operations;
}

async function commitIncidentPurgeOperations(operations = []) {
  let deletedCount = 0;
  let updatedCount = 0;

  for (const chunk of splitIntoChunks(operations)) {
    const batch = db.batch();
    chunk.forEach((operation) => {
      if (operation.type === 'delete') {
        batch.delete(operation.ref);
        deletedCount += 1;
        return;
      }

      batch.update(operation.ref, operation.data);
      updatedCount += 1;
    });
    await batch.commit();
  }

  return {
    deletedCount,
    updatedCount,
  };
}

function isUnresolvedIncident(incident) {
  return ['open', 'acknowledged'].includes(normalizeText(incident?.status));
}

export const fetchCrcUrgentIncidentSummary = onCall(async (request) => {
  await assertAuthenticatedCrcRequest(request);

  const snapshot = await db
    .collection('incident_records')
    .where('status', 'in', ['open', 'acknowledged'])
    .get();

  const urgentCount = snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .filter(isUnresolvedIncident)
    .length;

  return {
    urgentCount,
  };
});

export const sendCrcPatientDirectMessage = onCall(async (request) => {
  const requester = await assertAuthenticatedCrcRequest(request);
  const patientUid = normalizePatientUid(request.data?.patientUid);
  const messageText = String(request.data?.messageText || '').trim();
  const senderName =
    String(request.data?.senderName || '').trim() ||
    String(requester.displayName || requester.name || requester.email || 'CRC').trim();

  if (!patientUid) {
    throw new HttpsError('invalid-argument', 'patientUid is required.');
  }

  if (!messageText) {
    throw new HttpsError('invalid-argument', 'messageText is required.');
  }

  const patientRef = db.collection('users').doc(patientUid);
  const patientSnapshot = await patientRef.get();

  if (!patientSnapshot.exists) {
    throw new HttpsError('not-found', 'Patient record not found.');
  }

  const patientData = patientSnapshot.data() || {};
  const patientRole = normalizeText(patientData.role);
  const patientEmail = String(patientData.email || '').trim().toLowerCase();
  if (patientRole === 'crc' || patientEmail.endsWith('@hospital.com')) {
    throw new HttpsError('permission-denied', 'Direct messaging is only available for patient workspaces.');
  }

  const alertsRef = patientRef.collection('alerts');
  let latestDirectMessageThread = null;
  try {
    latestDirectMessageThread = await findLatestDirectMessageThread(alertsRef);
  } catch (error) {
    console.error('CRC direct-message thread lookup failed:', error);
    throw new HttpsError('unavailable', 'CRC direct message thread lookup failed.');
  }

  const messageTimestamp = new Date().toISOString();
  const batch = db.batch();
  const createdThread = !latestDirectMessageThread;
  const alertRef = createdThread ? alertsRef.doc() : latestDirectMessageThread.ref;

  if (createdThread) {
    batch.set(alertRef, {
      type: 'MESSAGE',
      reason: 'Direct Message',
      message: messageText,
      timestamp: messageTimestamp,
      status: 'unread',
      senderRole: 'crc',
      senderName,
      lastSender: 'crc',
    });
  } else {
    batch.update(alertRef, {
      status: 'unread',
      timestamp: messageTimestamp,
      message: messageText,
      senderRole: 'crc',
      senderName,
      lastSender: 'crc',
    });
  }

  const messageRef = alertRef.collection('messages').doc();
  batch.set(messageRef, {
    sender: 'crc',
    senderName,
    text: messageText,
    timestamp: messageTimestamp,
  });

  queueConversationTimelineMirror(batch, patientUid, {
    actorType: 'crc',
    channelType: 'crc_chat',
    threadType: 'direct_message',
    alertId: alertRef.id,
    sourcePath: messageRef.path,
    messageText,
    timestamp: messageTimestamp,
    displayName: senderName,
    threadLabel: 'Direct Message',
  });

  try {
    await batch.commit();
  } catch (error) {
    console.error('CRC direct-message send failed:', error);
    throw new HttpsError('unavailable', 'CRC direct message could not be sent right now.');
  }

  return {
    alertId: alertRef.id,
    messageTimestamp,
    createdThread,
  };
});

export const purgePatientRecord = onCall(
  {
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request) => {
    const requester = await assertAuthenticatedCrcRequest(request);
    const patientUid = normalizePatientUid(request.data?.patientUid);

    if (!patientUid) {
      throw new HttpsError('invalid-argument', 'patientUid is required.');
    }

    const userRef = db.collection('users').doc(patientUid);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      throw new HttpsError('not-found', 'Patient record not found.');
    }

    const userData = userSnapshot.data() || {};
    const role = normalizeText(userData.role);
    const email = String(userData.email || '').trim().toLowerCase();

    if (role === 'crc' || email.endsWith('@hospital.com')) {
      throw new HttpsError('permission-denied', 'CRC user records cannot be deleted from this patient workspace.');
    }

    const incidentOperations = await planIncidentPurge(patientUid);
    const incidentResult = await commitIncidentPurgeOperations(incidentOperations);

    await db.recursiveDelete(userRef);

    const warnings = [];
    let authDeleted = false;
    try {
      await admin.auth().deleteUser(patientUid);
      authDeleted = true;
    } catch (error) {
      if (String(error?.code || '').toLowerCase() === 'auth/user-not-found') {
        warnings.push('Firebase Auth user was not found during purge.');
      } else {
        console.error('Patient auth deletion failed:', error);
        warnings.push(`Firebase Auth deletion failed: ${String(error?.message || error || 'Unknown error')}`);
      }
    }

    return {
      patientUid,
      patientName: userData.nickname || userData.name || userData.email || patientUid,
      requestedBy: requester.uid,
      incidentsDeleted: incidentResult.deletedCount,
      incidentsUpdated: incidentResult.updatedCount,
      authDeleted,
      warnings,
      purgedAt: new Date().toISOString(),
    };
  }
);
