import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

function requireFirebaseEnv(name) {
  const value = String(import.meta.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing Firebase env: ${name}`);
  }
  return value;
}

const firebaseConfig = {
  apiKey: requireFirebaseEnv('VITE_FIREBASE_API_KEY'),
  authDomain: requireFirebaseEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requireFirebaseEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: requireFirebaseEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireFirebaseEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireFirebaseEnv('VITE_FIREBASE_APP_ID'),
  measurementId: String(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '').trim() || undefined,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');

const shouldUseFunctionsEmulator =
  typeof window !== 'undefined' && import.meta.env.VITE_USE_FUNCTIONS_EMULATOR === 'true';

if (shouldUseFunctionsEmulator && !window.__triallightFunctionsEmulatorConnected) {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  window.__triallightFunctionsEmulatorConnected = true;
}
