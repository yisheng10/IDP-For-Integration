import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import * as pdfjsLib from 'pdfjs-dist';

// --- STABLE PDF WORKER CONFIG ---
// Uses a fallback version if the dynamic one fails, preventing startup crashes
try {
  const version = pdfjsLib.version || '3.11.174';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.js`;
} catch (e) {
  console.warn("PDF Worker Init Warning:", e);
}

// --- FIX: SAFE STATUS TEXT ---
// Prevents "Cannot read properties of undefined (reading 'toUpperCase')" crash
export const getStatusText = (status) => {
  if (!status) return 'UNKNOWN'; 
  return String(status).toUpperCase().replace('_', ' ');
};

export const urlToBase64 = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("File not found");
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error downloading PDF:", error);
    return null;
  }
};

export const extractTextFromPdf = async (url) => {
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      fullText += `\n--- [Page ${i}] ---\n${pageText}`;
    }

    return fullText;
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    return null;
  }
};

export const enforceRoleSecurity = async (user, context) => {
  const docRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(docRef);
  const isHospitalEmail = user.email.endsWith('@hospital.com');
  let role = isHospitalEmail ? 'crc' : 'patient';

  if (docSnap.exists()) {
    const data = docSnap.data();
    if (data.role && data.role !== context) throw new Error(`Access Denied: Wrong Portal.`);
    if (!data.role) await setDoc(docRef, { role: role }, { merge: true });
  } else {
    if (context === 'patient' && isHospitalEmail) throw new Error("Hospital staff must use the CRC Login.");
    if (context === 'crc' && !isHospitalEmail) throw new Error("Only @hospital.com emails can access CRC.");
    await setDoc(docRef, { role: role }, { merge: true });
  }
};