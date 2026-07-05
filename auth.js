// auth.js
// Login/logout + role resolution for the two household accounts.
// There is NO public signup screen on purpose — this is a private 2-person
// household app, not a multi-tenant product. The two accounts are created
// once, manually, in the Firebase Console (Authentication -> Users -> Add user).

import { auth } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { HOUSEHOLD_MEMBERS } from "./household-config.js";

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return getMemberInfo(cred.user.email);
}

export async function logout() {
  await signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      callback(null);
      return;
    }
    callback({
      uid: user.uid,
      email: user.email,
      ...getMemberInfo(user.email)
    });
  });
}

function getMemberInfo(email) {
  const normalized = (email || "").toLowerCase();
  const info = HOUSEHOLD_MEMBERS[normalized];
  if (!info) {
    // Logged in with an account that isn't one of the two household emails.
    // Firestore rules block this account's reads/writes regardless, but we
    // fail loudly here too so the UI can show a clear "not authorized" screen
    // instead of a blank dashboard.
    throw new Error("This account is not registered to this household.");
  }
  return info; // { role: "ashwin" | "wife", displayName: "..." }
}
