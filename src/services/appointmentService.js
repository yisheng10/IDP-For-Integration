import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { callFunctionHttp } from './firebaseFunctionHttp';

// --- APPOINTMENT SUBSCRIPTIONS ---

export const subscribeToAppointments = (userId, onUpdate, onError) => {
  const q = query(
    collection(db, "users", userId, "appointments"),
    orderBy("datetime", "asc"),
    limit(20)
  );
  return onSnapshot(q, (snapshot) => {
    const appointments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    onUpdate(appointments);
  }, onError);
};

export const createAppointment = async (userId, datetimeString) => {
  if (!datetimeString) throw new Error("Date is required");
  await addDoc(collection(db, "users", userId, "appointments"), { 
    datetime: datetimeString, status: 'pending', timestamp: new Date().toISOString() 
  });
};

export const updateAppointmentStatus = async (userId, appointmentId, newStatus) => {
  const ref = doc(db, "users", userId, "appointments", appointmentId);
  await updateDoc(ref, { status: newStatus });
};

// --- AI SCHEDULER (FIXED) ---

export const suggestAppointmentDate = async (protocolUrl, appointmentHistory) => {
  if (!protocolUrl) throw new Error("No active protocol found.");
  return callFunctionHttp('suggestAppointmentDateHttp', {
    protocolUrl,
    appointmentHistory,
  });
};

// --- UTILS ---

export const purgeOldAppointments = async (userId) => {
  try {
    const now = new Date();
    const q = query(collection(db, "users", userId, "appointments"), where("status", "==", "pending"));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    let count = 0;

    snapshot.docs.forEach((doc) => {
      if (new Date(doc.data().datetime) < now) {
        batch.delete(doc.ref);
        count++;
      }
    });
    if (count > 0) { await batch.commit(); console.log(`Purged ${count} pending appts.`); }
  } catch (error) { console.error(error); }
};
