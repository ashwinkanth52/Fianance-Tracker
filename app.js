// app.js — wires the UI to Firebase + calculations.js. Vanilla JS, no framework.
import { auth } from "./firebase-init.js";
import { login, logout, watchAuthState } from "./auth.js";
import { HOUSEHOLD_MEMBERS } from "./household-config.js";
import * as DB from "./data.js";
import * as Calc from "./calculations.js";

/* ======================================================================
   STATE
   ====================================================================== */
const state = {
  user: null,              // { uid, email, role, displayName }
  view: "dashboard",
  dashMonthOffset: 0,       // 0 = current real month, negative = past months
  fixedFilter: "all",
  plannerHorizon: 24,
  planFormOpen: false,
  data: {
    income: [],
    bonusIncome: [],
    variableIncome: [],
    fixedExpenses: [],
    variableExpenses: [],
    handLoans: [],
    savingsGoals: [],
    plannedExpenses: []
  }
};
let unsubscribers = [];
let listenersStarted = false;

/* ======================================================================
   UTILITIES
   ====================================================================== */
function inr(n) {
  const v = Math.round(n || 0);
  const s = Math.abs(v).toLocaleString("en-IN");
  return (v < 0 ? "-₹" : "₹") + s;
}
function inrPlain(n) {
  return Math.abs(Math.round(n || 0)).toLocaleString("en-IN");
}
function parseMoney(str) {
  if (typeof str === "number") return str;
  const cleaned = String(str || "").replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
function currentRealMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMonths(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function monthShortLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function tagLabel(tag) {
  return tag === "ashwin" ? "Ashwin" : tag === "wife" ? "Vandana" : "Household";
}
function displayNameFor(tag) {
  if (tag === "ashwin") return HOUSEHOLD_MEMBERS["ashwinkanth52@gmail.com"].displayName;
  if (tag === "wife") return HOUSEHOLD_MEMBERS["vandana.noorla@gmail.com"].displayName;
  return "Household";
}

let toastTimer = null;
function showToast(msg, isError) {
  const t = el("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); }, 2600);
}

/* ======================================================================
   MODAL
   ====================================================================== */
function openModal(title, bodyHtml, onMount) {
  const overlay = el("modal-overlay");
  const sheet = el("modal-sheet");
  sheet.innerHTML = `
    <div class="modal-head">
      <div class="modal-title">${esc(title)}</div>
      <button class="modal-close" id="modal-close-btn" type="button" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    ${bodyHtml}
  `;
  overlay.classList.remove("hidden");
  el("modal-close-btn").addEventListener("click", closeModal);
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  if (onMount) onMount(sheet);
}
function closeModal() {
  el("modal-overlay").classList.add("hidden");
  el("modal-sheet").innerHTML = "";
}

/* ======================================================================
   AUTH
   ====================================================================== */
el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = el("login-email").value.trim();
  const password = el("login-password").value;
  const btn = el("login-submit");
  const errEl = el("login-error");
  errEl.classList.remove("show");
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    await login(email, password);
    // watchAuthState below picks up the successful login and shows the app.
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.classList.add("show");
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

function friendlyAuthError(err) {
  const code = err && err.code;
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email or password is incorrect.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a bit and try again.";
  }
  if (code === "auth/invalid-email") {
    return "That doesn't look like a valid email.";
  }
  return err && err.message ? err.message : "Something went wrong signing in.";
}

el("btn-logout").addEventListener("click", async () => {
  await logout();
});

watchAuthState((user) => {
  if (user) {
    state.user = user;
    el("screen-login").classList.remove("active");
    el("screen-app").classList.add("active");
    startListenersOnce();
  } else {
    state.user = null;
    stopListeners();
    el("screen-app").classList.remove("active");
    el("screen-login").classList.add("active");
    el("login-form").reset();
  }
});

/* ======================================================================
   NAVIGATION
   ====================================================================== */
const FAB_CONFIG = {
  fixed: { label: "Add expense", action: () => openAddFixedExpenseModal() },
  loans: { label: "Add", action: () => openAddHandLoanModal() },
  savings: { label: "Add goal", action: () => openAddSavingsGoalModal() }
};

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === view);
  });
  ["dashboard", "income", "fixed", "variable", "loans", "savings", "planner", "settings"].forEach((v) => {
    const section = el("view-" + v);
    if (section) section.style.display = v === view ? "block" : "none";
  });
  const fab = el("fab-btn");
  const cfg = FAB_CONFIG[view];
  if (cfg) {
    fab.style.display = "flex";
    el("fab-label").textContent = cfg.label;
    fab.onclick = cfg.action;
  } else {
    fab.style.display = "none";
    fab.onclick = null;
  }
  renderCurrentView();
}

document.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.nav));
});

function renderCurrentView() {
  switch (state.view) {
    case "dashboard": renderDashboard(); break;
    case "income": renderIncome(); break;
    case "fixed": renderFixed(); break;
    case "variable": renderVariable(); break;
    case "loans": renderLoans(); break;
    case "savings": renderSavings(); break;
    case "planner": renderPlanner(); break;
    case "settings": renderSettings(); break;
  }
}

/* ======================================================================
   FIRESTORE LISTENERS
   ====================================================================== */
function startListenersOnce() {
  if (listenersStarted) { renderCurrentView(); return; }
  listenersStarted = true;

  const bind = (listenFn, key) => listenFn((docs) => {
    state.data[key] = docs;
    renderCurrentView();
  });

  unsubscribers = [
    bind(DB.listenIncome, "income"),
    bind(DB.listenBonusIncome, "bonusIncome"),
    bind(DB.listenVariableIncome, "variableIncome"),
    bind(DB.listenFixedExpenses, "fixedExpenses"),
    bind(DB.listenVariableExpenses, "variableExpenses"),
    bind(DB.listenHandLoans, "handLoans"),
    bind(DB.listenSavingsGoals, "savingsGoals"),
    bind(DB.listenPlannedExpenses, "plannedExpenses")
  ];
}

function stopListeners() {
  unsubscribers.forEach((u) => { try { u(); } catch (e) {} });
  unsubscribers = [];
  listenersStarted = false;
}

/* ======================================================================
   DASHBOARD
   ====================================================================== */
el("month-prev").addEventListener("click", () => {
  if (state.dashMonthOffset <= -24) return;
  state.dashMonthOffset -= 1;
  renderDashboard();
});
el("month-next").addEventListener("click", () => {
  if (state.dashMonthOffset >= 0) return;
  state.dashMonthOffset += 1;
  renderDashboard();
});

let chartCategory = null, chartTrend = null, chartSpark = null;
const CATEGORY_COLORS = ["#6E9E8A", "#5B87A8", "#AE7896", "#CF9A44", "#8AA0B5", "#CE7B5F", "#9C998F", "#B8A888"];

function renderDashboard() {
  if (!state.user) return;
  const D = state.data;
  const month = addMonths(currentRealMonth(), state.dashMonthOffset);
  const isCur = state.dashMonthOffset === 0;

  el("dash-greeting").textContent = `Hello, ${esc(state.user.displayName)} 👋`;
  el("dash-subtitle").textContent = monthLabel(month) + " · Household overview";
  el("dash-month-label").textContent = monthLabel(month);
  el("dash-month-today").style.display = isCur ? "inline-block" : "none";
  el("month-next").disabled = state.dashMonthOffset >= 0;
  el("month-prev").disabled = state.dashMonthOffset <= -24;

  const summary = Calc.getMonthlySummary({
    incomeDocs: D.income,
    bonusIncomeDocs: D.bonusIncome,
    variableIncomeDocs: D.variableIncome,
    fixedExpenses: D.fixedExpenses,
    variableExpenses: D.variableExpenses,
    handLoans: D.handLoans,
    plannedExpenses: D.plannedExpenses,
    month
  });

  // Hero
  el("stat-total-income").textContent = inr(summary.combinedIncome);
  const sideBits = [];
  if (summary.salary.combined) sideBits.push("Salaries " + inr(summary.salary.combined));
  if (summary.bonus.combined) sideBits.push("smoothed bonus " + inr(summary.bonus.combined));
  if (summary.variableIncome.total) sideBits.push("side " + inr(summary.variableIncome.total));
  el("income-sub").textContent = sideBits.length ? sideBits.join(" · ") : "No income logged yet";
  el("stat-obligations").textContent = inr(summary.totalObligations);
  const obBits = [];
  if (summary.fixed.total) obBits.push("Fixed " + inr(summary.fixed.total));
  if (summary.handLoanTotals.monthlyBorrowedRepayment) obBits.push("hand-loan repay " + inr(summary.handLoanTotals.monthlyBorrowedRepayment));
  el("obligations-sub").textContent = obBits.length ? obBits.join(" · ") : "No fixed obligations logged yet";
  const obPct = summary.combinedIncome > 0 ? Math.min(999, Math.round((summary.totalObligations / summary.combinedIncome) * 100)) : 0;
  el("hero-bar-fill").style.width = Math.min(100, obPct) + "%";
  el("hero-legend-left").textContent = "Obligations use " + obPct + "% of income";
  el("hero-legend-right").textContent = Math.max(0, 100 - obPct) + "% free";

  // Surplus banner
  const sb = el("surplus-banner");
  sb.classList.toggle("neg", summary.surplus < 0);
  el("stat-surplus").textContent = (summary.surplus >= 0 ? "+" : "") + inr(summary.surplus);
  const tag = el("surplus-tag");
  tag.textContent = summary.surplus < 0 ? "Deficit" : (summary.savingsRate >= 25 ? "Healthy" : "Tight");

  // Upcoming alerts — only meaningful looking forward from the current real month
  const alertBox = el("upcoming-alerts");
  const alertList = el("upcoming-alerts-list");
  if (isCur) {
    const items = [];
    Calc.getUpcomingAnnualPayments(D.fixedExpenses, 3, month).forEach((a) => {
      items.push({ name: a.name, when: "Due " + monthShortLabel(a.dueMonth), amount: a.amount, positive: false });
    });
    Calc.getUpcomingPlannedExpenses(D.plannedExpenses, 3, month).forEach((p) => {
      items.push({ name: p.name, when: "Planned " + monthShortLabel(p.targetMonth), amount: p.amount, positive: false });
    });
    const latestBonus = Calc.getLatestBonusPerContributor(D.bonusIncome);
    ["ashwin", "wife"].forEach((c) => {
      const b = latestBonus[c];
      if (!b) return;
      for (let i = 0; i <= 3; i++) {
        const d = addMonths(month, i);
        const [, mm] = d.split("-").map(Number);
        if (mm === b.expectedMonth) {
          items.push({ name: displayNameFor(c) + " annual bonus", when: "Expected " + monthShortLabel(d), amount: b.amount, positive: true });
          break;
        }
      }
    });
    if (items.length) {
      alertBox.style.display = "";
      alertList.innerHTML = items.map((it) => `
        <div class="alert-item${it.positive ? " in" : ""}">
          <div class="ai-l"><div class="ai-ic">${it.positive ? "＋" : "！"}</div>
            <div><div class="ai-name">${esc(it.name)}</div><div class="ai-when">${esc(it.when)}</div></div></div>
          <div class="ai-amt num">${it.positive ? "+" : ""}${inr(it.amount)}</div>
        </div>`).join("");
    } else {
      alertBox.style.display = "none";
    }
  } else {
    alertBox.style.display = "none";
  }

  // Savings ring
  const pct = Math.max(0, Math.min(100, summary.savingsRate));
  const circumference = 97.4;
  el("ring-arc").setAttribute("stroke-dashoffset", (circumference * (1 - pct / 100)).toFixed(1));
  el("ring-text").textContent = Math.round(pct) + "%";
  el("ring-sub").textContent = inr(summary.surplus) + " of " + inr(summary.combinedIncome) + " income";

  // Emergency fund
  const efMonths = Calc.getEmergencyFundCoverage(D.savingsGoals, summary.totalObligations);
  el("stat-ef-months").innerHTML = (efMonths === null ? "—" : efMonths) + " <small>months of obligations</small>";
  el("ef-fill").style.width = (efMonths === null ? 0 : Math.min(100, (efMonths / 6) * 100)) + "%";

  // Contribution split
  const split = Calc.getContributionSplit({
    incomeDocs: D.income, bonusIncomeDocs: D.bonusIncome, variableIncomeDocs: D.variableIncome,
    fixedExpenses: D.fixedExpenses, variableExpenses: D.variableExpenses, handLoans: D.handLoans, month
  });
  const maxIncome = Math.max(split.ashwin.income, split.vandana ? split.vandana.income : split.wife.income, 1);
  el("split-a-in").textContent = inr(split.ashwin.income);
  el("split-a-out").textContent = "spent " + inr(split.ashwin.spend);
  el("split-a-bar").style.width = Math.min(100, (split.ashwin.income / maxIncome) * 100) + "%";
  el("split-v-in").textContent = inr(split.wife.income);
  el("split-v-out").textContent = "spent " + inr(split.wife.spend);
  el("split-v-bar").style.width = Math.min(100, (split.wife.income / maxIncome) * 100) + "%";

  // Category chart
  el("cat-subtitle").textContent = monthLabel(month) + " · " + inr(summary.variable.total) + " total";
  const catEntries = Object.entries(summary.categoryBreakdown);
  el("cat-empty").style.display = catEntries.length ? "none" : "block";
  ensureCategoryChart();
  chartCategory.data.labels = catEntries.map(([k]) => k);
  chartCategory.data.datasets[0].data = catEntries.map(([, v]) => v);
  chartCategory.data.datasets[0].backgroundColor = catEntries.map((_, i) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]);
  chartCategory.update("none");

  // Trend chart (last 6 months)
  const trendMonths = [];
  for (let i = 5; i >= 0; i--) trendMonths.push(addMonths(month, -i));
  const trendIncome = trendMonths.map((m) => {
    const s = Calc.getMonthlySummary({ incomeDocs: D.income, bonusIncomeDocs: D.bonusIncome, variableIncomeDocs: D.variableIncome, fixedExpenses: D.fixedExpenses, variableExpenses: D.variableExpenses, handLoans: D.handLoans, plannedExpenses: D.plannedExpenses, month: m });
    return s.combinedIncome;
  });
  const trendSpend = trendMonths.map((m) => {
    const s = Calc.getMonthlySummary({ incomeDocs: D.income, bonusIncomeDocs: D.bonusIncome, variableIncomeDocs: D.variableIncome, fixedExpenses: D.fixedExpenses, variableExpenses: D.variableExpenses, handLoans: D.handLoans, plannedExpenses: D.plannedExpenses, month: m });
    return s.totalSpend;
  });
  ensureTrendChart();
  chartTrend.data.labels = trendMonths.map(monthShortLabel);
  chartTrend.data.datasets[0].data = trendIncome;
  chartTrend.data.datasets[1].data = trendSpend;
  chartTrend.update("none");

  // Hand loans mini summary
  const hl = Calc.getHandLoanTotals(D.handLoans);
  const oweCount = D.handLoans.filter((h) => h.direction === "borrowed" && h.outstandingAmount > 0).length;
  const owedCount = D.handLoans.filter((h) => h.direction === "lent" && h.outstandingAmount > 0).length;
  el("mini-owe-amt").textContent = inr(hl.borrowedOutstanding);
  el("mini-owe-count").textContent = oweCount ? `across ${oweCount} ${oweCount === 1 ? "person" : "people"}` : "nothing owed";
  el("mini-owed-amt").textContent = inr(hl.lentOutstanding);
  el("mini-owed-count").textContent = owedCount ? `across ${owedCount} ${owedCount === 1 ? "person" : "people"}` : "nothing pending";

  // Planner teaser
  const forecast = Calc.getForecast({
    fixedExpenses: D.fixedExpenses, incomeDocs: D.income, bonusIncomeDocs: D.bonusIncome,
    variableIncomeDocs: D.variableIncome, variableExpenses: D.variableExpenses, handLoans: D.handLoans,
    plannedExpenses: D.plannedExpenses, monthsForward: 24, referenceMonth: currentRealMonth()
  });
  const loanSummaries = Calc.getLoanSummary(D.fixedExpenses, currentRealMonth());
  ensureSparkChart();
  chartSpark.data.datasets[0].data = forecast.map((f) => f.surplus);
  chartSpark.update("none");
  if (loanSummaries.length) {
    const soonestPayoff = loanSummaries.slice().sort((a, b) => a.monthsRemaining - b.monthsRemaining)[0];
    const afterEntry = forecast.find((f) => f.loansEnding.includes(soonestPayoff.name));
    const freedAmount = soonestPayoff.emi;
    const [ey, em] = (afterEntry ? afterEntry.month : soonestPayoff.projectedEndMonth).split("-");
    el("teaser-text").textContent = `Surplus rises by ${inr(freedAmount)}/mo after your ${soonestPayoff.name} clears in ${monthShortLabel(afterEntry ? afterEntry.month : soonestPayoff.projectedEndMonth)}.`;
  } else {
    el("teaser-text").textContent = "See your 24-month forecast →";
  }
}

function ensureCategoryChart() {
  if (chartCategory) return;
  chartCategory = new Chart(el("chart-category"), {
    type: "doughnut",
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 3, borderColor: "#fff", hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%", animation: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: "circle", padding: 12, font: { size: 12, weight: "600" } } },
        tooltip: { callbacks: { label: (c) => " " + inr(c.parsed) } }
      }
    }
  });
}
function ensureTrendChart() {
  if (chartTrend) return;
  const ctx = el("chart-trend").getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, "rgba(78,156,139,.18)"); g.addColorStop(1, "rgba(78,156,139,0)");
  chartTrend = new Chart(el("chart-trend"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Income", data: [], borderColor: "#4E9C8B", backgroundColor: g, fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4 },
      { label: "Spend", data: [], borderColor: "#CF9A44", backgroundColor: "transparent", fill: false, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle", padding: 14, font: { size: 12, weight: "600" } } },
        tooltip: { callbacks: { label: (c) => " " + c.dataset.label + ": " + inr(c.parsed.y) } }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11.5, weight: "600" } } },
        y: { grid: { color: "#EDEBE3" }, border: { display: false }, ticks: { maxTicksLimit: 4, font: { size: 11 }, callback: (val) => "₹" + (val / 1000) + "k" } }
      }
    }
  });
}
function ensureSparkChart() {
  if (chartSpark) return;
  const ctx = el("chart-spark").getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 46);
  g.addColorStop(0, "rgba(78,156,139,.35)"); g.addColorStop(1, "rgba(78,156,139,0)");
  chartSpark = new Chart(el("chart-spark"), {
    type: "line",
    data: { labels: [], datasets: [{ data: [], borderColor: "#4E9C8B", backgroundColor: g, fill: true, borderWidth: 2, pointRadius: 0, tension: 0.4 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } }
  });
}

/* ======================================================================
   INCOME SCREEN
   ====================================================================== */
function populateMonthSelect(selectEl, monthsAhead) {
  const cur = currentRealMonth();
  const opts = [];
  for (let i = 0; i < monthsAhead; i++) {
    const m = addMonths(cur, i);
    const [, mm] = m.split("-");
    opts.push(`<option value="${mm}">${monthShortLabel(m)}</option>`);
  }
  selectEl.innerHTML = opts.join("");
}

let incomeScreenInit = false;
function renderIncome() {
  const D = state.data;
  const month = currentRealMonth();
  const income = Calc.getHouseholdIncome(D.income, month);

  if (!incomeScreenInit) {
    populateMonthSelect(el("bonus-ashwin-month"), 12);
    populateMonthSelect(el("bonus-vandana-month"), 12);
    el("oi-date").value = new Date().toISOString().slice(0, 10);
    incomeScreenInit = true;
  }

  if (document.activeElement !== el("income-ashwin")) el("income-ashwin").value = income.ashwin ? inrPlain(income.ashwin) : "";
  if (document.activeElement !== el("income-vandana")) el("income-vandana").value = income.wife ? inrPlain(income.wife) : "";
  el("income-combined").textContent = inr(income.combined);

  const latestBonus = Calc.getLatestBonusPerContributor(D.bonusIncome);
  if (document.activeElement !== el("bonus-ashwin-amount")) el("bonus-ashwin-amount").value = latestBonus.ashwin ? inrPlain(latestBonus.ashwin.amount) : "";
  if (latestBonus.ashwin) el("bonus-ashwin-month").value = String(latestBonus.ashwin.expectedMonth).padStart(2, "0");
  if (document.activeElement !== el("bonus-vandana-amount")) el("bonus-vandana-amount").value = latestBonus.wife ? inrPlain(latestBonus.wife.amount) : "";
  if (latestBonus.wife) el("bonus-vandana-month").value = String(latestBonus.wife.expectedMonth).padStart(2, "0");

  const list = el("oi-list");
  const items = Calc.getVariableIncomeForMonth(D.variableIncome, month).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="es-t">No other income logged this month</div><div class="es-s">Use the form above to add freelance, rent, or any side income</div></div>`;
  } else {
    list.innerHTML = items.map((it) => `
      <div class="oi-item">
        <div class="oi-ic">₹</div>
        <div class="oi-main"><div class="oi-name">${esc(it.source)}${it.note ? " · " + esc(it.note) : ""}</div>
          <div class="oi-sub">${it.date.slice(8, 10)} ${monthShortLabel(it.date.slice(0, 7))} · <span class="tag ${it.tag}" style="padding:1px 7px">${tagLabel(it.tag)}</span></div></div>
        <div class="oi-amt num">${inr(it.amount)}</div>
        <button class="icon-btn" data-del-income="${it.id}" aria-label="Delete" style="margin-left:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>
      </div>`).join("");
    list.querySelectorAll("[data-del-income]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this income entry?")) return;
        await DB.deleteVariableIncome(btn.dataset.delIncome);
        showToast("Income entry deleted");
      });
    });
  }
}

function wireMoneyBlurFormat(input) {
  input.addEventListener("blur", () => {
    const n = parseMoney(input.value);
    input.value = n ? inrPlain(n) : "";
  });
}
[el("income-ashwin"), el("income-vandana"), el("bonus-ashwin-amount"), el("bonus-vandana-amount"), el("oi-amount")].forEach(wireMoneyBlurFormat);

el("income-ashwin").addEventListener("change", async () => {
  const amount = parseMoney(el("income-ashwin").value);
  if (amount <= 0) return;
  await DB.setIncome({ contributor: "ashwin", month: currentRealMonth(), amount, uid: state.user.uid });
  showToast("Ashwin's income saved");
});
el("income-vandana").addEventListener("change", async () => {
  const amount = parseMoney(el("income-vandana").value);
  if (amount <= 0) return;
  await DB.setIncome({ contributor: "wife", month: currentRealMonth(), amount, uid: state.user.uid });
  showToast("Vandana's income saved");
});

el("bonus-save").addEventListener("click", async () => {
  const year = new Date().getFullYear();
  const jobs = [];
  const aAmt = parseMoney(el("bonus-ashwin-amount").value);
  if (aAmt > 0) {
    const aMonth = parseInt(el("bonus-ashwin-month").value, 10);
    const aYear = aMonth < (new Date().getMonth() + 1) ? year + 1 : year;
    jobs.push(DB.setAnnualBonus({ contributor: "ashwin", year: aYear, amount: aAmt, expectedMonth: aMonth, uid: state.user.uid }));
  }
  const vAmt = parseMoney(el("bonus-vandana-amount").value);
  if (vAmt > 0) {
    const vMonth = parseInt(el("bonus-vandana-month").value, 10);
    const vYear = vMonth < (new Date().getMonth() + 1) ? year + 1 : year;
    jobs.push(DB.setAnnualBonus({ contributor: "wife", year: vYear, amount: vAmt, expectedMonth: vMonth, uid: state.user.uid }));
  }
  if (!jobs.length) { showToast("Enter at least one bonus amount first", true); return; }
  await Promise.all(jobs);
  showToast("Bonus details saved");
});

el("oi-submit").addEventListener("click", async () => {
  const source = el("oi-source").value.trim();
  const amount = parseMoney(el("oi-amount").value);
  const date = el("oi-date").value;
  const tag = el("oi-tag").value;
  if (!source) { showToast("Enter a source for this income", true); return; }
  if (amount <= 0) { showToast("Enter an amount greater than zero", true); return; }
  if (!date) { showToast("Pick a date", true); return; }
  await DB.addVariableIncome({ source, amount, date, tag, uid: state.user.uid });
  el("oi-source").value = ""; el("oi-amount").value = "";
  showToast("Income added");
});

/* ======================================================================
   FIXED EXPENSES SCREEN
   ====================================================================== */
document.querySelectorAll("#fixed-filter [data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.fixedFilter = btn.dataset.filter;
    document.querySelectorAll("#fixed-filter [data-filter]").forEach((b) => b.classList.toggle("on", b === btn));
    renderFixed();
  });
});

function fixedRowHtml(e, loanInfo) {
  const isLoan = e.type === "loan" && e.loan;
  const isAnnual = e.frequency === "annual";
  let amountHtml = inr(e.amount) + (isAnnual ? "<small>/yr</small>" : "");
  let metaHtml = esc(e.category || "");
  if (!isLoan && !isAnnual && e.dueDay) metaHtml += (metaHtml ? " · " : "") + `<span class="due-day">due ${e.dueDay}${ordinalSuffix(e.dueDay)}</span>`;
  let chipHtml = isAnnual && e.dueMonth ? `<span class="chip-due">📅 Due: ${MONTH_NAMES[e.dueMonth - 1]}</span>` : "";
  let progHtml = "";
  if (isLoan && loanInfo) {
    const cls = loanInfo.paidPercent >= 90 ? "accent" : "";
    progHtml = `<div class="loan-prog"><div class="lp-track ${cls}"><span style="width:${loanInfo.paidPercent}%"></span></div>
      <div class="lp-meta"><span><b>${loanInfo.monthsPaid}</b> / ${loanInfo.tenureMonths} paid</span><span>Payoff <b>${monthShortLabel(loanInfo.projectedEndMonth)}</b></span></div></div>`;
  }
  return `
    <div class="exp-row ${e.tag}" data-id="${e.id}">
      <div class="exp-icon">${isLoan ? "🏦" : isAnnual ? "📅" : "💳"}</div>
      <div class="exp-main">
        <div class="exp-name">${esc(e.name)} <span class="tag ${e.tag}">● ${tagLabel(e.tag)}</span></div>
        <div class="exp-cat">${metaHtml}</div>
        ${chipHtml}
      </div>
      <div class="exp-right"><div class="exp-amt num">${amountHtml}</div></div>
      <div class="row-actions">
        <button class="icon-btn" data-edit-fixed="${e.id}" aria-label="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18 10l-4-4L4 16v4Z"/><path d="M13.5 6.5 17.5 10.5"/></svg></button>
        <button class="icon-btn" data-del-fixed="${e.id}" aria-label="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>
      </div>
      ${progHtml}
    </div>`;
}
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

function renderFixed() {
  const D = state.data;
  const totals = Calc.getFixedExpenseTotals(D.fixedExpenses);
  el("fixed-subtitle").textContent = "Recurring · " + inr(totals.total) + " / month equiv.";
  const loanSummaries = Calc.getLoanSummary(D.fixedExpenses, currentRealMonth());
  const loanById = {}; loanSummaries.forEach((l) => { loanById[l.id] = l; });

  const filter = state.fixedFilter;
  const matches = (e) => {
    if (filter === "all") return true;
    if (filter === "loan") return e.type === "loan";
    if (filter === "annual") return e.frequency === "annual" && e.type !== "loan";
    return e.frequency === "monthly" && e.type !== "loan";
  };
  const loans = D.fixedExpenses.filter((e) => e.type === "loan" && matches(e));
  const yearly = D.fixedExpenses.filter((e) => e.frequency === "annual" && e.type !== "loan" && matches(e));
  const monthly = D.fixedExpenses.filter((e) => e.frequency === "monthly" && e.type !== "loan" && matches(e));

  let html = "";
  if (loans.length) html += `<div class="section-label">Loans</div>` + loans.map((e) => fixedRowHtml(e, loanById[e.id])).join("");
  if (yearly.length) html += `<div class="section-label">Yearly commitments</div>` + yearly.map((e) => fixedRowHtml(e)).join("");
  if (monthly.length) html += `<div class="section-label">Monthly bills</div>` + monthly.map((e) => fixedRowHtml(e)).join("");
  if (!loans.length && !yearly.length && !monthly.length) {
    html = `<div class="empty-state"><div class="es-t">No fixed expenses yet</div><div class="es-s">Tap "+ Add expense" below to log a loan, bill, or yearly fee</div></div>`;
  }
  el("fixed-list").innerHTML = html;

  el("fixed-list").querySelectorAll("[data-edit-fixed]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = D.fixedExpenses.find((e) => e.id === btn.dataset.editFixed);
      if (item) openAddFixedExpenseModal(item);
    });
  });
  el("fixed-list").querySelectorAll("[data-del-fixed]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this fixed expense?")) return;
      await DB.deleteFixedExpense(btn.dataset.delFixed);
      showToast("Fixed expense deleted");
    });
  });
}

function openAddFixedExpenseModal(existing) {
  const isEdit = !!existing;
  const kind = isEdit ? (existing.type === "loan" ? "loan" : existing.frequency === "annual" ? "annual" : "monthly") : "monthly";
  const body = `
    <div class="seg full" id="fx-kind" style="margin-bottom:14px">
      <button type="button" class="${kind === "monthly" ? "on" : ""}" data-kind="monthly">Monthly bill</button>
      <button type="button" class="${kind === "annual" ? "on" : ""}" data-kind="annual">Yearly fee</button>
      <button type="button" class="${kind === "loan" ? "on" : ""}" data-kind="loan">Loan / EMI</button>
    </div>
    <div class="field-row"><label>Name</label><input class="ctrl" id="fx-name" type="text" placeholder="e.g. Home Loan EMI" value="${existing ? esc(existing.name) : ""}"></div>
    <div class="field-row"><label>Category</label><input class="ctrl" id="fx-category" type="text" placeholder="e.g. Housing" value="${existing ? esc(existing.category || "") : ""}"></div>
    <div class="field-row"><label>Amount ${kind === "annual" ? "(full yearly amount)" : "(per month)"}</label>
      <div class="money-input"><span class="cur">₹</span><input class="num" id="fx-amount" type="text" inputmode="numeric" value="${existing ? inrPlain(existing.amount) : ""}"></div></div>
    <div class="field-row" id="fx-dueday-row" style="display:${kind === "monthly" ? "block" : "none"}">
      <label>Due day of month (optional)</label><input class="ctrl" id="fx-dueday" type="number" min="1" max="31" value="${existing && existing.dueDay ? existing.dueDay : ""}"></div>
    <div class="field-row" id="fx-duemonth-row" style="display:${kind === "annual" ? "block" : "none"}">
      <label>Due month</label><select class="ctrl" id="fx-duemonth">${MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${existing && existing.dueMonth === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></div>
    <div class="field-row" id="fx-tenure-row" style="display:${kind === "loan" ? "block" : "none"}">
      <label>Total tenure (months)</label><input class="ctrl" id="fx-tenure" type="number" min="1" value="${existing && existing.loan ? existing.loan.tenureMonths : ""}"></div>
    <div class="field-row" id="fx-paid-row" style="display:${kind === "loan" ? "block" : "none"}">
      <label>Months already paid</label><input class="ctrl" id="fx-paid" type="number" min="0" value="${existing && existing.loan ? (existing.loan.tenureMonths - existing.loan.monthsRemaining) : ""}"></div>
    <div class="field-row"><label>Belongs to</label><select class="ctrl" id="fx-tag">
      <option value="household" ${existing && existing.tag === "household" ? "selected" : ""}>Household</option>
      <option value="ashwin" ${existing && existing.tag === "ashwin" ? "selected" : ""}>Ashwin</option>
      <option value="wife" ${existing && existing.tag === "wife" ? "selected" : ""}>Vandana</option></select></div>
    <div class="error-text" id="fx-error"></div>
    <button class="qa-btn" id="fx-submit" style="margin-top:6px">${isEdit ? "Save changes" : "+ Add fixed expense"}</button>
  `;
  openModal(isEdit ? "Edit fixed expense" : "Add fixed expense", body, (sheet) => {
    let currentKind = kind;
    sheet.querySelectorAll("#fx-kind [data-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentKind = btn.dataset.kind;
        sheet.querySelectorAll("#fx-kind [data-kind]").forEach((b) => b.classList.toggle("on", b === btn));
        el("fx-dueday-row").style.display = currentKind === "monthly" ? "block" : "none";
        el("fx-duemonth-row").style.display = currentKind === "annual" ? "block" : "none";
        el("fx-tenure-row").style.display = currentKind === "loan" ? "block" : "none";
        el("fx-paid-row").style.display = currentKind === "loan" ? "block" : "none";
      });
    });
    wireMoneyBlurFormat(el("fx-amount"));
    el("fx-submit").addEventListener("click", async () => {
      const name = el("fx-name").value.trim();
      const category = el("fx-category").value.trim();
      const amount = parseMoney(el("fx-amount").value);
      const tag = el("fx-tag").value;
      const errEl = el("fx-error");
      if (!name) return showFieldError(errEl, "Enter a name.");
      if (amount <= 0) return showFieldError(errEl, "Enter an amount greater than zero.");

      let payload = { name, category, tag, uid: state.user.uid };
      if (currentKind === "loan") {
        const tenure = parseInt(el("fx-tenure").value, 10);
        const paid = parseInt(el("fx-paid").value, 10) || 0;
        if (!tenure || tenure <= 0) return showFieldError(errEl, "Enter total tenure in months.");
        if (paid < 0 || paid > tenure) return showFieldError(errEl, "Months paid can't exceed total tenure.");
        payload = { ...payload, type: "loan", frequency: "monthly", amount, loan: { tenureMonths: tenure, monthsRemaining: tenure - paid } };
      } else if (currentKind === "annual") {
        const dueMonth = parseInt(el("fx-duemonth").value, 10);
        payload = { ...payload, type: "recurring", frequency: "annual", amount, dueMonth };
      } else {
        const dueDay = parseInt(el("fx-dueday").value, 10) || null;
        payload = { ...payload, type: "recurring", frequency: "monthly", amount, dueDay };
      }
      try {
        if (isEdit) await DB.updateFixedExpense(existing.id, payload);
        else await DB.addFixedExpense(payload);
        closeModal();
        showToast(isEdit ? "Fixed expense updated" : "Fixed expense added");
      } catch (err) {
        showFieldError(errEl, "Couldn't save: " + err.message);
      }
    });
  });
}
function showFieldError(errEl, msg) {
  errEl.textContent = msg;
  errEl.classList.add("show");
}

/* ======================================================================
   VARIABLE EXPENSES SCREEN
   ====================================================================== */
let variableScreenInit = false;
function renderVariable() {
  if (!variableScreenInit) {
    el("qa-date").value = new Date().toISOString().slice(0, 10);
    variableScreenInit = true;
  }
  const D = state.data;
  const byMonth = {};
  D.variableExpenses.forEach((e) => {
    const m = e.date.slice(0, 7);
    (byMonth[m] = byMonth[m] || []).push(e);
  });
  const months = Object.keys(byMonth).sort().reverse();
  const container = el("variable-expenses-container");
  if (!months.length) {
    container.innerHTML = `<div class="empty-state"><div class="es-t">No variable expenses logged yet</div><div class="es-s">Use Quick add above to log your first expense</div></div>`;
    return;
  }
  container.innerHTML = months.slice(0, 12).map((m) => {
    const items = byMonth[m].sort((a, b) => (a.date < b.date ? 1 : -1));
    const total = items.reduce((s, e) => s + e.amount, 0);
    const rows = items.map((e) => `
      <div class="exp-row ${e.tag}" data-id="${e.id}">
        <div class="exp-icon">🧾</div>
        <div class="exp-main"><div class="exp-name">${esc(e.category)}</div><div class="exp-cat">${e.date.slice(8, 10)} ${monthShortLabel(m)}${e.note ? " · " + esc(e.note) : ""}</div></div>
        <div class="exp-right"><div class="exp-amt num">${inr(e.amount)}</div><span class="tag ${e.tag}" style="margin-top:5px">● ${tagLabel(e.tag)}</span></div>
        <div class="row-actions"><button class="icon-btn" data-del-var="${e.id}" aria-label="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button></div>
      </div>`).join("");
    return `<div class="month-head"><div class="mt">${monthLabel(m)}</div><div class="ms num">${inr(total)}</div></div>${rows}`;
  }).join("");

  container.querySelectorAll("[data-del-var]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this expense?")) return;
      await DB.deleteVariableExpense(btn.dataset.delVar);
      showToast("Expense deleted");
    });
  });
}

wireMoneyBlurFormat(el("qa-amount"));
el("qa-submit").addEventListener("click", async () => {
  const category = el("qa-category").value;
  const amount = parseMoney(el("qa-amount").value);
  const date = el("qa-date").value;
  const tag = el("qa-tag").value;
  const note = el("qa-note").value.trim();
  if (amount <= 0) { showToast("Enter an amount greater than zero", true); return; }
  if (!date) { showToast("Pick a date", true); return; }
  await DB.addVariableExpense({ category, amount, date, tag, note, uid: state.user.uid });
  el("qa-amount").value = ""; el("qa-note").value = "";
  showToast("Expense added");
});

/* ======================================================================
   LOANS & PENDING SCREEN
   ====================================================================== */
function hlStatusOf(h) {
  if (h.outstandingAmount <= 0) return "settled";
  if (h.outstandingAmount < h.principalAmount) return "partial";
  return "fully";
}
function hlCardHtml(h) {
  const status = hlStatusOf(h);
  const isOwe = h.direction === "borrowed";
  const initial = (h.counterparty || "?").trim().charAt(0).toUpperCase() || "?";
  const avatarColor = status === "settled" ? "var(--text-3)" : (isOwe ? "var(--danger)" : "var(--accent)");
  const balClass = status === "settled" ? "settled" : (isOwe ? "owe" : "owed");
  const paidPct = h.principalAmount > 0 ? Math.round(((h.principalAmount - h.outstandingAmount) / h.principalAmount) * 100) : 0;
  let progHtml = "";
  if (status !== "settled" && (h.monthlyRepayment || paidPct > 0)) {
    progHtml = `<div class="loan-prog" style="border-top:0;padding-top:12px"><div class="lp-track ${isOwe ? "warn" : "accent"}"><span style="width:${paidPct}%"></span></div>
      <div class="lp-meta"><span><b>${inr(h.principalAmount - h.outstandingAmount)}</b> ${isOwe ? "paid" : "received"}</span><span>${paidPct}% ${isOwe ? "repaid" : "repaid"}</span></div></div>`;
  } else if (status !== "settled" && h.expectedDate) {
    progHtml = `<div class="hl-chip">📅 Expected by ${esc(h.expectedDate)}</div>`;
  }
  const sub = h.monthlyRepayment ? `Structured · ${inr(h.monthlyRepayment)} / month` : "Casual · no repayment plan";
  return `
    <div class="card hl-card" data-id="${h.id}">
      <div class="hl-top">
        <div class="hl-idl"><div class="hl-av" style="background:${avatarColor}">${esc(initial)}</div><div><div class="hl-name">${esc(h.counterparty)}</div><div class="hl-sub">${sub}</div></div></div>
        <div class="hl-pills"><span class="dir-tag ${isOwe ? "owe" : "owed"}">${isOwe ? "You owe" : "Owed to you"}</span>
          <span class="status-pill ${status}">${status === "fully" ? "Fully owed" : status === "partial" ? "Partially " + (isOwe ? "paid" : "received") : "Settled"}</span></div>
      </div>
      <div class="hl-bal ${balClass} num">${inr(h.outstandingAmount)} <small>${status === "settled" ? "of " + inr(h.principalAmount) + " · cleared" : "of " + inr(h.principalAmount) + " outstanding"}</small></div>
      ${progHtml}
      <div class="hl-actions"><span class="hl-note">${esc(h.notes || "")}</span>
        <button class="btn-log ${status === "settled" ? "settled" : ""}" data-log="${h.id}" ${status === "settled" ? "disabled" : ""}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>${status === "settled" ? "Settled" : "Log payment"}</button></div>
      <div class="row-actions" style="margin-top:10px"><button class="icon-btn" data-del-loan="${h.id}" aria-label="Delete">🗑</button></div>
    </div>`;
}

function renderLoans() {
  const D = state.data;
  const totals = Calc.getHandLoanTotals(D.handLoans);
  el("loans-subtitle").textContent = `You owe ${inr(totals.borrowedOutstanding)} · Owed to you ${inr(totals.lentOutstanding)}`;

  const owed = D.handLoans.filter((h) => h.direction === "lent" && h.outstandingAmount > 0);
  const owe = D.handLoans.filter((h) => h.direction === "borrowed" && h.outstandingAmount > 0);
  const settled = D.handLoans.filter((h) => h.outstandingAmount <= 0);

  let html = "";
  if (owed.length) html += `<div class="section-label">Owed to you</div>` + owed.map(hlCardHtml).join("");
  if (owe.length) html += `<div class="section-label">You owe</div>` + owe.map(hlCardHtml).join("");
  if (settled.length) html += `<div class="section-label">Settled</div>` + settled.map(hlCardHtml).join("");
  if (!D.handLoans.length) {
    html = `<div class="empty-state"><div class="es-t">No loans or pending payments yet</div><div class="es-s">Tap "+ Add" below for a loan, or money owed to you by anyone</div></div>`;
  }
  el("loans-container").innerHTML = html;

  el("loans-container").querySelectorAll("[data-log]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const h = D.handLoans.find((x) => x.id === btn.dataset.log);
      if (h) openLogPaymentModal(h);
    });
  });
  el("loans-container").querySelectorAll("[data-del-loan]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this entry entirely? This can't be undone.")) return;
      await DB.deleteHandLoan(btn.dataset.delLoan);
      showToast("Entry deleted");
    });
  });
}

function openAddHandLoanModal() {
  const body = `
    <div class="seg full" id="hl-direction" style="margin-bottom:14px">
      <button type="button" class="on" data-dir="borrowed">You owe them</button>
      <button type="button" data-dir="lent">Owed to you</button>
    </div>
    <div class="field-row"><label>Counterparty name</label><input class="ctrl" id="hl-counterparty" type="text" placeholder="e.g. Ravi Kumar"></div>
    <div class="field-row"><label>Amount</label><div class="money-input"><span class="cur">₹</span><input class="num" id="hl-amount" type="text" inputmode="numeric"></div></div>
    <div class="field-row"><label>Monthly repayment (optional — leave blank if casual/one-off)</label><div class="money-input"><span class="cur">₹</span><input class="num" id="hl-monthly" type="text" inputmode="numeric" placeholder="0"></div></div>
    <div class="field-row"><label>Expected by (optional, for casual pending payments)</label><input class="ctrl" id="hl-expected" type="month"></div>
    <div class="field-row"><label>Tag</label><select class="ctrl" id="hl-tag">
      <option value="household">Household</option><option value="ashwin">Ashwin</option><option value="wife">Vandana</option></select></div>
    <div class="field-row"><label>Notes (optional)</label><input class="ctrl" id="hl-notes" type="text" placeholder="e.g. Started Mar 2026"></div>
    <div class="error-text" id="hl-error"></div>
    <button class="qa-btn" id="hl-submit" style="margin-top:6px">+ Add</button>
  `;
  openModal("Add loan / pending payment", body, (sheet) => {
    let direction = "borrowed";
    sheet.querySelectorAll("#hl-direction [data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        direction = btn.dataset.dir;
        sheet.querySelectorAll("#hl-direction [data-dir]").forEach((b) => b.classList.toggle("on", b === btn));
      });
    });
    wireMoneyBlurFormat(el("hl-amount"));
    wireMoneyBlurFormat(el("hl-monthly"));
    el("hl-submit").addEventListener("click", async () => {
      const counterparty = el("hl-counterparty").value.trim();
      const principalAmount = parseMoney(el("hl-amount").value);
      const monthlyRepayment = parseMoney(el("hl-monthly").value) || null;
      const expectedDate = el("hl-expected").value || null;
      const tag = el("hl-tag").value;
      const notes = el("hl-notes").value.trim();
      const errEl = el("hl-error");
      if (!counterparty) return showFieldError(errEl, "Enter a name.");
      if (principalAmount <= 0) return showFieldError(errEl, "Enter an amount greater than zero.");
      try {
        await DB.addHandLoan({ direction, counterparty, principalAmount, monthlyRepayment, expectedDate, tag, notes, uid: state.user.uid });
        closeModal();
        showToast("Added");
      } catch (err) {
        showFieldError(errEl, "Couldn't save: " + err.message);
      }
    });
  });
}

function openLogPaymentModal(h) {
  const isOwe = h.direction === "borrowed";
  const body = `
    <div class="field-row"><label>${isOwe ? "Payment amount" : "Amount received"} (max ${inr(h.outstandingAmount)})</label>
      <div class="money-input"><span class="cur">₹</span><input class="num" id="lp-amount" type="text" inputmode="numeric"></div></div>
    <div class="error-text" id="lp-error"></div>
    <button class="qa-btn" id="lp-submit" style="margin-top:6px">Log ${isOwe ? "payment" : "receipt"}</button>
  `;
  openModal(`${isOwe ? "Log payment to" : "Log receipt from"} ${h.counterparty}`, body, () => {
    wireMoneyBlurFormat(el("lp-amount"));
    el("lp-submit").addEventListener("click", async () => {
      const amount = parseMoney(el("lp-amount").value);
      const errEl = el("lp-error");
      if (amount <= 0) return showFieldError(errEl, "Enter an amount greater than zero.");
      if (amount > h.outstandingAmount) return showFieldError(errEl, `Can't log more than the outstanding ${inr(h.outstandingAmount)}.`);
      await DB.logHandLoanRepayment(h.id, amount, state.user.uid);
      closeModal();
      showToast("Logged");
    });
  });
}

/* ======================================================================
   SAVINGS GOALS SCREEN
   ====================================================================== */
function goalCardHtml(g) {
  const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentSaved / g.targetAmount) * 100)) : 0;
  return `
    <div class="card goal" data-id="${g.id}">
      <div class="goal-head"><div><div class="goal-name">${esc(g.name)} ${g.isEmergencyFund ? '<span class="badge-ef">Emergency</span>' : ""}</div>
        <div class="goal-sub">${inr(g.monthlyContribution)} / month</div></div><div class="goal-pct ${g.isEmergencyFund ? "ef" : ""} num">${pct}%</div></div>
      <div class="goal-track ${g.isEmergencyFund ? "ef" : ""}"><span style="width:${pct}%"></span></div>
      <div class="goal-figs"><div class="saved num">${inr(g.currentSaved)} saved</div><div class="target num">of ${inr(g.targetAmount)}</div></div>
      <div class="hl-actions" style="margin-top:12px"><span></span>
        <button class="btn-log" data-log-goal="${g.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Log contribution</button>
        <button class="icon-btn" data-del-goal="${g.id}" aria-label="Delete" style="margin-left:8px">🗑</button></div>
    </div>`;
}

function renderSavings() {
  const D = state.data;
  const totalMonthly = D.savingsGoals.reduce((s, g) => s + g.monthlyContribution, 0);
  el("savings-subtitle").textContent = `${D.savingsGoals.length} active · ${inr(totalMonthly)} / month set aside`;
  const container = el("savings-container");
  if (!D.savingsGoals.length) {
    container.innerHTML = `<div class="empty-state"><div class="es-t">No savings goals yet</div><div class="es-s">Start with an Emergency Fund — tap "+ Add goal" below</div></div>`;
    return;
  }
  container.innerHTML = D.savingsGoals.map(goalCardHtml).join("");
  container.querySelectorAll("[data-log-goal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = D.savingsGoals.find((x) => x.id === btn.dataset.logGoal);
      if (g) openLogContributionModal(g);
    });
  });
  container.querySelectorAll("[data-del-goal]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this savings goal?")) return;
      await DB.deleteSavingsGoal(btn.dataset.delGoal);
      showToast("Goal deleted");
    });
  });
}

function openAddSavingsGoalModal() {
  const body = `
    <div class="field-row"><label>Goal name</label><input class="ctrl" id="sg-name" type="text" placeholder="e.g. Emergency Fund"></div>
    <div class="field-row"><label>Target amount</label><div class="money-input"><span class="cur">₹</span><input class="num" id="sg-target" type="text" inputmode="numeric"></div></div>
    <div class="field-row"><label>Monthly contribution</label><div class="money-input"><span class="cur">₹</span><input class="num" id="sg-monthly" type="text" inputmode="numeric"></div></div>
    <div class="field-row"><label>Tag</label><select class="ctrl" id="sg-tag">
      <option value="household">Household</option><option value="ashwin">Ashwin</option><option value="wife">Vandana</option></select></div>
    <div class="field-row"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);"><input type="checkbox" id="sg-ef"> This is our Emergency Fund</label></div>
    <div class="hint">Only mark one goal as the Emergency Fund — the dashboard uses it to calculate months of coverage.</div>
    <div class="error-text" id="sg-error"></div>
    <button class="qa-btn" id="sg-submit" style="margin-top:12px">+ Add goal</button>
  `;
  openModal("Add savings goal", body, () => {
    wireMoneyBlurFormat(el("sg-target"));
    wireMoneyBlurFormat(el("sg-monthly"));
    el("sg-submit").addEventListener("click", async () => {
      const name = el("sg-name").value.trim();
      const targetAmount = parseMoney(el("sg-target").value);
      const monthlyContribution = parseMoney(el("sg-monthly").value);
      const tag = el("sg-tag").value;
      const isEmergencyFund = el("sg-ef").checked;
      const errEl = el("sg-error");
      if (!name) return showFieldError(errEl, "Enter a goal name.");
      if (targetAmount <= 0) return showFieldError(errEl, "Enter a target amount greater than zero.");
      if (isEmergencyFund && state.data.savingsGoals.some((g) => g.isEmergencyFund)) {
        return showFieldError(errEl, "You already have an Emergency Fund goal. Unmark the old one first.");
      }
      try {
        await DB.addSavingsGoal({ name, targetAmount, monthlyContribution, isEmergencyFund, tag, uid: state.user.uid });
        closeModal();
        showToast("Goal added");
      } catch (err) {
        showFieldError(errEl, "Couldn't save: " + err.message);
      }
    });
  });
}

function openLogContributionModal(g) {
  const body = `
    <div class="field-row"><label>Amount saved</label><div class="money-input"><span class="cur">₹</span><input class="num" id="lc-amount" type="text" inputmode="numeric"></div></div>
    <div class="error-text" id="lc-error"></div>
    <button class="qa-btn" id="lc-submit" style="margin-top:6px">Log contribution</button>
  `;
  openModal(`Log contribution — ${g.name}`, body, () => {
    wireMoneyBlurFormat(el("lc-amount"));
    el("lc-submit").addEventListener("click", async () => {
      const amount = parseMoney(el("lc-amount").value);
      const errEl = el("lc-error");
      if (amount <= 0) return showFieldError(errEl, "Enter an amount greater than zero.");
      await DB.logSavingsContribution(g.id, amount, state.user.uid);
      closeModal();
      showToast("Contribution logged");
    });
  });
}

/* ======================================================================
   PLANNER SCREEN
   ====================================================================== */
document.querySelectorAll("#horizon-toggle [data-horizon]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.plannerHorizon = parseInt(btn.dataset.horizon, 10);
    document.querySelectorAll("#horizon-toggle [data-horizon]").forEach((b) => b.classList.toggle("on", b === btn));
    renderPlanner();
  });
});
el("planned-add-toggle").addEventListener("click", () => {
  state.planFormOpen = !state.planFormOpen;
  el("planned-form").style.display = state.planFormOpen ? "block" : "none";
});
el("plan-submit").addEventListener("click", async () => {
  const name = el("plan-name").value.trim();
  const amount = parseMoney(el("plan-amount").value);
  const targetMonth = el("plan-month").value;
  const category = el("plan-category").value;
  const tag = el("plan-tag").value;
  if (!name) { showToast("Enter a name for this planned expense", true); return; }
  if (amount <= 0) { showToast("Enter an amount greater than zero", true); return; }
  if (!targetMonth) { showToast("Pick a target month", true); return; }
  await DB.addPlannedExpense({ name, amount, targetMonth, category, tag, uid: state.user.uid });
  el("plan-name").value = ""; el("plan-amount").value = "";
  showToast("Planned expense added");
});
wireMoneyBlurFormat(el("plan-amount"));

let chartPlanner = null;
let currentForecast = [];

function buildForecast() {
  const D = state.data;
  currentForecast = Calc.getForecast({
    fixedExpenses: D.fixedExpenses, incomeDocs: D.income, bonusIncomeDocs: D.bonusIncome,
    variableIncomeDocs: D.variableIncome, variableExpenses: D.variableExpenses, handLoans: D.handLoans,
    plannedExpenses: D.plannedExpenses, monthsForward: state.plannerHorizon, referenceMonth: currentRealMonth()
  });
  return currentForecast;
}

function eventColorFor(entry) {
  if (entry.loansEnding.length) return "#4E9C8B";
  if (entry.bonusReceived.length) return "#5B87A8";
  if (entry.annualDue.length) return "#CF9A44";
  if (entry.plannedExpenses.length) return "#AE7896";
  return "#4E9C8B";
}
function isEventMonth(entry) {
  return entry.loansEnding.length || entry.annualDue.length || entry.bonusReceived.length || entry.plannedExpenses.length;
}

function renderPlanner() {
  const D = state.data;
  const forecast = buildForecast();
  const currentSurplus = forecast[0] ? forecast[0].surplus : 0;
  const loanSummaries = Calc.getLoanSummary(D.fixedExpenses, currentRealMonth());
  const lastLoanEnd = loanSummaries.length ? Math.max(...loanSummaries.map((l) => l.monthsRemaining)) : 0;
  const afterLoansEntry = lastLoanEnd > 0 && lastLoanEnd < forecast.length ? forecast[lastLoanEnd] : forecast[forecast.length - 1];
  el("co-surplus-today").textContent = inr(currentSurplus);
  if (loanSummaries.length && afterLoansEntry) {
    el("co-surplus-after").textContent = inr(afterLoansEntry.surplus);
    el("co-surplus-freed").textContent = (afterLoansEntry.surplus - currentSurplus >= 0 ? "+" : "") + inr(afterLoansEntry.surplus - currentSurplus) + " / month freed";
  } else {
    el("co-surplus-after").textContent = inr(currentSurplus);
    el("co-surplus-freed").textContent = "No active loans";
  }

  ensurePlannerChart();
  chartPlanner.data.labels = forecast.map((f) => monthShortLabel(f.month));
  chartPlanner.data.datasets[0].data = forecast.map((f) => f.surplus);
  chartPlanner.data.datasets[0].pointRadius = forecast.map((f) => isEventMonth(f) ? 5 : 0);
  chartPlanner.data.datasets[0].pointBackgroundColor = forecast.map(eventColorFor);
  chartPlanner.update("none");

  syncPlannerJump(forecast);
  renderPlannerTimeline(forecast, loanSummaries);
}

function ensurePlannerChart() {
  if (chartPlanner) return;
  const ctx = el("chart-planner").getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 240);
  g.addColorStop(0, "rgba(78,156,139,.20)"); g.addColorStop(1, "rgba(78,156,139,0)");
  chartPlanner = new Chart(el("chart-planner"), {
    type: "line",
    data: { labels: [], datasets: [{ label: "Projected surplus", data: [], borderColor: "#4E9C8B", backgroundColor: g, fill: true, borderWidth: 2.5, tension: 0.3, pointRadius: [], pointBackgroundColor: [], pointBorderColor: "#fff", pointBorderWidth: 1.5, pointHoverRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: "index" },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " Surplus: " + inr(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10.5, weight: "600" }, maxRotation: 0 } },
        y: { grid: { color: "#EDEBE3" }, border: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 11 }, callback: (val) => "₹" + Math.round(val / 1000) + "k" } }
      }
    }
  });
}

let plannerJumpHorizon = null;
function syncPlannerJump(forecast) {
  const sel = el("planner-jump");
  if (plannerJumpHorizon === state.plannerHorizon && sel.options.length) return;
  sel.innerHTML = '<option value="-1">Select a month…</option>' + forecast.map((f, i) => `<option value="${i}">${monthLabel(f.month)}</option>`).join("");
  plannerJumpHorizon = state.plannerHorizon;
  el("planner-detail").style.display = "none";
}
el("planner-jump").addEventListener("change", (e) => {
  const idx = parseInt(e.target.value, 10);
  if (idx < 0) { el("planner-detail").style.display = "none"; return; }
  showPlannerDetail(idx);
});

function showPlannerDetail(idx) {
  const f = currentForecast[idx];
  if (!f) return;
  const plannedTotal = f.plannedExpenses.reduce((s, p) => s + p.amount, 0);
  const derivedVariable = f.totalIncome - f.totalFixed - plannedTotal - f.surplus;

  const notes = [];
  f.loansEnding.forEach((n) => notes.push(`🎉 ${n} EMI ends this month`));
  f.annualDue.forEach((a) => notes.push(`📅 ${a.name} due (${inr(a.amount)}, already counted in fixed bills below)`));
  f.bonusReceived.forEach((b) => notes.push(`🎁 ${displayNameFor(b.contributor)}'s bonus arrives (${inr(b.amount)}, already counted in income below)`));

  const incomeRows = [{ n: "Total income", a: f.totalIncome, income: true }];
  const oblRows = [{ n: "Fixed bills, EMIs & hand-loan repayments", a: f.totalFixed }];
  f.plannedExpenses.forEach((p) => oblRows.push({ n: "Planned: " + p.name, a: p.amount }));
  oblRows.push({ n: "Everyday spending (average)", a: Math.max(0, derivedVariable) });

  const rowHtml = (r) => `<div class="pd-line${r.income ? " income" : ""}"><div class="pd-n">${esc(r.n)}</div><div class="pd-a">${r.income ? "+" : ""}${inr(r.a)}</div></div>`;
  el("pd-month").textContent = monthLabel(f.month);
  const notesHtml = notes.length ? `<div style="font-size:11.5px;color:var(--text-2);font-weight:500;margin-bottom:10px;line-height:1.6">${notes.map(esc).join("<br>")}</div>` : "";
  el("pd-income-rows").innerHTML = notesHtml + incomeRows.map(rowHtml).join("");
  el("pd-oblig-rows").innerHTML = oblRows.map(rowHtml).join("");
  const pos = f.surplus >= 0;
  el("pd-badge").className = "pd-badge " + (pos ? "pos" : "neg");
  el("pd-badge").textContent = pos ? "Surplus month" : "Deficit month";
  el("pd-total-v").className = "pt-v num " + (pos ? "pos" : "neg");
  el("pd-total-v").textContent = (pos ? "+" : "") + inr(f.surplus);
  el("pd-total-k").textContent = pos ? "Net surplus" : "Net deficit";
  el("planner-detail").style.display = "block";
}

function renderPlannerTimeline(forecast, loanSummaries) {
  const events = [];
  forecast.forEach((f) => {
    f.loansEnding.forEach((name) => {
      const loan = loanSummaries.find((l) => l.name === name);
      events.push({ type: "payoff", month: f.month, title: name + " paid off", note: loan ? `Frees up ${inr(loan.emi)} / month of surplus` : "" });
    });
    f.annualDue.forEach((a) => {
      events.push({ type: "fee", month: f.month, title: a.name, note: `Annual payment of ${inr(a.amount)} leaves the account` });
    });
    f.bonusReceived.forEach((b) => {
      events.push({ type: "bonus", month: f.month, title: displayNameFor(b.contributor) + " annual bonus", note: `Expected inflow of ${inr(b.amount)}` });
    });
    f.plannedExpenses.forEach((p) => {
      const full = state.data.plannedExpenses.find((x) => x.name === p.name && x.targetMonth === f.month);
      events.push({ type: "planned", month: f.month, title: p.name, note: `Planned expense of ${inr(p.amount)}`, tag: full ? full.tag : "household", id: full ? full.id : null });
    });
  });
  events.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  const timeline = el("planner-timeline");
  if (!events.length) {
    timeline.innerHTML = `<div class="empty-state"><div class="es-t">No upcoming events in this window</div><div class="es-s">Add a planned expense, or extend the horizon above</div></div>`;
    return;
  }
  timeline.innerHTML = events.map((ev) => `
    <div class="tl-item${ev.type === "planned" ? " planned" : ""}" data-type="${ev.type}">
      <div class="tl-dot ${ev.type}"></div>
      <div class="tl-body">
        <div class="tl-when">${monthLabel(ev.month)}</div>
        <div class="tl-title">${esc(ev.title)}${ev.tag ? ` <span class="tag ${ev.tag}" style="padding:1px 7px;margin-left:4px">${tagLabel(ev.tag)}</span>` : ""}</div>
        <div class="tl-note">${ev.type === "payoff" ? '<span class="tl-free">' + esc(ev.note) + "</span>" : esc(ev.note)}</div>
      </div>
      ${ev.type === "planned" && ev.id ? `<div class="row-actions"><button class="icon-btn" data-del-planned="${ev.id}" aria-label="Delete">🗑</button></div>` : ""}
    </div>`).join("");

  timeline.querySelectorAll("[data-del-planned]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this planned expense?")) return;
      await DB.deletePlannedExpense(btn.dataset.delPlanned);
      showToast("Planned expense deleted");
    });
  });
}

/* ======================================================================
   SETTINGS SCREEN + EXCEL EXPORT
   ====================================================================== */
function renderSettings() {
  el("acct-email-ashwin").textContent = "ashwinkanth52@gmail.com";
  el("acct-email-vandana").textContent = "vandana.noorla@gmail.com";
}

el("btn-export").addEventListener("click", () => {
  if (typeof XLSX === "undefined") { showToast("Export library didn't load — check your connection", true); return; }
  const D = state.data;
  const wb = XLSX.utils.book_new();

  const fmtDate = (ts) => {
    if (!ts) return "";
    if (ts.toDate) return ts.toDate().toISOString().slice(0, 10);
    return "";
  };

  const sheets = {
    Income: D.income.map((r) => ({ Contributor: tagLabel(r.contributor === "ashwin" ? "ashwin" : "wife"), Month: r.month, Amount: r.amount, "Entered By": r.enteredByName || "", "Updated At": fmtDate(r.updatedAt) })),
    "Annual Bonus": D.bonusIncome.map((r) => ({ Contributor: tagLabel(r.contributor === "ashwin" ? "ashwin" : "wife"), Year: r.year, Amount: r.amount, "Expected Month": MONTH_NAMES[r.expectedMonth - 1], "Entered By": r.enteredByName || "" })),
    "Other Income": D.variableIncome.map((r) => ({ Source: r.source, Amount: r.amount, Date: r.date, Note: r.note, Tag: tagLabel(r.tag), "Entered By": r.enteredByName || "" })),
    "Fixed Expenses": D.fixedExpenses.map((r) => ({
      Name: r.name, Category: r.category, Type: r.type, Frequency: r.frequency, Amount: r.amount, Tag: tagLabel(r.tag),
      "Due Day": r.dueDay || "", "Due Month": r.dueMonth ? MONTH_NAMES[r.dueMonth - 1] : "",
      "Loan Tenure (months)": r.loan ? r.loan.tenureMonths : "", "Loan Months Remaining": r.loan ? r.loan.monthsRemaining : "",
      "Entered By": r.enteredByName || ""
    })),
    "Variable Expenses": D.variableExpenses.map((r) => ({ Category: r.category, Amount: r.amount, Date: r.date, Note: r.note, Tag: tagLabel(r.tag), "Entered By": r.enteredByName || "" })),
    "Loans & Pending": D.handLoans.map((r) => ({
      Direction: r.direction === "borrowed" ? "You owe" : "Owed to you", Counterparty: r.counterparty,
      "Principal": r.principalAmount, "Outstanding": r.outstandingAmount, "Monthly Repayment": r.monthlyRepayment || "",
      "Expected Date": r.expectedDate || "", Tag: tagLabel(r.tag), Notes: r.notes || "", "Entered By": r.enteredByName || ""
    })),
    "Savings Goals": D.savingsGoals.map((r) => ({
      Name: r.name, "Target": r.targetAmount, "Monthly Contribution": r.monthlyContribution, "Current Saved": r.currentSaved,
      "Emergency Fund": r.isEmergencyFund ? "Yes" : "No", Tag: tagLabel(r.tag), "Entered By": r.enteredByName || ""
    })),
    "Planned Expenses": D.plannedExpenses.map((r) => ({ Name: r.name, Amount: r.amount, "Target Month": r.targetMonth, Category: r.category, Tag: tagLabel(r.tag), "Entered By": r.enteredByName || "" }))
  };

  Object.entries(sheets).forEach(([name, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "No data": "Nothing logged yet" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `household-finance-${today}.xlsx`);
  showToast("Exported");
});

/* ======================================================================
   INIT
   ====================================================================== */
setView("dashboard");
