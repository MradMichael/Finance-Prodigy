import type { LocalFinancials } from "./localData";
import { BUDGET_RULES, monthlyEquivalent, toUSD as toUSDShared, categoryLabel } from "./localData";
import type { computeDashboard } from "./computeDashboard";

type DashboardPayload = ReturnType<typeof computeDashboard>;

export interface ReportOptions {
  /** Adds a full transaction ledger (optionally date-scoped) below the summary. The summary cards above always reflect the current live state, not the date range — computeDashboard is inherently "as of now," not re-run for an arbitrary past range. */
  detailed: boolean;
  dateFrom?: string; // YYYY-MM-DD, inclusive
  dateTo?: string;   // YYYY-MM-DD, inclusive
}

/**
 * A self-contained HTML document (inline styles only, no external assets)
 * meant to be opened in a new tab and printed. "Download as PDF" is just
 * "print this to the Save as PDF destination" — every browser already
 * knows how to do that, so this avoids pulling in a PDF-generation library
 * (and the version/bundling risk one already caused elsewhere this
 * session) for something the platform does natively.
 */
export function buildReportHtml(userName: string, data: LocalFinancials, dash: DashboardPayload, options: ReportOptions = { detailed: false }): string {
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const ruleLabel = BUDGET_RULES[dash.budgetRule]?.label ?? dash.budgetRule;
  const lbpRate = data.lbpRate ?? 89500;
  const toUSD = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);
  const BL = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings", INCOME: "Income" } as const;

  const ledgerTx = options.detailed
    ? [...data.transactions]
        .filter((t) => (!options.dateFrom || t.date >= options.dateFrom) && (!options.dateTo || t.date <= options.dateTo))
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  // Excludes INCOME, matching what "Spent" means in the summary card above
  // (dash.month.totalSpend) -- otherwise a range containing a logged INCOME
  // transaction shows two different, contradicting totals in the same report.
  const ledgerTotal = ledgerTx.filter((t) => t.bucket !== "INCOME").reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
  const ledgerRows = ledgerTx.map((t) => `
    <tr>
      <td>${t.date.split("-").reverse().join("/")}</td>
      <td>${escapeHtml(t.description)}</td>
      <td>${BL[t.bucket]}</td>
      <td>${t.category ? escapeHtml(categoryLabel(t.category, data.customCategories)) : "—"}</td>
      <td class="num">${money(toUSD(t.amount, t.currency))}</td>
    </tr>`).join("");
  const rangeLabel = options.dateFrom || options.dateTo
    ? `${options.dateFrom ? options.dateFrom.split("-").reverse().join("/") : "the start"} to ${options.dateTo ? options.dateTo.split("-").reverse().join("/") : "today"}`
    : "all time";

  const goalRows = dash.goals.map((g) => `
    <tr>
      <td>${escapeHtml(g.emoji ?? "")} ${escapeHtml(g.name)}</td>
      <td class="num">${money(g.currentAmount)}</td>
      <td class="num">${money(g.targetAmount)}</td>
      <td class="num">${g.projection.pctComplete}%</td>
      <td class="num">${g.projection.targetDateDisplay}</td>
    </tr>`).join("");

  const debtRows = data.debts.map((d) => `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td class="num">${money(d.balance)}</td>
      <td class="num">${d.apr}%</td>
      <td class="num">${money(d.minPayment)}/mo</td>
    </tr>`).join("");

  const FREQ_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", every2months: "Every 2 months", quarterly: "Quarterly", biannually: "Every 6 months", yearly: "Yearly" } as const;
  const activeRecurring = (data.recurring ?? []).filter((r) => toUSD(monthlyEquivalent(r), r.currency) > 0);
  const recurringMonthlyTotal = activeRecurring.reduce((s, r) => s + toUSD(monthlyEquivalent(r), r.currency), 0);
  const recurringRows = activeRecurring.map((r) => `
    <tr>
      <td>${escapeHtml(r.emoji ?? "")} ${escapeHtml(r.name)}</td>
      <td>${BL[r.bucket]}</td>
      <td>${r.category ? escapeHtml(categoryLabel(r.category, data.customCategories)) : "—"}</td>
      <td>${FREQ_LABEL[r.frequency]}</td>
      <td class="num">${money(toUSD(r.amount, r.currency))}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>ESSA Financial Report — ${escapeHtml(userName)}</title>
<style>
  @page { margin: 24mm 18mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a2420; margin: 0; padding: 32px; font-size: 13px; }
  h1 { font-size: 24px; margin: 0 0 2px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #5a6b64; margin: 28px 0 8px; border-bottom: 1px solid #d8ddda; padding-bottom: 4px; }
  .sub { color: #5a6b64; font-size: 12px; margin: 0 0 24px; }
  .grid { display: flex; gap: 16px; }
  .card { flex: 1; border: 1px solid #d8ddda; border-radius: 8px; padding: 12px 14px; }
  .card .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a6b64; }
  .card .value { font-size: 20px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e6e9e7; font-size: 12px; }
  th { color: #5a6b64; font-weight: normal; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 32px; font-size: 10px; color: #8a958f; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>ESSA Financial Report</h1>
  <p class="sub">${escapeHtml(userName)} · Generated ${generatedAt}</p>

  <h2>Financial health</h2>
  <div class="grid">
    <div class="card"><div class="label">Score</div><div class="value">${dash.health.score} / 100 &middot; ${escapeHtml(dash.health.grade)}</div></div>
    <div class="card"><div class="label">Net worth</div><div class="value">${money(dash.netWorth.total)} &middot; ${escapeHtml(dash.netWorth.tier)}</div></div>
  </div>

  <h2>This month</h2>
  <div class="grid">
    <div class="card"><div class="label">Income</div><div class="value">${money(dash.month.income)}</div></div>
    <div class="card"><div class="label">Spent</div><div class="value">${money(dash.month.totalSpend)}</div></div>
    <div class="card"><div class="label">Saved</div><div class="value">${money(dash.month.income - dash.month.totalSpend)} &middot; ${dash.month.savingsRatePct.toFixed(1)}%</div></div>
  </div>

  <h2>Budget &middot; ${escapeHtml(ruleLabel)}</h2>
  <table>
    <tr><th>Bucket</th><th class="num">Target %</th><th class="num">Target $</th><th class="num">Spent</th></tr>
    <tr><td>Needs</td><td class="num">${dash.budgetTargetPct.needs}%</td><td class="num">${money(dash.budgetTargets.needs)}</td><td class="num">${money(dash.month.needsSpend)}</td></tr>
    <tr><td>Wants</td><td class="num">${dash.budgetTargetPct.wants}%</td><td class="num">${money(dash.budgetTargets.wants)}</td><td class="num">${money(dash.month.wantsSpend)}</td></tr>
    <tr><td>Savings</td><td class="num">${dash.budgetTargetPct.savings}%</td><td class="num">${money(dash.budgetTargets.savings)}</td><td class="num">${money(dash.month.savingsContrib)}</td></tr>
  </table>

  <h2>Safety net</h2>
  <div class="grid">
    <div class="card"><div class="label">Balance</div><div class="value">${money(dash.emergencyFund.balance)} / ${money(dash.emergencyFund.targetAmount)}</div></div>
    <div class="card"><div class="label">Funded</div><div class="value">${dash.emergencyFund.pctFunded}%</div></div>
    <div class="card"><div class="label">Coverage</div><div class="value">${dash.emergencyFund.coverageMonths} mo of needs</div></div>
  </div>

  ${data.debts.length > 0 ? `
  <h2>Debts &middot; ${money(dash.debt.totalBalance)} owed${dash.debt.plan?.feasible && dash.debt.plan.debtFreeDateDisplay ? ` &middot; debt-free ${dash.debt.plan.debtFreeDateDisplay}` : ""}</h2>
  <table>
    <tr><th>Name</th><th class="num">Balance</th><th class="num">APR</th><th class="num">Min payment</th></tr>
    ${debtRows}
  </table>` : ""}

  ${activeRecurring.length > 0 ? `
  <h2>Recurring payments &middot; ${money(recurringMonthlyTotal)}/mo</h2>
  <table>
    <tr><th>Name</th><th>Bucket</th><th>Category</th><th>Frequency</th><th class="num">Amount</th></tr>
    ${recurringRows}
  </table>` : ""}

  ${dash.goals.length > 0 ? `
  <h2>Goals</h2>
  <table>
    <tr><th>Goal</th><th class="num">Saved</th><th class="num">Target</th><th class="num">Progress</th><th class="num">By</th></tr>
    ${goalRows}
  </table>` : ""}

  ${options.detailed ? `
  <h2>Transaction ledger &middot; ${escapeHtml(rangeLabel)} &middot; ${ledgerTx.length} entries &middot; ${money(ledgerTotal)}</h2>
  <table>
    <tr><th>Date</th><th>Description</th><th>Bucket</th><th>Category</th><th class="num">Amount</th></tr>
    ${ledgerRows || `<tr><td colspan="5" style="color:#8a958f;">No transactions in this range.</td></tr>`}
  </table>` : ""}

  <p class="footer">Generated locally in your browser by ESSA. This data never left your device to produce this report.</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
