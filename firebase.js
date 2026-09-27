import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCSZqZ-k6pLJoXa06xh1RIZdoPnKYSSaTQ",
  authDomain: "chat-with-hacker-8ea76.firebaseapp.com",
  projectId: "chat-with-hacker-8ea76",
  storageBucket: "chat-with-hacker-8ea76.firebasestorage.app",
  messagingSenderId: "84225420811",
  appId: "1:84225420811:web:8e6733d55a7ea195fca10e",
  measurementId: "G-C9C6V1CVZY"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
