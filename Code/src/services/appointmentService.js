import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { GEMINI_API_KEY } from '../config';
import { db } from '../firebase';
import { urlToBase64 } from '../utils';

export const subscribeToAppointments = (userId, onUpdate, onError) => {
  const q = query(collection(db, "users", userId, "appointments"), orderBy("datetime", "asc"));
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

// --- AI SCHEDULER ---
export const suggestAppointmentDate = async (protocolUrl, appointmentHistory) => {
  if (!GEMINI_API_KEY) throw new Error("Missing API Key");
  if (!protocolUrl) throw new Error("No active protocol found.");

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
  
  // This uses the React Native compatible fetch logic from utils.js
  const base64Data = await urlToBase64(protocolUrl);
  if (!base64Data) throw new Error("Could not download protocol PDF.");

  const prompt = `
    You are a Clinical Scheduler.
    TODAY: ${new Date().toISOString()}
    HISTORY: ${JSON.stringify(appointmentHistory)}
    PROTOCOL: Attached PDF.

    TASK: Determine the NEXT appointment date.
    
    REQUIREMENTS:
    1. Check the protocol schedule (e.g., "Visit 2 is 14 days after Visit 1").
    2. Cite the specific PAGE NUMBER where you found this rule.
    3. Explain your logic clearly.

    OUTPUT JSON FORMAT:
    {
      "date": "YYYY-MM-DDTHH:MM",
      "reason": "Because Protocol Page 12 states visits are bi-weekly..."
    }
  `;

  const result = await model.generateContent([
    { inlineData: { data: base64Data, mimeType: "application/pdf" } },
    prompt
  ]);
  
  const text = result.response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { date: "", reason: "Error parsing AI response: " + text };
  }
};

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