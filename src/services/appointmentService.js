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

function normalizeAppointmentSuggestionError(error) {
  const message = String(error?.message || error || '').toLowerCase();

  if (
    message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('leaked') ||
    message.includes('generativelanguage.googleapis.com')
  ) {
    return 'Appointment guidance is temporarily unavailable. Schedule the visit manually or try again later.';
  }

  if (message.includes('unauthenticated') || message.includes('sign in')) {
    return 'Sign in again before requesting appointment guidance.';
  }

  return String(error?.message || error || 'Appointment guidance is temporarily unavailable.');
}

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
  try {
    return await callFunctionHttp('suggestAppointmentDateHttp', {
      protocolUrl,
      appointmentHistory,
    });
  } catch (error) {
    throw new Error(normalizeAppointmentSuggestionError(error));
  }
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
