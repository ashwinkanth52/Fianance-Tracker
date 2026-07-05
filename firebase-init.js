// firebase-init.js
// Initializes Firebase App, Firestore, and Auth for the Household Finance Tracker.
// Uses Firebase JS SDK v10 (modular, loaded via CDN — no build step, no npm needed).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// This config is safe to keep in client-side code — it is NOT a secret.
// Real protection comes from firestore.rules (see /firestore.rules), which
// restricts data access to the two household accounts only.
const firebaseConfig = {
  apiKey: "AIzaSyC92H4p8zjwcO43dmTIWwGjN3OUuW2UhL0",
  authDomain: "personal-finance-app-c5f1f.firebaseapp.com",
  projectId: "personal-finance-app-c5f1f",
  storageBucket: "personal-finance-app-c5f1f.firebasestorage.app",
  messagingSenderId: "953175988266",
  appId: "1:953175988266:web:2112c4bf47c4eb0d150b53",
  measurementId: "G-TB3X3P9H19"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Offline support: app keeps working (reads cached data) if phone loses signal.
// Writes queue locally and sync automatically once connection returns.
// This matters for a phone-first app used at the grocery counter etc.
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    // Multiple tabs open at once — persistence can only run in one tab.
    console.warn("Offline persistence disabled: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("Offline persistence not supported in this browser.");
  }
});
