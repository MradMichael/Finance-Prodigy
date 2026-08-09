/**
 * normalizeSync.ts
 * After every sync push, decompose the LocalFinancials JSON blob
 * into all normalized Postgres tables.
 *
 * Deletion order respects FK constraints (NoAction = must delete
 * child rows before parent):
 *   fact_transaction  (refs dim_account with NoAction → delete first)
 *   fact_monthly_snapshot
 *   goal              (cascades → fact_goal_contribution)
 *   debt              (cascades → fact_debt_payment)
 *   budget            (cascades → budget_line)
 *   dim_account       (now safe)
 */

import { Prisma } from "@prisma/client";
import { logger } from "./logger";
import { prisma } from "./prisma";

// ── local types (mirror LocalFinancials shape) ──────────────────────────────

type BucketKey = "NEEDS" | "WANTS" | "SAVINGS";
// Transactions (not recurring) can also be one-off INCOME -- mirrors the
// same Bucket/TxBucket split in the client's InputPanel.tsx and
// StoredTransaction's doc comment in localData.ts.
type TxBucketKey = BucketKey | "INCOME";

interface StoredTransaction {
  id: string;
  amount: number;
  currency?: string;
  bucket: TxBucketKey;
  description: string;
  date: string;           // YYYY-MM-DD
  paymentMethod?: string; // "cash" | "card" | "other"
  paymentNote?: string;
  cardId?: string;
  cardLabel?: string;
}

interface StoredGoal {
  id: string;
  name: string;
  emoji?: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;     // YYYY-MM-DD
  achievedAt?: string;
}

interface StoredDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  openedDate?: string;
}

interface StoredRecurring {
  id: string;
  name: string;
  emoji?: string;
  amount: number;
  currency?: string;
  bucket: BucketKey;
  frequency: string;
  dayOfMonth?: number;
}

interface StoredCard {
  id: string;
  type: string;
  last4: string;
  label: string;
}

interface LocalFinancials {
  userName?: string;
  income?: number;
  lbpRate?: number;
  emergencyFundTargetMonths?: number;
  emergencyFundBalance?: number;
  budgetRule?: string;
  budgetCustomNeeds?: number;
  budgetCustomWants?: number;
  transactions?: StoredTransaction[];
  goals?: StoredGoal[];
  debts?: StoredDebt[];
  recurring?: StoredRecurring[];
  cards?: StoredCard[];
}

// ── helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isoWeek(d: Date): number {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function dimDateData(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day   = d.getUTCDate();
  const dow   = d.getUTCDay();
  return {
    dateKey:    year * 10_000 + month * 100 + day,
    date:       new Date(dateStr + "T00:00:00.000Z"),
    year,
    quarter:    Math.ceil(month / 3),
    month,
    monthName:  MONTH_NAMES[month],
    yearMonth:  `${year}-${String(month).padStart(2, "0")}`,
    week:       isoWeek(d),
    dayOfMonth: day,
    dayOfWeek:  dow,
    dayName:    DAY_NAMES[dow],
    isWeekend:  dow === 0 || dow === 6,
  };
}

// Keyed by the wider TxBucketKey so a real transaction's bucket always
// resolves (a mismatch here used to mean catIds[t.bucket] was undefined,
// making the fact_transaction insert below throw on its required FK).
// Recurring items only ever use the BucketKey subset, which indexes into
// this the same way.
const BUCKET_META: Record<TxBucketKey, { name: string; icon: string; flowType: string }> = {
  NEEDS:   { name: "Needs",   icon: "🏠", flowType: "EXPENSE"  },
  WANTS:   { name: "Wants",   icon: "✨", flowType: "EXPENSE"  },
  SAVINGS: { name: "Savings", icon: "💰", flowType: "SAVINGS"  },
  INCOME:  { name: "Income",  icon: "📥", flowType: "INCOME"   },
};

function parseBudgetPcts(rule: string, customNeeds?: number, customWants?: number) {
  if (rule === "custom") {
    const needs    = customNeeds  ?? 50;
    const wants    = customWants  ?? 30;
    const savings  = Math.max(0, 100 - needs - wants);
    return { needs, wants, savings };
  }
  const parts = rule.split("-").map(Number);
  if (parts.length === 3 && parts.every(n => !isNaN(n))) {
    return { needs: parts[0], wants: parts[1], savings: parts[2] };
  }
  return { needs: 50, wants: 30, savings: 20 };
}

// ── main export ─────────────────────────────────────────────────────────────

export async function normalizeToTables(email: string, raw: LocalFinancials): Promise<void> {
  const lbpRate    = raw.lbpRate ?? 89_500;
  const toUSD      = (n: number, cur?: string) => cur === "LBP" ? n / lbpRate : n;
  const income     = raw.income ?? 0;
  const transactions = raw.transactions ?? [];
  const goals        = raw.goals        ?? [];
  const debts        = raw.debts        ?? [];
  const cards        = raw.cards        ?? [];
  const recurring    = raw.recurring    ?? [];
  const now          = new Date();
  const todayStr     = now.toISOString().slice(0, 10);

  // This runs fire-and-forget after /push already responded (see routes/sync.ts),
  // so a DELETE /api/sync for the same email can land while this is still
  // in flight — without this check, deleteAllDataForEmail() could find
  // nothing to clean up, then THIS finishes afterward and recreates the
  // analytics rows the deletion was supposed to remove. Bail out if the
  // account's sync record is gone by the time we actually get to write.
  const stillSynced = await prisma.userSync.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
  if (!stillSynced) {
    logger.info("normalize_skipped_deleted", { email: email.toLowerCase() });
    return;
  }

  // Everything below is one transaction — a crash or connection drop
  // partway through used to leave the warehouse with, say, transactions
  // deleted but not yet re-inserted (this function deletes-then-rebuilds
  // rather than diffing). A generous timeout since a user with a large
  // history means many sequential creates, each its own round trip.
  let monthCount = 0;
  const user = await prisma.$transaction(async (tx) => {
    // ── 1. Upsert dim_user ──────────────────────────────────────────────────
    const user = await tx.user.upsert({
      where:  { email: email.toLowerCase() },
      create: {
        email:          email.toLowerCase(),
        name:           raw.userName ?? "User",
        currency:       "USD",
        payoffStrategy: "AVALANCHE",
        efTargetMonths: raw.emergencyFundTargetMonths ?? 6,
      },
      update: {
        name:           raw.userName ?? "User",
        efTargetMonths: raw.emergencyFundTargetMonths ?? 6,
      },
    });

    // ── 2. Ensure dim_category rows for NEEDS / WANTS / SAVINGS / INCOME ─────
    const catIds: Record<TxBucketKey, number> = {} as Record<TxBucketKey, number>;
    for (const [bucket, meta] of Object.entries(BUCKET_META) as [TxBucketKey, typeof BUCKET_META[TxBucketKey]][]) {
      const cat = await tx.dimCategory.upsert({
        where:  { name_bucket: { name: meta.name, bucket } },
        create: { name: meta.name, bucket, icon: meta.icon, isActive: true },
        update: { icon: meta.icon },
      });
      catIds[bucket] = cat.id;
    }

    // ── 3. Ensure dim_date rows exist for every transaction date + today ──────
    const uniqueDates = [...new Set([...transactions.map(t => t.date), todayStr])];
    for (const ds of uniqueDates) {
      const dd = dimDateData(ds);
      await tx.dimDate.upsert({
        where:  { dateKey: dd.dateKey },
        create: dd,
        update: {},
      });
    }

    // ── 4. Clear user's transactional data (FK-safe order) ───────────────────
    //   fact_transaction  (refs dim_account → NoAction, must go first)
    await tx.factTransaction.deleteMany({ where: { userId: user.id } });
    //   fact_monthly_snapshot
    await tx.factMonthlySnapshot.deleteMany({ where: { userId: user.id } });
    //   goal  (cascades → fact_goal_contribution)
    await tx.goal.deleteMany({ where: { userId: user.id } });
    //   debt  (cascades → fact_debt_payment)
    await tx.debt.deleteMany({ where: { userId: user.id } });
    //   budget for the current month only — a full deleteMany here would erase
    //   prior months' budgets even though step 10 below only ever recreates
    //   the current month, permanently losing history on every single push.
    await tx.budget.deleteMany({ where: { userId: user.id, year: now.getFullYear(), month: now.getMonth() + 1 } });
    //   dim_account  (fact_transaction already deleted)
    await tx.dimAccount.deleteMany({ where: { userId: user.id } });

    // ── 5. Create dim_account rows ────────────────────────────────────────────
    const cashAcc = await tx.dimAccount.create({
      data: { userId: user.id, name: "Cash",         type: "CASH",        currency: "USD", isActive: true },
    });
    const bankAcc = await tx.dimAccount.create({
      data: { userId: user.id, name: "Bank Account", type: "CHECKING",    currency: "USD", isActive: true },
    });
    const otherAcc = await tx.dimAccount.create({
      data: { userId: user.id, name: "Other / Gift", type: "CHECKING",    currency: "USD", isActive: true },
    });
    const efAcc = await tx.dimAccount.create({
      data: { userId: user.id, name: "Emergency Fund", type: "SAVINGS",   currency: "USD", isActive: true },
    });

    // One CREDIT_CARD account per saved card
    const cardAccMap: Record<string, number> = {};
    for (const card of cards) {
      const acc = await tx.dimAccount.create({
        data: { userId: user.id, name: card.label, type: "CREDIT_CARD", currency: "USD", isActive: true },
      });
      cardAccMap[card.id] = acc.id;
    }

    // ── 6. Insert fact_transaction for every logged entry ────────────────────
    for (const t of transactions) {
      const dd     = dimDateData(t.date);
      const amtUSD = toUSD(t.amount, t.currency);

      // Resolve account
      let accountId = bankAcc.id;
      if (t.paymentMethod === "cash") {
        accountId = cashAcc.id;
      } else if (t.paymentMethod === "card") {
        accountId = t.cardId && cardAccMap[t.cardId] ? cardAccMap[t.cardId] : bankAcc.id;
      } else if (t.paymentMethod === "other") {
        accountId = otherAcc.id;
      }

      // Build note: description + card label + who paid (for "other")
      const noteParts = [
        t.description,
        t.cardLabel  ? `[${t.cardLabel}]`         : null,
        t.paymentNote ? `Paid by: ${t.paymentNote}` : null,
        t.currency === "LBP" ? `(L£${t.amount.toLocaleString()} at ${lbpRate}/USD)` : null,
      ].filter(Boolean);

      await tx.factTransaction.create({
        data: {
          userId:      user.id,
          dateKey:     dd.dateKey,
          occurredAt:  new Date(t.date + "T12:00:00Z"),
          amount:      amtUSD,
          flowType:    BUCKET_META[t.bucket]?.flowType ?? "EXPENSE",
          categoryId:  catIds[t.bucket],
          accountId,
          merchant:    null,
          note:        noteParts.join(" · ") || null,
          isRecurring: false,
        },
      });
    }

    // ── 7. Insert fact_transaction for recurring (as planned, isRecurring=true) ──
    //    These represent the scheduled recurring payments—separate from actuals.
    const todayDd = dimDateData(todayStr);
    for (const rec of recurring) {
      const amtUSD = toUSD(rec.amount, rec.currency);
      const freqLabel: Record<string, string> = {
        MONTHLY: "Monthly", WEEKLY: "Weekly", BIWEEKLY: "Bi-weekly",
        QUARTERLY: "Quarterly", ANNUAL: "Annual", DAILY: "Daily",
      };
      const note = [
        `${rec.emoji ?? ""} ${rec.name}`.trim(),
        `[Recurring · ${freqLabel[rec.frequency] ?? rec.frequency}]`,
        rec.dayOfMonth ? `day ${rec.dayOfMonth}` : null,
        rec.currency === "LBP" ? `(L£${rec.amount.toLocaleString()} at ${lbpRate}/USD)` : null,
      ].filter(Boolean).join(" · ");

      await tx.factTransaction.create({
        data: {
          userId:      user.id,
          dateKey:     todayDd.dateKey,
          occurredAt:  new Date(todayStr + "T12:00:00Z"),
          amount:      amtUSD,
          flowType:    BUCKET_META[rec.bucket as BucketKey]?.flowType ?? "EXPENSE",
          categoryId:  catIds[rec.bucket as BucketKey],
          accountId:   bankAcc.id,
          merchant:    null,
          note,
          isRecurring: true,
        },
      });
    }

    // ── 8. Insert goals ───────────────────────────────────────────────────────
    for (const g of goals) {
      await tx.goal.create({
        data: {
          userId:         user.id,
          name:           g.name,
          emoji:          g.emoji ?? null,
          type:           "CUSTOM",
          targetAmount:   g.targetAmount,
          startingAmount: 0,
          currentAmount:  g.currentAmount,
          targetDate:     new Date(g.targetDate + "T00:00:00Z"),
          priority:       3,
          status:         g.achievedAt ? "ACHIEVED" : "ACTIVE",
        },
      });
    }

    // ── 9. Insert debts ───────────────────────────────────────────────────────
    for (const d of debts) {
      await tx.debt.create({
        data: {
          userId:            user.id,
          name:              d.name,
          lender:            null,
          originalPrincipal: d.balance,   // current balance used as proxy
          currentBalance:    d.balance,
          aprPct:            d.apr,
          minimumPayment:    d.minPayment,
          startDate:         d.openedDate ? new Date(d.openedDate + "T00:00:00Z") : null,
          status:            d.balance <= 0 ? "PAID_OFF" : "ACTIVE",
        },
      });
    }

    // ── 10. Budget for current month ──────────────────────────────────────────
    if (income > 0) {
      const rule = raw.budgetRule ?? "50-30-20";
      const pcts = parseBudgetPcts(rule, raw.budgetCustomNeeds, raw.budgetCustomWants);
      const yr   = now.getFullYear();
      const mo   = now.getMonth() + 1;

      const budget = await tx.budget.create({
        data: {
          userId:         user.id,
          year:           yr,
          month:          mo,
          expectedIncome: income,
          needsPct:       pcts.needs,
          wantsPct:       pcts.wants,
          savingsPct:     pcts.savings,
        },
      });

      // 3 budget lines: one per bucket
      for (const [bucket, pct] of [
        ["NEEDS",   pcts.needs]   as const,
        ["WANTS",   pcts.wants]   as const,
        ["SAVINGS", pcts.savings] as const,
      ]) {
        await tx.budgetLine.create({
          data: {
            budgetId:      budget.id,
            categoryId:    catIds[bucket],
            plannedAmount: (income * pct) / 100,
          },
        });
      }
    }

    // ── 11. fact_monthly_snapshot — one row per month with transactions ────────
    const monthBuckets: Record<string, { needs: number; wants: number; savings: number }> = {};
    for (const t of transactions) {
      const ym  = t.date.slice(0, 7);
      const amt = toUSD(t.amount, t.currency);
      if (!monthBuckets[ym]) monthBuckets[ym] = { needs: 0, wants: 0, savings: 0 };
      // No catch-all on purpose: an INCOME transaction matches none of
      // these and is correctly left out of the spend breakdown. Known
      // gap, not a bug: `income` below stays the flat Setup figure and
      // isn't boosted by that month's INCOME transactions the way the
      // client's computeDashboard.ts now does -- this warehouse snapshot
      // is a BI/reporting mirror, not what the live app displays.
      if      (t.bucket === "NEEDS")   monthBuckets[ym].needs   += amt;
      else if (t.bucket === "WANTS")   monthBuckets[ym].wants   += amt;
      else if (t.bucket === "SAVINGS") monthBuckets[ym].savings += amt;
    }

    const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
    const efBalance = raw.emergencyFundBalance ?? 0;
    const rule = parseBudgetPcts(raw.budgetRule ?? "50-30-20", raw.budgetCustomNeeds, raw.budgetCustomWants);

    for (const [ym, spend] of Object.entries(monthBuckets)) {
      const [y, m] = ym.split("-").map(Number);
      // Guarded value stays local to the ratio math below — storing it
      // instead of the raw `income` would persist a fake "$1 income" row for
      // any genuinely $0-income month (the same floor-leaks-into-stored-value
      // bug already fixed in the client's computeDashboard.ts this session).
      const incSafe = income || 1;

      // Health score: savings pace (40%) + needs discipline (40%) + base (20%)
      const savPace   = income > 0 ? Math.min(100, (spend.savings / (incSafe * rule.savings / 100)) * 100) : 0;
      const needsRatio = spend.needs / incSafe;
      const needsDis  = needsRatio <= rule.needs / 100 ? 100 : Math.max(0, 100 - (needsRatio - rule.needs / 100) * 400);
      const health    = Math.round(savPace * 0.4 + needsDis * 0.4 + 20);

      await tx.factMonthlySnapshot.create({
        data: {
          userId:        user.id,
          year:          y,
          month:         m,
          totalIncome:   income,
          needsSpend:    spend.needs,
          wantsSpend:    spend.wants,
          savingsAmount: spend.savings,
          debtBalanceEnd: totalDebt,
          efBalanceEnd:   efBalance,
          healthScore:    Math.min(100, Math.max(0, health)),
        },
      });
    }

    monthCount = Object.keys(monthBuckets).length;
    return user;
  }, { timeout: 30_000, maxWait: 10_000 });

  logger.info("normalize_complete", {
    userId: user.id, transactions: transactions.length, goals: goals.length,
    debts: debts.length, recurring: recurring.length, months: monthCount,
  });
}

/**
 * Deletes everything this analytics warehouse holds for an email — called
 * when a user deletes their account (see routes/sync.ts's DELETE handler).
 * Same FK-safe order as step 4 above, plus removing the dim_user row itself
 * at the end (safe once everything referencing it is gone). A no-op if this
 * email was never normalized here (e.g. never actually pushed).
 */
export async function deleteAllDataForEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return;

  await prisma.factTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.factMonthlySnapshot.deleteMany({ where: { userId: user.id } });
  await prisma.goal.deleteMany({ where: { userId: user.id } });
  await prisma.debt.deleteMany({ where: { userId: user.id } });
  await prisma.budget.deleteMany({ where: { userId: user.id } });
  await prisma.dimAccount.deleteMany({ where: { userId: user.id } });
  try {
    await prisma.user.delete({ where: { id: user.id } });
  } catch (err) {
    // P2025 = already deleted by a concurrent call (e.g. two overlapping
    // account-deletion requests) — the end state either call wanted (no
    // user row) is already true, so this isn't a real failure.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) throw err;
  }

  logger.info("normalize_data_deleted", { userId: user.id });
}
