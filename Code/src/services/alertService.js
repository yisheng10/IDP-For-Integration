import {
  addDoc,
  collection,
  collectionGroup,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where
} from 'firebase/firestore';
import { db } from '../firebase'; // <--- Ensure firebase.js is in src/

// --- SUBSCRIPTIONS ---

export const subscribeToUnresolvedAlerts = (onUpdate, onError) => {
  const q = query(collectionGroup(db, 'alerts'), where('status', '==', 'unread'), orderBy('timestamp', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const alerts = snapshot.docs.map(d => ({ id: d.id, ref: d.ref, uid: d.ref.parent.parent.id, ...d.data() }));
    onUpdate(alerts);
  }, onError);
};

export const subscribeToAlertHistory = (userId, onUpdate) => {
  const q = query(collection(db, "users", userId, "alerts"), orderBy('timestamp', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const history = snapshot.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    onUpdate(history);
  });
};

export const resolveAlert = async (alertRef) => {
  await updateDoc(alertRef, { status: 'read', resolvedAt: new Date().toISOString() });
};

// --- MESSAGING LOGIC ---

export const sendAlert = async (userId, reason, message, senderName) => {
  if (!reason) throw new Error("Reason required");
  
  const alertsRef = collection(db, "users", userId, "alerts");
  
  const docRef = await addDoc(alertsRef, {
    type: 'URGENT',
    reason: reason,
    message: message || "No details provided",
    timestamp: new Date().toISOString(),
    status: 'unread',
    senderRole: 'patient',
    senderName: senderName
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
      message: message 
    });
  } else {
    docRef = await addDoc(alertsRef, {
      type: 'MESSAGE',
      reason: 'Direct Message',
      message: message,
      timestamp: new Date().toISOString(),
      status: 'unread',
      senderRole: 'crc',
      senderName: senderName
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

// --- CHAT SUB-COLLECTION ---

export const sendChatMessage = async (alertRef, role, message, senderName) => {
  if (!message.trim()) return;
  const messagesRef = collection(alertRef, "messages");
  await addDoc(messagesRef, {
    sender: role, 
    senderName: senderName || role.toUpperCase(),
    text: message,
    timestamp: new Date().toISOString()
  });
};

export const subscribeToChat = (alertRef, onUpdate) => {
  const q = query(collection(alertRef, "messages"), orderBy("timestamp", "asc"));
  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map(d => d.data());
    onUpdate(msgs);
  });
};