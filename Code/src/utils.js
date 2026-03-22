// src/utils.js
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const getStatusText = (status) => status ? status.toUpperCase().replace('_', ' ') : 'UNKNOWN';

export const urlToBase64 = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("File not found");
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result;
        // In some RN versions, FileReader returns "data:application/pdf;base64,..."
        // We only want the part after the comma.
        if (typeof base64data === 'string' && base64data.includes(',')) {
          resolve(base64data.split(',')[1]);
        } else {
          resolve(base64data);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error downloading file:", error);
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