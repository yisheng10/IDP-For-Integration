// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);