import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

function requireFirebaseEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing Firebase env: ${name}`);
  }
  return value;
}

const firebaseConfig = {
  apiKey: requireFirebaseEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
  authDomain: requireFirebaseEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: requireFirebaseEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: requireFirebaseEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireFirebaseEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireFirebaseEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
  measurementId: String(process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || '').trim() || undefined,
};

const app = initializeApp(firebaseConfig);

// Use the cross-platform auth entry for Expo Go and Expo web.
// This avoids the React Native persistence initializer mismatch that was crashing the app boot.
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
