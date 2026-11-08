import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCNTSiVxlLr1Ipjp8MGA5A3mpKN370cStA",
  authDomain: "mystudytracker-693d3.firebaseapp.com",
  projectId: "mystudytracker-693d3",
  storageBucket: "mystudytracker-693d3.firebasestorage.app",
  messagingSenderId: "172652188741",
  appId: "1:172652188741:web:f100cff62dd097b2763f2c",
  measurementId: "G-QG3PTZF7EQ"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "asia-south1");

// Analytics is optional and is only initialized in supported browser environments.
export const analyticsPromise =
  typeof window !== "undefined"
    ? isSupported().then((supported) => supported ? getAnalytics(app) : null).catch(() => null)
    : Promise.resolve(null);
