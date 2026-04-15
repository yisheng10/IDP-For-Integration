import { 
  collection, 
  addDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  onSnapshot, 
  collectionGroup, 
  limit 
} from 'firebase/firestore';
import { db } from '../firebase';
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
  
  const docRef = await addDoc(alertsRef, {
    type: 'URGENT',
    reason: reason,
    message: message || "No details provided",
    timestamp: new Date().toISOString(),
    status: 'unread',
    senderRole: 'patient',
    senderName: senderName,
    lastSender: 'patient',
    ...(options.alertMetadata || {}),
  });

  if (message) {
    await addDoc(collection(docRef, "messages"), {
      sender: 'patient',
      senderName: senderName,
      text: message,
      timestamp: new Date().toISOString()
    });
  }
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

  if (!snapshot.empty) {
    docRef = snapshot.docs[0].ref;
    await updateDoc(docRef, {
      status: 'unread',
      timestamp: new Date().toISOString(),
      message: message,
      lastSender: 'crc' 
    });
  } else {
    docRef = await addDoc(alertsRef, {
      type: 'MESSAGE',
      reason: 'Direct Message',
      message: message,
      timestamp: new Date().toISOString(),
      status: 'unread',
      senderRole: 'crc',
      senderName: senderName,
      lastSender: 'crc' 
    });
  }
  
  await addDoc(collection(docRef, "messages"), {
    sender: 'crc',
    senderName: senderName,
    text: message,
    timestamp: new Date().toISOString()
  });
  
  return docRef;
};

export const sendChatMessage = async (alertRef, role, message, senderName) => {
  if (!message.trim()) return;
  
  const messagesRef = collection(alertRef, "messages");
  await addDoc(messagesRef, {
    sender: role, 
    senderName: senderName || role.toUpperCase(),
    text: message,
    timestamp: new Date().toISOString()
  });

  await updateDoc(alertRef, {
    status: 'unread', 
    lastSender: role, 
    timestamp: new Date().toISOString(),
    message: message 
  });
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
