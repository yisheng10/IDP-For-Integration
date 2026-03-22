import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBafCJ2iGZ-hYVpwHE_rubGDdOwhlqbkoQ',
  authDomain: 'idp-authentication-7e8d7.firebaseapp.com',
  projectId: 'idp-authentication-7e8d7',
  storageBucket: 'idp-authentication-7e8d7.firebasestorage.app',
  messagingSenderId: '858114692646',
  appId: '1:858114692646:web:027f8d324fd693830578e7',
  measurementId: 'G-7M5S7QN2TM',
};

const app = initializeApp(firebaseConfig);

// Use the cross-platform auth entry for Expo Go and Expo web.
// This avoids the React Native persistence initializer mismatch that was crashing the app boot.
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
