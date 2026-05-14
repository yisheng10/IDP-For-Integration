import { 
  collection, 
  doc,
  getDoc,
  updateDoc, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  onSnapshot, 
  collectionGroup, 
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  buildConversationTimelineEventData,
  queueConversationTimelineMirror,
} from './conversationTimelineService';
import { syncPatientEmergencyToIncident } from './incidentService';

const DEFAULT_ALERT_LIST_LIMIT = 20;
const DEFAULT_GLOBAL_ALERT_LIST_LIMIT = 30;
const MAX_GLOBAL_ALERT_LIST_LIMIT = 200;
const DEFAULT_CHAT_MESSAGE_LIMIT = 100;

// --- SUBSCRIPTIONS ---

export const subscribeToUnresolvedAlerts = (onUpdate, onError) => {
  const q = query(
    collectionGroup(db, 'alerts'),
    where('status', '==', 'unread'),
    orderBy('timestamp', 'desc'),
    limit(DEFAULT_ALERT_LIST_LIMIT)
  );
  return onSnapshot(q, (snapshot) => {
    const alerts = snapshot.docs.map(d => ({ 
      id: d.id, 
      ref: d.ref, 
      uid: d.ref.parent.parent.id, 
      ...d.data() 
    }));
    onUpdate(alerts);
  }, onError);
};

export const subscribeToRecentAlertsGlobal = (onUpdate, limitCount = DEFAULT_GLOBAL_ALERT_LIST_LIMIT) => {
  const safeLimit = Math.min(
    Math.max(Number(limitCount) || DEFAULT_GLOBAL_ALERT_LIST_LIMIT, 1),
    MAX_GLOBAL_ALERT_LIST_LIMIT
  );
  const q = query(
    collectionGroup(db, 'alerts'), 
    orderBy('timestamp', 'desc'), 
    limit(safeLimit)
  );
  
  return onSnapshot(q, (snapshot) => {
    const alerts = snapshot.docs.map(d => ({ 
      id: d.id, 
      ref: d.ref, 
      uid: d.ref.parent.parent.id, 
      ...d.data() 
    }));
    onUpdate(alerts);
  }, (error) => {
    console.error("Global Alerts Error:", error);
  });
};

export const subscribeToAlertHistory = (userId, onUpdate, options = {}) => {
  const safeLimit = Math.min(
    Math.max(Number(options?.limitCount) || DEFAULT_ALERT_LIST_LIMIT, 1),
    MAX_GLOBAL_ALERT_LIST_LIMIT
  );
  const q = query(
    collection(db, "users", userId, "alerts"),
    orderBy('timestamp', 'desc'),
    limit(safeLimit)
  );
  return onSnapshot(q, (snapshot) => {
    const history = snapshot.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    onUpdate(history);
  });
};

export const resolveAlert = async (alertRef) => {
  await updateDoc(alertRef, { status: 'read', resolvedAt: new Date().toISOString() });
};

export const findActiveChat = async (userId) => {
  try {
    const alertsRef = collection(db, "users", userId, "alerts");
    const q = query(alertsRef, where('type', '==', 'MESSAGE'), orderBy('timestamp', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      return snapshot.docs[0].ref;
    }
    return null;
  } catch (error) {
    console.error("Error finding chat:", error);
    return null;
  }
};

// --- SMART MESSAGING ---

export const createUrgentAlertThread = async (userId, reason, message, senderName, options = {}) => {
  if (!reason) throw new Error("Reason required");
  
  const alertsRef = collection(db, "users", userId, "alerts");
  const docRef = doc(alertsRef);
  const messageTimestamp = new Date().toISOString();
  const batch = writeBatch(db);

  batch.set(docRef, {
    type: 'URGENT',
    reason: reason,
    message: message || "No details provided",
    timestamp: messageTimestamp,
    status: 'unread',
    senderRole: 'patient',
    senderName: senderName,
    lastSender: 'patient',
    ...(options.alertMetadata || {}),
  });

  if (message) {
    const messageRef = doc(collection(docRef, "messages"));
    batch.set(messageRef, {
      sender: 'patient',
      senderName: senderName,
      text: message,
      timestamp: messageTimestamp
    });

    queueConversationTimelineMirror(batch, userId, buildConversationTimelineEventData({
      actorType: 'patient',
      channelType: 'crc_chat',
      threadType: 'urgent_alert',
      alertId: docRef.id,
      sourcePath: messageRef.path,
      messageText: message,
      timestamp: messageTimestamp,
      displayName: senderName || 'Patient',
      threadLabel: reason,
    }));
  }

  await batch.commit();
  return docRef;
};

export const sendAlert = async (userId, reason, message, senderName, options = {}) => {
  const docRef = await createUrgentAlertThread(userId, reason, message, senderName, options);

  if (options.syncIncident !== false) {
    try {
      await syncPatientEmergencyToIncident({
        userId,
        reason,
        message,
        alertPath: docRef.path,
      });
    } catch (error) {
      console.error('Incident sync failed after urgent alert:', error);
    }
  }

  return docRef; 
};

export const startDirectMessage = async (userId, message, senderName) => {
  if (!message) throw new Error("Message required");
  
  const alertsRef = collection(db, "users", userId, "alerts");
  
  const q = query(alertsRef, where('type', '==', 'MESSAGE'), orderBy('timestamp', 'desc'), limit(1));
  const snapshot = await getDocs(q);
  let docRef;
  const messageTimestamp = new Date().toISOString();
  const batch = writeBatch(db);

  if (!snapshot.empty) {
    docRef = snapshot.docs[0].ref;
    batch.update(docRef, {
      status: 'unread',
      timestamp: messageTimestamp,
      message: message,
      lastSender: 'crc' 
    });
  } else {
    docRef = doc(alertsRef);
    batch.set(docRef, {
      type: 'MESSAGE',
      reason: 'Direct Message',
      message: message,
      timestamp: messageTimestamp,
      status: 'unread',
      senderRole: 'crc',
      senderName: senderName,
      lastSender: 'crc' 
    });
  }
  
  const messageRef = doc(collection(docRef, "messages"));
  batch.set(messageRef, {
    sender: 'crc',
    senderName: senderName,
    text: message,
    timestamp: messageTimestamp
  });

  queueConversationTimelineMirror(batch, userId, buildConversationTimelineEventData({
    actorType: 'crc',
    channelType: 'crc_chat',
    threadType: 'direct_message',
    alertId: docRef.id,
    sourcePath: messageRef.path,
    messageText: message,
    timestamp: messageTimestamp,
    displayName: senderName || 'CRC',
    threadLabel: 'Direct Message',
  }));

  await batch.commit();
  
  return docRef;
};

export const sendChatMessage = async (alertRef, role, message, senderName, options = {}) => {
  if (!message.trim()) return;
  
  const alertSnapshot = options.alertType
    ? null
    : await getDoc(alertRef);
  const alertData = alertSnapshot?.exists() ? alertSnapshot.data() : null;
  const alertType = String(options.alertType || alertData?.type || '').trim().toUpperCase();
  const alertReason = String(options.threadLabel || alertData?.reason || '').trim();
  const patientUid = String(
    options.patientUid || alertRef?.parent?.parent?.id || ''
  ).trim();
  const messageTimestamp = new Date().toISOString();
  const messageRef = doc(collection(alertRef, "messages"));
  const batch = writeBatch(db);

  batch.set(messageRef, {
    sender: role, 
    senderName: senderName || role.toUpperCase(),
    text: message,
    timestamp: messageTimestamp
  });

  batch.update(alertRef, {
    status: 'unread', 
    lastSender: role, 
    timestamp: messageTimestamp,
    message: message 
  });

  queueConversationTimelineMirror(batch, patientUid, buildConversationTimelineEventData({
    actorType: role === 'crc' ? 'crc' : 'patient',
    channelType: 'crc_chat',
    threadType: alertType === 'MESSAGE' ? 'direct_message' : 'urgent_alert',
    alertId: alertRef.id,
    sourcePath: messageRef.path,
    messageText: message,
    timestamp: messageTimestamp,
    displayName: senderName || role.toUpperCase(),
    threadLabel: alertType === 'MESSAGE' ? 'Direct Message' : alertReason || 'Urgent',
  }));

  await batch.commit();
};

export const subscribeToChat = (alertRef, onUpdate) => {
  const q = query(
    collection(alertRef, "messages"),
    orderBy("timestamp", "desc"),
    limit(DEFAULT_CHAT_MESSAGE_LIMIT)
  );
  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map(d => d.data()).reverse();
    onUpdate(msgs);
  });
};
