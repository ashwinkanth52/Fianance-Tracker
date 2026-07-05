// data.js
// All read/write functions for the household's Firestore data.
// Collections: income, fixedExpenses, variableExpenses, savingsGoals
// Every write is tagged with `enteredBy` (the Firebase Auth uid of whoever
// saved it) so the app can always answer "who entered this" — required for
// the Excel export and for resolving same-day dual-user edits.

import { db, auth } from "./firebase-init.js";
import { HOUSEHOLD_MEMBERS } from "./household-config.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Every write already carries `enteredBy: uid` (passed in by the caller).
// This adds a human-readable name alongside it, derived from the CURRENTLY
// signed-in account's email — so "who entered this" is always readable in
// the Excel export without needing a server-side uid->name lookup (the
// client SDK has no way to look up another user's email by uid alone).
function enteredByDisplayName() {
  const email = (auth.currentUser && auth.currentUser.email || "").toLowerCase();
  const info = HOUSEHOLD_MEMBERS[email];
  return info ? info.displayName : email || "Unknown";
}

/* ---------------------------------------------------------------------- *
 * INCOME
 * One doc per contributor per month. Doc id = `${contributor}_${month}`
 * so saving the same month twice overwrites (upsert) instead of duplicating.
 * contributor: "ashwin" | "wife"
 * month: "YYYY-MM"
 * ---------------------------------------------------------------------- */

export async function setIncome({ contributor, month, amount, uid }) {
  const id = `${contributor}_${month}`;
  await setDoc(doc(db, "income", id), {
    contributor,
    month,
    amount: Number(amount),
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    updatedAt: serverTimestamp()
  });
}

export function listenIncome(callback) {
  const q = query(collection(db, "income"), orderBy("month", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* ---------------------------------------------------------------------- *
 * FIXED EXPENSES
 * type:      "loan" | "recurring"
 * frequency: "monthly" | "annual"   (loans are always "monthly")
 * tag:       "ashwin" | "wife" | "household"
 *
 * amount meaning depends on frequency:
 *   - "monthly": amount = what's paid every month (EMI, rent, subscription)
 *   - "annual":  amount = the FULL once-a-year amount (e.g. full school fee),
 *                not a monthly figure. dueMonth (1-12) says which month it
 *                actually hits. calculations.js smooths this into a monthly
 *                equivalent for the steady dashboard view, and separately
 *                surfaces it as an upcoming lump-sum alert as the due month
 *                approaches.
 *
 * loan: { tenureMonths, monthsRemaining, startDate } — only if type === "loan"
 * dueDay:   1-31 — only meaningful if frequency === "monthly" and not a loan
 * dueMonth: 1-12 — only meaningful if frequency === "annual"
 * ---------------------------------------------------------------------- */

export async function addFixedExpense({
  name,
  category,
  type,
  frequency = "monthly",
  amount,
  tag,
  dueDay,
  dueMonth,
  loan,
  uid
}) {
  return addDoc(collection(db, "fixedExpenses"), {
    name,
    category,
    type,
    frequency,
    amount: Number(amount),
    tag,
    dueDay: dueDay ?? null,
    dueMonth: dueMonth ?? null,
    loan: loan ?? null,
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateFixedExpense(id, changes) {
  await updateDoc(doc(db, "fixedExpenses", id), {
    ...changes,
    updatedAt: serverTimestamp()
  });
}

export async function deleteFixedExpense(id) {
  await deleteDoc(doc(db, "fixedExpenses", id));
}

export function listenFixedExpenses(callback) {
  const q = query(collection(db, "fixedExpenses"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* ---------------------------------------------------------------------- *
 * VARIABLE EXPENSES
 * date: "YYYY-MM-DD"
 * tag:  "ashwin" | "wife" | "household"
 * ---------------------------------------------------------------------- */

export async function addVariableExpense({ category, amount, date, note, tag, uid }) {
  return addDoc(collection(db, "variableExpenses"), {
    category,
    amount: Number(amount),
    date,
    note: note ?? "",
    tag,
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    createdAt: serverTimestamp()
  });
}

export async function updateVariableExpense(id, changes) {
  await updateDoc(doc(db, "variableExpenses", id), changes);
}

export async function deleteVariableExpense(id) {
  await deleteDoc(doc(db, "variableExpenses", id));
}

export function listenVariableExpenses(callback) {
  const q = query(collection(db, "variableExpenses"), orderBy("date", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* ---------------------------------------------------------------------- *
 * SAVINGS GOALS
 * isEmergencyFund: bool — exactly one goal should carry this flag; the
 * dashboard uses it to compute "months of fixed expenses covered".
 * ---------------------------------------------------------------------- */

export async function addSavingsGoal({ name, targetAmount, monthlyContribution, isEmergencyFund, tag, uid }) {
  return addDoc(collection(db, "savingsGoals"), {
    name,
    targetAmount: Number(targetAmount),
    monthlyContribution: Number(monthlyContribution),
    currentSaved: 0,
    isEmergencyFund: !!isEmergencyFund,
    tag,
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function logSavingsContribution(id, amount, uid) {
  await updateDoc(doc(db, "savingsGoals", id), {
    currentSaved: increment(Number(amount)),
    lastContributionBy: uid,
    lastContributionByName: enteredByDisplayName(),
    updatedAt: serverTimestamp()
  });
}

export async function updateSavingsGoal(id, changes) {
  await updateDoc(doc(db, "savingsGoals", id), {
    ...changes,
    updatedAt: serverTimestamp()
  });
}

export async function deleteSavingsGoal(id) {
  await deleteDoc(doc(db, "savingsGoals", id));
}

export function listenSavingsGoals(callback) {
  const q = query(collection(db, "savingsGoals"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* ---------------------------------------------------------------------- *
 * ANNUAL BONUS
 * Separate collection from salary income on purpose — a bonus doesn't
 * recur every month like salary, and Firestore's orderBy() would silently
 * exclude docs missing a "month" field if this were crammed into the
 * `income` collection. One doc per contributor per year (upsert by year).
 * contributor:   "ashwin" | "wife"
 * expectedMonth: 1-12 — which month the bonus usually lands (for forecasting)
 * amount:        the full bonus amount for that year (actual once received,
 *                or your best estimate ahead of time — update it when the
 *                real figure comes in)
 * ---------------------------------------------------------------------- */

export async function setAnnualBonus({ contributor, year, amount, expectedMonth, uid }) {
  const id = `${contributor}_${year}`;
  await setDoc(doc(db, "bonusIncome", id), {
    contributor,
    year: Number(year),
    amount: Number(amount),
    expectedMonth: Number(expectedMonth),
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    updatedAt: serverTimestamp()
  });
}

export function listenBonusIncome(callback) {
  const q = query(collection(db, "bonusIncome"), orderBy("year", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* ---------------------------------------------------------------------- *
 * HAND LOANS (informal loans — to/from family, friends, no bank involved)
 * Kept as its own collection, not mixed into fixedExpenses, because the
 * shape is genuinely different: no tenure/interest schedule, just a
 * principal, a running outstanding balance, and an optional informal
 * monthly repayment if one exists.
 *
 * direction:       "borrowed" (you owe them — a liability) |
 *                   "lent" (they owe you — a receivable, not counted in
 *                   your surplus/deficit math, tracked for visibility only)
 * counterparty:    who it's with (name)
 * principalAmount: original amount
 * outstandingAmount: current balance still owed (starts = principalAmount)
 * monthlyRepayment: optional — if you've agreed on an informal EMI-style
 *                   repayment. null if repayments are ad-hoc/irregular.
 * ---------------------------------------------------------------------- */

export async function addHandLoan({
  direction,
  counterparty,
  principalAmount,
  monthlyRepayment,
  expectedDate,
  tag,
  startDate,
  notes,
  uid
}) {
  return addDoc(collection(db, "handLoans"), {
    direction,
    counterparty,
    principalAmount: Number(principalAmount),
    outstandingAmount: Number(principalAmount),
    monthlyRepayment: monthlyRepayment ? Number(monthlyRepayment) : null,
    // expectedDate: for "lent" entries with no formal repayment plan — a
    // rough "should get this back by" date. e.g. a friend owing you for
    // dinner, or a client payment pending. Optional either way.
    expectedDate: expectedDate ?? null,
    tag,
    startDate: startDate ?? null,
    notes: notes ?? "",
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function logHandLoanRepayment(id, amount, uid) {
  await updateDoc(doc(db, "handLoans", id), {
    outstandingAmount: increment(-Math.abs(Number(amount))),
    lastRepaymentBy: uid,
    lastRepaymentByName: enteredByDisplayName(),
    updatedAt: serverTimestamp()
  });
}

export async function updateHandLoan(id, changes) {
  await updateDoc(doc(db, "handLoans", id), {
    ...changes,
    updatedAt: serverTimestamp()
  });
}

export async function deleteHandLoan(id) {
  await deleteDoc(doc(db, "handLoans", id));
}

export function listenHandLoans(callback) {
  const q = query(collection(db, "handLoans"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* ---------------------------------------------------------------------- *
 * VARIABLE INCOME (side income — freelance, rental, business payout, etc.)
 * Anything irregular that isn't the two fixed monthly salaries or the
 * annual bonus. Mirrors variableExpenses in shape.
 * date: "YYYY-MM-DD"
 * tag:  "ashwin" | "wife" | "household"
 * ---------------------------------------------------------------------- */

export async function addVariableIncome({ source, amount, date, note, tag, uid }) {
  return addDoc(collection(db, "variableIncome"), {
    source,
    amount: Number(amount),
    date,
    note: note ?? "",
    tag,
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    createdAt: serverTimestamp()
  });
}

export async function updateVariableIncome(id, changes) {
  await updateDoc(doc(db, "variableIncome", id), changes);
}

export async function deleteVariableIncome(id) {
  await deleteDoc(doc(db, "variableIncome", id));
}

export function listenVariableIncome(callback) {
  const q = query(collection(db, "variableIncome"), orderBy("date", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* ---------------------------------------------------------------------- *
 * PLANNED EXPENSES (one-off future spends you already know about —
 * a wedding gift in December, a trip in March, a big purchase — tied to a
 * specific month, NOT recurring. Different from fixedExpenses (recurring)
 * and savingsGoals (ongoing, no fixed month). Shows up in the forecast at
 * its target month so you can see the real impact before it happens.
 * targetMonth: "YYYY-MM"
 * tag: "ashwin" | "wife" | "household"
 * ---------------------------------------------------------------------- */

export async function addPlannedExpense({ name, amount, targetMonth, category, tag, notes, uid }) {
  return addDoc(collection(db, "plannedExpenses"), {
    name,
    amount: Number(amount),
    targetMonth,
    category: category ?? "",
    tag,
    notes: notes ?? "",
    enteredBy: uid,
    enteredByName: enteredByDisplayName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updatePlannedExpense(id, changes) {
  await updateDoc(doc(db, "plannedExpenses", id), {
    ...changes,
    updatedAt: serverTimestamp()
  });
}

export async function deletePlannedExpense(id) {
  await deleteDoc(doc(db, "plannedExpenses", id));
}

export function listenPlannedExpenses(callback) {
  const q = query(collection(db, "plannedExpenses"), orderBy("targetMonth", "asc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
