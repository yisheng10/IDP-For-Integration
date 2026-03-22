// src/firebase.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from "firebase/app";
// Import React Native compatible auth functions
import { getReactNativePersistence, GoogleAuthProvider, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBafCJ2iGZ-hYVpwHE_rubGDdOwhlqbkoQ",
  authDomain: "idp-authentication-7e8d7.firebaseapp.com",
  projectId: "idp-authentication-7e8d7",
  storageBucket: "idp-authentication-7e8d7.firebasestorage.app",
  messagingSenderId: "858114692646",
  appId: "1:858114692646:web:027f8d324fd693830578e7",
  measurementId: "G-7M5S7QN2TM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth with persistence for React Native
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);