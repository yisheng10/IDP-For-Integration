import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { db } from '../firebase';

export const DEFAULT_CONVERSATION_TIMELINE_LIMIT = 100;

function sanitizeTraceSummary(guidanceTrace = null) {
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

export function buildConversationTimelineEventData({
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
    guidanceTrace: sanitizeTraceSummary(guidanceTrace),
  };
}

export function queueConversationTimelineMirror(batch, patientUid, eventData) {
  const safePatientUid = String(patientUid || '').trim();
  if (!safePatientUid) {
    return null;
  }

  const timelineRef = doc(collection(db, 'users', safePatientUid, 'conversation_timeline'));
  batch.set(timelineRef, buildConversationTimelineEventData(eventData));
  return timelineRef;
}

export function subscribeToConversationTimeline(
  patientUid,
  onUpdate,
  onError,
  options = {}
) {
  const safePatientUid = String(patientUid || '').trim();
  if (!safePatientUid) {
    return () => {};
  }

  const safeLimit = Math.min(
    Math.max(Number(options.limitCount) || DEFAULT_CONVERSATION_TIMELINE_LIMIT, 1),
    DEFAULT_CONVERSATION_TIMELINE_LIMIT
  );

  const timelineQuery = query(
    collection(db, 'users', safePatientUid, 'conversation_timeline'),
    orderBy('timestamp', 'desc'),
    limit(safeLimit)
  );

  return onSnapshot(
    timelineQuery,
    (snapshot) => {
      const entries = snapshot.docs.map((entry) => ({
        id: entry.id,
        ...entry.data(),
      }));
      onUpdate(entries, snapshot.docs[snapshot.docs.length - 1] || null);
    },
    onError
  );
}

export async function fetchOlderConversationTimeline(
  patientUid,
  cursor,
  options = {}
) {
  const safePatientUid = String(patientUid || '').trim();
  if (!safePatientUid || !cursor) {
    return {
      entries: [],
      cursor: null,
      hasMore: false,
    };
  }

  const safeLimit = Math.min(
    Math.max(Number(options.limitCount) || DEFAULT_CONVERSATION_TIMELINE_LIMIT, 1),
    DEFAULT_CONVERSATION_TIMELINE_LIMIT
  );

  const olderQuery = query(
    collection(db, 'users', safePatientUid, 'conversation_timeline'),
    orderBy('timestamp', 'desc'),
    startAfter(cursor),
    limit(safeLimit)
  );

  const snapshot = await getDocs(olderQuery);
  return {
    entries: snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    })),
    cursor: snapshot.docs[snapshot.docs.length - 1] || null,
    hasMore: snapshot.docs.length === safeLimit,
  };
}
