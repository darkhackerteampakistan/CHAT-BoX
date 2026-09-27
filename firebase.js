// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBohSRPCxX1Sdhuo4JRo443s0-CQuKYMKA",
  authDomain: "chat-box-7bfa1.firebaseapp.com",
  projectId: "chat-box-7bfa1",
  storageBucket: "chat-box-7bfa1.firebasestorage.app",
  messagingSenderId: "661406382597",
  appId: "1:661406382597:web:b46a445cb251999ea17a6c"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
