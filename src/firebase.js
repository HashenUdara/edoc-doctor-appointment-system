import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCGdD87PNUIjP3ZRWKRdhFmCKBmqL8_1A8",
  authDomain: "consummate-eon-8h7sp.firebaseapp.com",
  projectId: "consummate-eon-8h7sp",
  storageBucket: "consummate-eon-8h7sp.firebasestorage.app",
  messagingSenderId: "703093463571",
  appId: "1:703093463571:web:52baa3b0d339b41666bde6"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
