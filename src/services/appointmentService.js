import { GoogleGenerativeAI } from "@google/generative-ai";
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
import { GEMINI_API_KEY } from '../config';
import { db } from '../firebase';
import { urlToBase64 } from '../utils';
import { getSignedUrl } from './storageService'; // <--- Added to handle private bucket

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
  if (!GEMINI_API_KEY) throw new Error("Missing API Key");
  if (!protocolUrl) throw new Error("No active protocol found.");

  // 1. HANDLE PRIVATE BUCKET ACCESS
  let downloadUrl = protocolUrl;
  
  // If it's a file path (not a public http link), we must sign it
  if (!protocolUrl.startsWith('http')) {
    // Explicitly use the 'protocol' bucket (Private)
    const signedUrl = await getSignedUrl(protocolUrl, 'protocol');
    if (!signedUrl) throw new Error("Could not authorize access to Protocol PDF.");
    downloadUrl = signedUrl;
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { responseMimeType: "application/json" } 
  });
  
  // 2. DOWNLOAD PDF AS BASE64
  const base64Data = await urlToBase64(downloadUrl);
  if (!base64Data) throw new Error("Could not download protocol PDF.");

  const prompt = `
    You are a Clinical Scheduler.
    TODAY: ${new Date().toISOString()}
    HISTORY: ${JSON.stringify(appointmentHistory)}
    PROTOCOL: Attached PDF.

    TASK: Determine the NEXT appointment date based on the protocol rules.
    
    REQUIREMENTS:
    1. Check the protocol schedule (e.g., "Visit 2 is 14 days after Visit 1").
    2. If this is the first visit, suggest a date soon.
    3. Cite the specific PAGE NUMBER where you found this rule.
    4. Explain your logic clearly.

    OUTPUT JSON FORMAT:
    {
      "date": "YYYY-MM-DDTHH:MM",
      "reason": "Because Protocol Page 12 states visits are bi-weekly..."
    }
  `;

  try {
    const result = await model.generateContent([
      { inlineData: { data: base64Data, mimeType: "application/pdf" } },
      prompt
    ]);
    
    const text = result.response.text();
    return JSON.parse(text);
  } catch (e) {
    console.error("AI Scheduling Error:", e);
    return { date: "", reason: "AI Scheduling Failed: " + e.message };
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
