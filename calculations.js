// calculations.js
// Pure functions only — no Firestore calls, no side effects. Take arrays of
// plain data (already fetched via data.js listeners) and return numbers.
// Kept separate from data.js on purpose: this is the logic that can be unit
// tested and eyeballed for correctness without touching a live database.

/* ---------------------------------------------------------------------- *
 * SALARY INCOME (the two fixed monthly salaries)
 * ---------------------------------------------------------------------- */

/**
 * income: array of { contributor: "ashwin"|"wife", month: "YYYY-MM", amount }
 * Returns the latest entry per contributor at or before `month`
 * (falls back to most recent known income if nothing logged for that month yet).
 */
export function getHouseholdIncome(incomeDocs, month) {
  const byContributor = { ashwin: null, wife: null };
  for (const c of ["ashwin", "wife"]) {
    const entries = incomeDocs
      .filter((d) => d.contributor === c && d.month <= month)
      .sort((a, b) => (a.month < b.month ? 1 : -1)); // newest first
    byContributor[c] = entries.length ? entries[0].amount : 0;
  }
  return {
    ashwin: byContributor.ashwin,
    wife: byContributor.wife,
    combined: byContributor.ashwin + byContributor.wife
  };
}

/* ---------------------------------------------------------------------- *
 * ANNUAL BONUS
 * Smoothed into the steady monthly view (amount/12); shown as a full spike
 * in its expected month in the forecast. Uses each contributor's most
 * recently logged bonus as the assumption for "typical" bonus going forward.
 * ---------------------------------------------------------------------- */

export function getLatestBonusPerContributor(bonusIncomeDocs) {
  const result = { ashwin: null, wife: null };
  for (const c of ["ashwin", "wife"]) {
    const entries = bonusIncomeDocs
      .filter((b) => b.contributor === c)
      .sort((a, b) => b.year - a.year);
    result[c] = entries.length ? entries[0] : null;
  }
  return result;
}

export function getSmoothedBonusIncome(bonusIncomeDocs) {
  const latest = getLatestBonusPerContributor(bonusIncomeDocs);
  const ashwin = latest.ashwin ? latest.ashwin.amount / 12 : 0;
  const wife = latest.wife ? latest.wife.amount / 12 : 0;
  return { ashwin, wife, combined: ashwin + wife };
}

/* ---------------------------------------------------------------------- *
 * VARIABLE INCOME (side income — freelance, rental, business payouts, etc.)
 * Not smoothed — this is actual money that landed in a given month, added
 * straight into that month's combined income.
 * ---------------------------------------------------------------------- */

export function getVariableIncomeForMonth(variableIncomeDocs, month) {
  return variableIncomeDocs.filter((e) => e.date.startsWith(month));
}

export function getVariableIncomeTotals(variableIncomeForMonth) {
  const byTag = { ashwin: 0, wife: 0, household: 0 };
  for (const e of variableIncomeForMonth) {
    byTag[e.tag] = (byTag[e.tag] || 0) + e.amount;
  }
  return {
    ashwin: byTag.ashwin,
    wife: byTag.wife,
    household: byTag.household,
    total: byTag.ashwin + byTag.wife + byTag.household
  };
}

/* ---------------------------------------------------------------------- *
 * FIXED EXPENSES (loans/EMIs, monthly bills, annual fees like school fees)
 * ---------------------------------------------------------------------- */

/**
 * Smoothed monthly value of a single fixed expense, regardless of its
 * billing frequency. This is what feeds the steady, predictable dashboard
 * numbers — a ₹60,000 annual school fee counts as ₹5,000/month here.
 */
function monthlyEquivalent(expense) {
  if (expense.frequency === "annual") {
    return expense.amount / 12;
  }
  return expense.amount; // "monthly" (includes loans, which are always monthly)
}

/**
 * fixedExpenses: array of { amount, tag, frequency }
 * Returns smoothed monthly total + breakdown by tag. Loans and monthly
 * recurring bills count at full value; annual items (school fees etc.)
 * count at amount/12.
 */
export function getFixedExpenseTotals(fixedExpenses) {
  const byTag = { ashwin: 0, wife: 0, household: 0 };
  for (const e of fixedExpenses) {
    byTag[e.tag] = (byTag[e.tag] || 0) + monthlyEquivalent(e);
  }
  return {
    ashwin: byTag.ashwin,
    wife: byTag.wife,
    household: byTag.household,
    total: byTag.ashwin + byTag.wife + byTag.household
  };
}

/**
 * Surfaces annual lump-sum payments (school fees, annual insurance, etc.)
 * that fall due within the lookahead window, with their REAL amount (not
 * smoothed) — so the dashboard can flag "₹85,000 due in June for School Fee
 * - Aryan" instead of quietly averaging it away.
 * monthsAhead: how far forward to look (default 3)
 */
export function getUpcomingAnnualPayments(fixedExpenses, monthsAhead = 3, referenceMonth) {
  const ref = referenceMonth ? new Date(referenceMonth + "-01") : new Date();
  const upcoming = [];

  for (const e of fixedExpenses) {
    if (e.frequency !== "annual" || !e.dueMonth) continue;
    for (let i = 0; i <= monthsAhead; i++) {
      const d = new Date(ref.getFullYear(), ref.getMonth() + i, 1);
      if (d.getMonth() + 1 === e.dueMonth) {
        upcoming.push({
          name: e.name,
          amount: e.amount,
          tag: e.tag,
          dueMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          monthsAway: i
        });
        break; // only the next occurrence, not every year in the window
      }
    }
  }

  return upcoming.sort((a, b) => a.monthsAway - b.monthsAway);
}

/* ---------------------------------------------------------------------- *
 * HAND LOANS (informal loans to/from family & friends)
 * Only "borrowed" loans with a monthlyRepayment count against the
 * household's monthly obligations. "lent" loans (money owed TO you) are
 * tracked for visibility only and never reduce your surplus — you don't
 * lose money by having lent it, you just don't have it in hand.
 * ---------------------------------------------------------------------- */

export function getHandLoanTotals(handLoans) {
  const byTag = { ashwin: 0, wife: 0, household: 0 };
  let borrowedOutstanding = 0;
  let lentOutstanding = 0;

  for (const h of handLoans) {
    if (h.direction === "borrowed") {
      borrowedOutstanding += h.outstandingAmount;
      if (h.monthlyRepayment) {
        byTag[h.tag] = (byTag[h.tag] || 0) + h.monthlyRepayment;
      }
    } else if (h.direction === "lent") {
      lentOutstanding += h.outstandingAmount;
    }
  }

  return {
    borrowedOutstanding,
    lentOutstanding,
    monthlyBorrowedRepayment: byTag.ashwin + byTag.wife + byTag.household,
    monthlyBorrowedRepaymentByTag: byTag
  };
}

/* ---------------------------------------------------------------------- *
 * VARIABLE EXPENSES
 * date: "YYYY-MM-DD"
 * tag:  "ashwin" | "wife" | "household"
 * ---------------------------------------------------------------------- */

export function getVariableExpensesForMonth(variableExpenses, month) {
  return variableExpenses.filter((e) => e.date.startsWith(month));
}

export function getVariableTotals(variableExpensesForMonth) {
  const byTag = { ashwin: 0, wife: 0, household: 0 };
  for (const e of variableExpensesForMonth) {
    byTag[e.tag] = (byTag[e.tag] || 0) + e.amount;
  }
  return {
    ashwin: byTag.ashwin,
    wife: byTag.wife,
    household: byTag.household,
    total: byTag.ashwin + byTag.wife + byTag.household
  };
}

export function getCategoryBreakdown(variableExpensesForMonth) {
  const byCategory = {};
  for (const e of variableExpensesForMonth) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  return byCategory; // { groceries: 12000, electricity: 3400, ... }
}

/* ---------------------------------------------------------------------- *
 * PLANNED EXPENSES (one-off future spends tied to a specific month)
 * ---------------------------------------------------------------------- */

export function getPlannedExpensesForMonth(plannedExpenses, month) {
  return plannedExpenses.filter((e) => e.targetMonth === month);
}

/**
 * Surfaces planned one-off expenses landing within the lookahead window,
 * same pattern as getUpcomingAnnualPayments — so the dashboard can show a
 * single combined "heads up" list.
 */
export function getUpcomingPlannedExpenses(plannedExpenses, monthsAhead = 3, referenceMonth) {
  const ref = referenceMonth ? new Date(referenceMonth + "-01") : new Date();
  const upcoming = [];
  for (let i = 0; i <= monthsAhead; i++) {
    const d = new Date(ref.getFullYear(), ref.getMonth() + i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    for (const e of getPlannedExpensesForMonth(plannedExpenses, label)) {
      upcoming.push({ name: e.name, amount: e.amount, tag: e.tag, targetMonth: label, monthsAway: i });
    }
  }
  return upcoming.sort((a, b) => a.monthsAway - b.monthsAway);
}

/* ---------------------------------------------------------------------- *
 * DASHBOARD SUMMARY — the single call the dashboard screen uses.
 * ---------------------------------------------------------------------- */

/**
 * incomeDocs:         salary docs (income collection)
 * bonusIncomeDocs:     bonusIncome collection (optional, default [])
 * variableIncomeDocs:  variableIncome collection (optional, default [])
 * fixedExpenses:       fixedExpenses collection
 * variableExpenses:    variableExpenses collection
 * handLoans:           handLoans collection (optional, default [])
 * month:               "YYYY-MM"
 */
export function getMonthlySummary({
  incomeDocs,
  bonusIncomeDocs = [],
  variableIncomeDocs = [],
  fixedExpenses,
  variableExpenses,
  handLoans = [],
  plannedExpenses = [],
  month
}) {
  const salary = getHouseholdIncome(incomeDocs, month);
  const bonus = getSmoothedBonusIncome(bonusIncomeDocs);
  const variableIncomeForMonth = getVariableIncomeForMonth(variableIncomeDocs, month);
  const variableIncome = getVariableIncomeTotals(variableIncomeForMonth);

  const combinedIncome = salary.combined + bonus.combined + variableIncome.total;

  const fixed = getFixedExpenseTotals(fixedExpenses);
  const handLoanTotals = getHandLoanTotals(handLoans);
  const varForMonth = getVariableExpensesForMonth(variableExpenses, month);
  const variable = getVariableTotals(varForMonth);
  const plannedForMonth = getPlannedExpensesForMonth(plannedExpenses, month);
  const plannedTotal = plannedForMonth.reduce((sum, e) => sum + e.amount, 0);

  const totalObligations = fixed.total + handLoanTotals.monthlyBorrowedRepayment;
  const totalSpend = totalObligations + variable.total + plannedTotal;
  const surplus = combinedIncome - totalSpend;
  const savingsRateEligibleAmount = surplus > 0 ? surplus : 0;
  const savingsRate = combinedIncome > 0
    ? Math.round((savingsRateEligibleAmount / combinedIncome) * 1000) / 10
    : 0;

  return {
    salary,
    bonus,
    variableIncome,
    combinedIncome,
    fixed,
    handLoanTotals,
    totalObligations, // fixed expenses + hand-loan repayments — used for emergency fund coverage
    variable,
    plannedForMonth,
    plannedTotal,
    totalSpend,
    surplus,
    savingsRate, // percentage, one decimal
    categoryBreakdown: getCategoryBreakdown(varForMonth),
    upcomingAnnualPayments: getUpcomingAnnualPayments(fixedExpenses, 3, month),
    upcomingPlannedExpenses: getUpcomingPlannedExpenses(plannedExpenses, 3, month)
  };
}

/**
 * savingsGoals: array of { isEmergencyFund, currentSaved }
 * monthlyObligations: number — use getMonthlySummary(...).totalObligations
 * (fixed expenses + hand-loan repayments) so the emergency fund is measured
 * against everything you're actually on the hook for each month.
 * Returns null if no fund is flagged yet (UI should treat that as a hard warning).
 */
export function getEmergencyFundCoverage(savingsGoals, monthlyObligations) {
  const fund = savingsGoals.find((g) => g.isEmergencyFund);
  if (!fund) return null;
  if (monthlyObligations <= 0) return null;
  return Math.round((fund.currentSaved / monthlyObligations) * 10) / 10;
}

/**
 * Month-over-month trend for the last N months (default 6).
 * Returns [{ month: "2026-02", total: 34500 }, ...] oldest -> newest
 * Uses smoothed fixed total + hand-loan repayments, same as the dashboard.
 */
export function getMonthlyTrend(variableExpenses, fixedExpenses, handLoans = [], monthsBack = 6, referenceMonth) {
  const ref = referenceMonth ? new Date(referenceMonth + "-01") : new Date();
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(label);
  }
  const fixedTotal = getFixedExpenseTotals(fixedExpenses).total
    + getHandLoanTotals(handLoans).monthlyBorrowedRepayment;
  return months.map((month) => {
    const varTotal = getVariableTotals(getVariableExpensesForMonth(variableExpenses, month)).total;
    return { month, total: fixedTotal + varTotal };
  });
}

/**
 * Individual contribution split — income and spend, Ashwin vs Wife.
 * Household-tagged fixed/variable amounts are split 50/50 for this view
 * only (doesn't affect the combined totals used elsewhere).
 */
export function getContributionSplit({
  incomeDocs,
  bonusIncomeDocs = [],
  variableIncomeDocs = [],
  fixedExpenses,
  variableExpenses,
  handLoans = [],
  month
}) {
  const salary = getHouseholdIncome(incomeDocs, month);
  const bonus = getSmoothedBonusIncome(bonusIncomeDocs);
  const variableIncome = getVariableIncomeTotals(getVariableIncomeForMonth(variableIncomeDocs, month));

  const fixed = getFixedExpenseTotals(fixedExpenses);
  const handLoanTotals = getHandLoanTotals(handLoans);
  const variable = getVariableTotals(getVariableExpensesForMonth(variableExpenses, month));

  const householdSpendSplit = (fixed.household + variable.household + handLoanTotals.monthlyBorrowedRepaymentByTag.household) / 2;
  const householdIncomeSplit = variableIncome.household / 2;

  return {
    ashwin: {
      income: salary.ashwin + bonus.ashwin + variableIncome.ashwin + householdIncomeSplit,
      spend: fixed.ashwin + variable.ashwin + handLoanTotals.monthlyBorrowedRepaymentByTag.ashwin + householdSpendSplit
    },
    wife: {
      income: salary.wife + bonus.wife + variableIncome.wife + householdIncomeSplit,
      spend: fixed.wife + variable.wife + handLoanTotals.monthlyBorrowedRepaymentByTag.wife + householdSpendSplit
    }
  };
}

/* ---------------------------------------------------------------------- *
 * BANK LOAN SUMMARY (payoff progress — separate from hand loans)
 * ---------------------------------------------------------------------- */

/**
 * fixedExpenses: array of { id, name, amount, tag, type, loan: { tenureMonths, monthsRemaining } }
 * Returns one row per loan: EMI, tenure, months paid/remaining, % paid,
 * and the projected month the loan finishes.
 */
export function getLoanSummary(fixedExpenses, referenceMonth) {
  const ref = referenceMonth ? new Date(referenceMonth + "-01") : new Date();
  return fixedExpenses
    .filter((e) => e.type === "loan" && e.loan)
    .map((e) => {
      const monthsPaid = e.loan.tenureMonths - e.loan.monthsRemaining;
      const paidPercent = e.loan.tenureMonths > 0
        ? Math.round((monthsPaid / e.loan.tenureMonths) * 100)
        : 0;
      const endDate = new Date(ref.getFullYear(), ref.getMonth() + e.loan.monthsRemaining, 1);
      return {
        id: e.id,
        name: e.name,
        emi: e.amount,
        tag: e.tag,
        tenureMonths: e.loan.tenureMonths,
        monthsRemaining: e.loan.monthsRemaining,
        monthsPaid,
        paidPercent,
        projectedEndMonth: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}`
      };
    });
}

/* ---------------------------------------------------------------------- *
 * FULL HOUSEHOLD FORECAST
 * Projects surplus/deficit forward month by month, accounting for:
 *  - bank loan EMIs dropping off when their tenure completes (cliff up)
 *  - annual fees (school fees etc.) hitting as a real lump sum in their
 *    actual due month (dip), smoothed everywhere else
 *  - bonus landing as a real lump sum in its expected month (spike up),
 *    smoothed everywhere else
 *  - hand-loan repayments held flat (no fixed end date without more info)
 *  - variable income/expense held flat at the average of the last 3 known
 *    months (0 if no history yet)
 * This is a simple forecast, not a prediction — the point is to show WHEN
 * things change, not to be precise about day-to-day spending.
 * ---------------------------------------------------------------------- */

export function getForecast({
  fixedExpenses,
  incomeDocs,
  bonusIncomeDocs = [],
  variableIncomeDocs = [],
  variableExpenses,
  handLoans = [],
  plannedExpenses = [],
  monthsForward = 24,
  referenceMonth
}) {
  const ref = referenceMonth ? new Date(referenceMonth + "-01") : new Date();
  const startMonth = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;

  const salaryIncome = getHouseholdIncome(incomeDocs, startMonth).combined;
  const bonus = getSmoothedBonusIncome(bonusIncomeDocs);
  const latestBonusByContributor = getLatestBonusPerContributor(bonusIncomeDocs);

  const recentMonths = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    recentMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const avgVariableExpense = average(
    recentMonths.map((m) => getVariableTotals(getVariableExpensesForMonth(variableExpenses, m)).total)
  );
  const avgVariableIncome = average(
    recentMonths.map((m) => getVariableIncomeTotals(getVariableIncomeForMonth(variableIncomeDocs, m)).total)
  );

  const loans = fixedExpenses.filter((e) => e.type === "loan" && e.loan);
  const annualItems = fixedExpenses.filter((e) => e.frequency === "annual" && e.dueMonth);
  const baselineNonLoanFixed = fixedExpenses
    .filter((e) => !(e.type === "loan" && e.loan))
    .reduce((sum, e) => sum + monthlyEquivalent(e), 0);
  const handLoanMonthly = getHandLoanTotals(handLoans).monthlyBorrowedRepayment;

  const baselineIncome = salaryIncome + bonus.combined + avgVariableIncome;

  const forecast = [];
  for (let m = 0; m < monthsForward; m++) {
    const d = new Date(ref.getFullYear(), ref.getMonth() + m, 1);
    const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    let activeLoanTotal = 0;
    const loansEnding = [];
    for (const loan of loans) {
      const remaining = loan.loan.monthsRemaining - m;
      if (remaining > 0) {
        activeLoanTotal += loan.amount;
      } else if (remaining === 0) {
        loansEnding.push(loan.name);
      }
    }

    let annualAdjustment = 0;
    const annualDue = [];
    for (const item of annualItems) {
      if (d.getMonth() + 1 === item.dueMonth) {
        annualAdjustment += item.amount - item.amount / 12;
        annualDue.push({ name: item.name, amount: item.amount });
      }
    }

    let bonusAdjustment = 0;
    const bonusReceived = [];
    for (const c of ["ashwin", "wife"]) {
      const b = latestBonusByContributor[c];
      if (b && d.getMonth() + 1 === b.expectedMonth) {
        bonusAdjustment += b.amount - b.amount / 12;
        bonusReceived.push({ contributor: c, amount: b.amount });
      }
    }

    const plannedThisMonth = getPlannedExpensesForMonth(plannedExpenses, monthLabel);
    const plannedTotal = plannedThisMonth.reduce((sum, e) => sum + e.amount, 0);

    const totalIncome = baselineIncome + bonusAdjustment;
    const totalFixed = baselineNonLoanFixed + activeLoanTotal + annualAdjustment + handLoanMonthly;
    const surplus = totalIncome - (totalFixed + avgVariableExpense + plannedTotal);

    forecast.push({
      month: monthLabel,
      totalIncome,
      totalFixed,
      surplus,
      loansEnding,
      annualDue,
      bonusReceived,
      plannedExpenses: plannedThisMonth.map((e) => ({ name: e.name, amount: e.amount }))
    });
  }

  return forecast;
}

function average(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
