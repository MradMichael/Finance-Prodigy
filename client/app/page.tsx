"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import FinancialDashboard from "../components/FinancialDashboard";
import InputPanel from "../components/InputPanel";
import TransactionsScreen from "../components/screens/TransactionsScreen";
import CategoriesScreen from "../components/screens/CategoriesScreen";
import GoalsScreen from "../components/screens/GoalsScreen";
import DebtsScreen from "../components/screens/DebtsScreen";
import BudgetScreen from "../components/screens/BudgetScreen";
import SetupScreen from "../components/screens/SetupScreen";
import RecurringScreen from "../components/screens/RecurringScreen";
import ProjectionsScreen from "../components/screens/ProjectionsScreen";
import JourneyScreen from "../components/screens/JourneyScreen";
import CurrencyScreen from "../components/screens/CurrencyScreen";
import BalanceCheckScreen from "../components/screens/BalanceCheckScreen";
import WishlistScreen from "../components/screens/WishlistScreen";
import StatisticsScreen from "../components/screens/StatisticsScreen";
import Sidebar from "../components/shell/Sidebar";
import BottomNav from "../components/shell/BottomNav";
import TopBar from "../components/shell/TopBar";
import type { Screen, SyncStatus } from "../components/screens/shared";
import { cycleStartDayOf, loadData, saveData, isEmptyFinancials, buildRecurringConfirmLog, nextConfirmTarget, autoPurgeExpired, DEFAULT_LBP_RATE } from "../lib/localData";
import type { LocalFinancials } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import {currentCycleKey, calendarKeyForDate, type CycleKey, type CycleHistory } from "../lib/period";
import { getSession, hasValidSession, signOut } from "../lib/auth";
import type { Session } from "../lib/auth";
import { pushToServer, pullFromServer, hasAutoPulled, markAutoPulled, mergeAndPush, buildMergeNoticeText } from "../lib/syncService";
import { useTheme } from "../contexts/ThemeContext";
import { Signet } from "../components/EssaBrand";
import RecurringModelNoticeModal from "../components/RecurringModelNoticeModal";
import EditDebtSheet from "../components/EditDebtSheet";
import EditRecurringSheet from "../components/EditRecurringSheet";
import EditGoalSheet from "../components/EditGoalSheet";
import PayDebtSheet from "../components/PayDebtSheet";
import EditTransactionSheet from "../components/EditTransactionSheet";

// ─────────────────────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────────────────────
const SYNC_DEBOUNCE_MS = 2500; // wait 2.5 s after last change before pushing

export default function Home() {
  const router  = useRouter();
  const T       = useTheme();
  const [session,    setSession]    = useState<Session | null>(null);
  const [financials, setFinancials] = useState<LocalFinancials | null>(null);
  const [screen,     setScreen]     = useState<Screen>("overview");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  // Phase 2.7 sub-phase 3 -- what an automatic merge actually did, worded
  // for the user (buildMergeNoticeText). Deliberately NOT cleared by any
  // timer, unlike syncStatus above: a silent-by-default notification about
  // money changing is exactly what the owner asked this to avoid (2026-09-01)
  // -- it stays until manually dismissed, whatever the conflict count.
  const [mergeNotice, setMergeNotice] = useState<{ text: string; showReviewLink: boolean } | null>(null);
  // Mirrors loggingRecurringRef for rendering (disables the Confirm button
  // while its own write is in flight) -- the ref below is the actual
  // guard; this is display-only and can lag it by a render.
  const [loggingRecurringIds, setLoggingRecurringIds] = useState<Set<string>>(new Set());
  // Brief post-success state (2.4.30, finding 3) -- without this, the
  // button reverts straight to "Confirm" (now correctly targeting the
  // NEXT cycle, not a duplicate of the one just confirmed), which reads as
  // "nothing happened" and invites another click. Cleared on a timer, not
  // on next render, so it's visible even if nothing else changes on screen.
  const [justConfirmedIds, setJustConfirmedIds] = useState<Set<string>>(new Set());
  const justConfirmedTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const syncTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef  = useRef<Session | null>(null);
  // Synchronous re-entrancy guard for handleLogRecurringPayment -- a second
  // click for the same item, arriving before the first click's handleChange
  // has resolved, reads this before doing anything else and bails. Must be
  // a ref, not state: state updates aren't guaranteed to have committed
  // before a rapid second click re-enters the handler, which is exactly
  // the race that let a double-click create two transactions for the same
  // bill.
  const loggingRecurringRef = useRef<Set<string>>(new Set());
  // Same re-entrancy-guard shape as loggingRecurringRef, but keyed by
  // `${recurringId}:${dueISO}` rather than just recurringId (2.4.31 backfill)
  // -- a user can have several pending backfill cycles for the same item
  // open at once, and confirming one must not disable the others.
  const backfillingRef = useRef<Set<string>>(new Set());
  const [backfillingIds, setBackfillingIds] = useState<Set<string>>(new Set());
  // Shared edit surface (usability backlog, 2026-08-29): one implementation
  // per entity, opened from wherever a user is looking at it (InputPanel's
  // Manage tab, or the entity's own standalone screen), instead of a second,
  // independently-written edit UI per screen -- the exact duplication shape
  // that has already produced five real bugs in this codebase.
  type EditTarget = { kind: "transaction" | "debt" | "recurring" | "goal"; id: string };
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const handleEdit = (kind: EditTarget["kind"], id: string) => setEditing({ kind, id });
  // "Record a payment" for a debt -- previously only reachable from
  // InputPanel's Manage tab, now also from DebtsScreen itself.
  const [payingDebtId, setPayingDebtId] = useState<string | null>(null);

  // keep a stable ref so the debounce closure always sees the latest session
  useEffect(() => { sessionRef.current = session; }, [session]);

  const autoSync = useCallback(async (data: LocalFinancials, email: string) => {
    setSyncStatus("syncing");
    const result = await pushToServer(email, data);
    // 2.4.38: a conflict isn't a transient failure a retry would fix.
    // Phase 2.7 sub-phase 3: attempt an automatic merge instead of only
    // setting the static indicator -- pull the server's current data,
    // merge transactions (both devices' new transactions survive,
    // tombstones win, a genuine same-id conflict resolves by updatedAt),
    // push the merged result. Falls back to the static "conflict"
    // indicator (stays visible until resolved via Push/Pull/Merge on the
    // profile page) only if the merge itself can't complete.
    if (result.conflict) {
      const merged = await mergeAndPush(email, data);
      if (!merged.ok) { setSyncStatus("conflict"); return; }
      const userId = sessionRef.current?.userId;
      if (userId) {
        await saveData(merged.mergedData, userId);
        setFinancials(merged.mergedData);
      }
      const notice = buildMergeNoticeText(merged.addedFromServer, merged.conflictDetails, merged.nonTransactionDivergence);
      if (notice.text) setMergeNotice(notice);
      setSyncStatus("synced");
      setTimeout(() => setSyncStatus((s) => s !== "syncing" ? "idle" : s), 4000);
      return;
    }
    setSyncStatus(result.ok ? "synced" : "offline");
    // fade back to idle after 4 s so the indicator doesn't stay forever
    setTimeout(() => setSyncStatus((s) => s !== "syncing" ? "idle" : s), 4000);
  }, []);

  // 2.4.69 -- identifies which load run is the current one, so a superseded
  // run cannot apply the snapshot it captured before its await.
  //
  // Same purpose as ImportStatement.tsx:65's cancellation ref, and re-armed
  // on setup for the same reason, but a TOKEN rather than a boolean -- the
  // plain boolean form is actively wrong for this effect. There, the ref
  // means "the modal is gone", one in-flight parse, and re-arming on setup
  // undoes StrictMode's simulated cleanup so real parses aren't pre-cancelled.
  // Here StrictMode's double-run IS the failure mechanism: two runs are in
  // flight at once, and a shared boolean re-armed by the second setup would
  // clear the very flag meant to stop the first -- un-cancelling the stale
  // run instead of blocking it. Comparing a per-run token distinguishes
  // "superseded" from "unmounted", which a boolean cannot.
  //
  // Deliberately not a `let cancelled` closure either, though that would also
  // work: staleness here is decided by comparison rather than by a cleanup
  // side effect, so it holds even on a path where cleanup never runs.
  const loadRunRef = useRef(0);

  useEffect(() => {
    // Re-armed on every setup: this run claims the latest token.
    const myRun = ++loadRunRef.current;
    const superseded = () => loadRunRef.current !== myRun;

    const s = getSession();
    if (!s || !hasValidSession()) {
      // A session can outlive its per-tab encryption key (browser restart,
      // or a fresh tab) — treat that as not really signed in rather than
      // proceeding to load/save data without a key. signOut() clears the
      // stale session so the sign-in flow starts clean.
      if (s) signOut();
      router.replace("/sign-in");
      return;
    }
    setSession(s);
    loadData(s.userId).then(async (data) => {
      // A brand-new local account (fresh sign-up, or a fresh browser/device)
      // has nothing to lose, so it's safe to silently try restoring it from
      // the server once — covers "signed up on my phone with the same
      // email, why isn't my data there" without ever risking a real local
      // edit being overwritten (isEmptyFinancials gates that; the
      // hasAutoPulled flag makes it a one-time attempt, not a retry loop).
      if (superseded()) return;
      if (isEmptyFinancials(data) && !hasAutoPulled(s.userId)) {
        markAutoPulled(s.userId);
        const result = await pullFromServer(s.email);
        // The one that matters: `data` was captured before this await, and a
        // newer run has since unlocked the UI. Anything the user typed in the
        // meantime is live state, and applying either branch below would
        // replace the WHOLE financials object with a snapshot that predates
        // it -- not just income, everything written in that window.
        if (superseded()) return;
        if (result.ok && !isEmptyFinancials(result.data)) {
          const pulled = { ...result.data, userName: s.name };
          await saveData(pulled, s.userId);
          if (superseded()) return;
          setFinancials(pulled);
          return;
        }
      }
      if (superseded()) return;
      setFinancials({ ...data, userName: s.name });
    });
  // Mount-only, and deliberately NOT keyed on `router`.
  //
  // This is a one-shot bootstrap: read the session, load the account, and (for
  // a brand-new one) try the server once. Re-running it is never useful, and
  // `router` is used here only to redirect away when there is no session at
  // all -- a path that ends the effect immediately.
  //
  // Keying on it made correctness depend on useRouter() returning a
  // referentially stable object. next/navigation does, but nothing in this
  // repo enforces that, and the failure mode is silent and unbounded: a new
  // identity per render re-runs the bootstrap on every render, each run
  // replacing financials with a freshly loaded (history-less) snapshot that
  // the monthly-snapshot effect then correctly writes back, re-rendering and
  // starting again. Measured with a hostile mock: 1039 persists in seven
  // seconds, versus 1 with a stable object. Worse, it would be quiet --
  // handleChange re-arms the 2500ms sync debounce on every call, so at loop
  // speed the timer resets faster than it can fire and sync is starved
  // rather than flooded: no push, no error, nothing to notice.
  //
  // page.load-effect-deps.test.tsx mocks useRouter hostilely on purpose and
  // fails if this dependency ever comes back.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleChange(updated: LocalFinancials) {
    if (!session) return;
    setFinancials(updated);
    await saveData(updated, session.userId);

    // Debounced auto-sync: reset the timer on every change
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setSyncStatus("idle"); // clear stale status while user is still typing
    syncTimer.current = setTimeout(() => {
      const s = sessionRef.current;
      if (s) autoSync(updated, s.email);
    }, SYNC_DEBOUNCE_MS);
  }

  // Confirms a recurring item's oldest outstanding cycle (Phase 2.5.3) --
  // the FIFO target nextConfirmTarget resolves, whether that's an overdue
  // backlog entry or the plain next occurrence. Shared by every confirm
  // surface (Overview's chip, InputPanel's row) so they can't independently
  // drift on what "confirm" means -- exactly the class of cross-screen
  // disagreement this project has already been burned by once.
  // `paidDate` (2.4.30, finding A) is optional -- when the caller doesn't
  // offer a choice (Overview's quick-confirm), it's left undefined and
  // buildRecurringConfirmLog defaults it to the due date, unchanged from
  // before.
  async function handleConfirmRecurringPayment(recurringId: string, paidDate?: Date) {
    if (!financials) return;
    if (loggingRecurringRef.current.has(recurringId)) return; // already in flight
    const rec = financials.recurring.find((r) => r.id === recurringId);
    if (!rec) return;
    const now = new Date();
    const todayMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const target = nextConfirmTarget(rec, financials.transactions, todayMidnight);
    if (!target) return; // nothing left to confirm
    const result = buildRecurringConfirmLog(rec, financials.lbpRate ?? DEFAULT_LBP_RATE, target.dueDate, paidDate);
    loggingRecurringRef.current.add(recurringId);
    setLoggingRecurringIds(new Set(loggingRecurringRef.current));
    try {
      await handleChange({
        ...financials,
        transactions: [result.tx, ...financials.transactions],
      });
      // Brief "Confirmed" state (2.4.30, finding 3) -- cleared on its own
      // timer, not tied to the next render, so it's visible even though the
      // button's own target has already moved on to the next cycle.
      const existingTimer = justConfirmedTimers.current.get(recurringId);
      if (existingTimer) clearTimeout(existingTimer);
      setJustConfirmedIds((prev) => new Set(prev).add(recurringId));
      justConfirmedTimers.current.set(recurringId, setTimeout(() => {
        setJustConfirmedIds((prev) => { const next = new Set(prev); next.delete(recurringId); return next; });
        justConfirmedTimers.current.delete(recurringId);
      }, 1600));
    } finally {
      loggingRecurringRef.current.delete(recurringId);
      setLoggingRecurringIds(new Set(loggingRecurringRef.current));
    }
  }

  // Confirms one specific pre-cutover cycle from pendingBackfillCycles
  // (2.4.31) -- unlike handleConfirmRecurringPayment, the caller already
  // knows exactly which cycle (from the item's own detail view), so there's
  // no nextConfirmTarget resolution here, just building and logging the
  // transaction for that exact historical due date. Dates the transaction
  // to that due date, not today (buildRecurringConfirmLog's default
  // paidDate), the same way any other confirm does.
  async function handleBackfillRecurringCycle(recurringId: string, dueDate: Date) {
    if (!financials) return;
    const key = `${recurringId}:${dueDate.toISOString().slice(0, 10)}`;
    if (backfillingRef.current.has(key)) return; // already in flight
    const rec = financials.recurring.find((r) => r.id === recurringId);
    if (!rec) return;
    const result = buildRecurringConfirmLog(rec, financials.lbpRate ?? DEFAULT_LBP_RATE, dueDate);
    backfillingRef.current.add(key);
    setBackfillingIds(new Set(backfillingRef.current));
    try {
      await handleChange({ ...financials, transactions: [result.tx, ...financials.transactions] });
    } finally {
      backfillingRef.current.delete(key);
      setBackfillingIds(new Set(backfillingRef.current));
    }
  }

  function handleDismissRecurringModelNotice() {
    if (!financials) return;
    handleChange({ ...financials, recurringModelNoticeSeen: true });
  }

  function handleSignOut() {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    signOut();
    router.push("/sign-in");
  }
  function handleProfile() { router.push("/profile"); }

  const dashboardData = useMemo(() => (financials ? computeDashboard(financials) : null), [financials]);

  // Persist monthly snapshots (net worth, income, LBP rate) so past months
  // can be judged against what was actually true then, not whatever these
  // settings are today. computeDashboard stays pure/side-effect-free — this
  // is the one place that writes snapshots back, and only when something's
  // actually stale (new month, or this month's value changed), so it can't loop.
  useEffect(() => {
    if (!financials || !dashboardData) return;
    const now = new Date();
    // The one write path for all four histories, and now the one place their
    // two key spaces are distinguished. Identical strings at startDay 1; the
    // TYPES differ, which is what stops a future edit from keying
    // netWorthHistory by cycle or the other three by calendar (2.4.87).
    const cycleYm = currentCycleKey(now, cycleStartDayOf(financials));
    const calendarYm = calendarKeyForDate(now);

    function snapshot<K extends string>(history: { ym: K; value: number }[] | undefined, ym: K, value: number) {
      const h = history ?? [];
      if (h.find((e) => e.ym === ym)?.value === value) return h;
      return [...h.filter((e) => e.ym !== ym), { ym, value }]
        .sort((a, b) => a.ym.localeCompare(b.ym))
        .slice(-24);
    }

    function snapshotBudgetPct(
      history: CycleHistory<{ needs: number; wants: number; savings: number }> | undefined,
      ym: CycleKey,
      pct: { needs: number; wants: number; savings: number },
    ) {
      const h = history ?? [];
      const existing = h.find((e) => e.ym === ym);
      if (existing && existing.needs === pct.needs && existing.wants === pct.wants && existing.savings === pct.savings) return h;
      return [...h.filter((e) => e.ym !== ym), { ym, ...pct }]
        .sort((a, b) => a.ym.localeCompare(b.ym))
        .slice(-24);
    }

    const updatedNetWorth  = snapshot(financials.netWorthHistory, calendarYm, dashboardData.netWorth.total);
    // 2.4.105: a zero income is never recorded. Clearing the field yields
    // `parseFloat("") || 0`, and a transient zero held across a cycle
    // boundary becomes that cycle's permanent recorded income -- the entry
    // is only ever written for the CURRENT key, so nothing revisits it.
    //
    // This does NOT distinguish a transient zero from a genuine one; they
    // are the same value by the same path with no marker. It declines to
    // record either, which matches how every other consumer already reads 0
    // -- as unconfigured, not as an income level (Setup's "set your monthly
    // income to unlock", incomeSafe's floor of 1, and the savings-streak
    // comment bundling "between jobs" with "not yet re-entered").
    //
    // A refusal to WRITE, never a removal: an existing entry stands. And
    // absence is not a gap -- valueForMonth resolves a keyless cycle to the
    // most recent earlier figure, so a genuinely income-less cycle inherits
    // the prior one. That trade is asserted in page.income-snapshot.test.tsx
    // rather than left to be discovered.
    // NB `financials.incomeHistory` verbatim, NOT `?? []`: the no-op guard
    // below compares by REFERENCE, so returning a fresh [] for an account
    // whose history is still undefined would read as "changed" on every
    // render and persist in a loop -- the exact shape 2.4.84's test guards.
    const updatedIncome    = financials.income === 0
      ? financials.incomeHistory
      : snapshot(financials.incomeHistory, cycleYm, financials.income);
    const updatedLbpRate   = snapshot(financials.lbpRateHistory, cycleYm, financials.lbpRate);
    const updatedBudgetPct = snapshotBudgetPct(financials.budgetRuleHistory, cycleYm, dashboardData.budgetTargetPct);

    if (updatedNetWorth === financials.netWorthHistory
      && updatedIncome === financials.incomeHistory
      && updatedLbpRate === financials.lbpRateHistory
      && updatedBudgetPct === financials.budgetRuleHistory) return;

    handleChange({
      ...financials,
      netWorthHistory: updatedNetWorth,
      incomeHistory: updatedIncome,
      lbpRateHistory: updatedLbpRate,
      budgetRuleHistory: updatedBudgetPct,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financials, dashboardData]);

  // 30-day retention for soft-deleted transactions (2026-09-01) -- checked
  // opportunistically on load, same shape as the snapshot effect above, not
  // a background timer (there's no process running when the app isn't
  // open). autoPurgeExpired returns the same array reference when nothing
  // needs purging, so this can't loop.
  useEffect(() => {
    if (!financials) return;
    const purged = autoPurgeExpired(financials.transactions);
    if (purged === financials.transactions) return;
    handleChange({ ...financials, transactions: purged });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financials]);

  // If the initial session/data load hangs (a stuck decrypt, a slow or
  // failed auto-pull, anything), the loading branch below used to spin
  // forever with no indication anything was wrong. This flips 8s after
  // loading starts, and back off the moment loading actually finishes, so
  // a normal fast load never shows it.
  const loaded = !!(session && financials && dashboardData);
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  useEffect(() => {
    if (loaded) { setLoadingTooLong(false); return; }
    const t = setTimeout(() => setLoadingTooLong(true), 8000);
    return () => clearTimeout(t);
  }, [loaded]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: T.ink }}>
        <div className="flex flex-1 overflow-hidden">
          <div className="hidden md:block flex-shrink-0 animate-pulse" style={{ width: 220, background: T.panel, borderRight: `1px solid ${T.line}` }} />
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-10">
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center gap-3">
                <Signet size={40} />
                <div className="animate-pulse rounded-lg" style={{ width: 120, height: 16, background: T.panel }} />
              </div>
              <div className="animate-pulse rounded-2xl" style={{ height: 120, background: T.panel, border: `1px solid ${T.line}` }} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="animate-pulse rounded-2xl" style={{ height: 88, background: T.panel, border: `1px solid ${T.line}` }} />
                ))}
              </div>
              <div className="animate-pulse rounded-2xl" style={{ height: 200, background: T.panel, border: `1px solid ${T.line}` }} />
            </div>
          </div>
        </div>
        {loadingTooLong && (
          <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-sm w-[calc(100%-2rem)] rounded-2xl px-5 py-4 text-center shadow-2xl"
            style={{ background: T.panel, border: `1px solid ${T.line}` }}
          >
            <p className="text-sm" style={{ color: T.text }}>This is taking longer than expected.</p>
            <p className="text-xs mt-1" style={{ color: T.mute }}>Your data hasn&apos;t been touched — it&apos;s still safe in your browser. A slow connection or a stuck tab can cause this.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
              style={{ background: T.jade, color: T.ink }}
            >
              Reload the page
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: T.ink }}>

      {/* Mobile header */}
      <TopBar session={session} onProfile={handleProfile} onSignOut={handleSignOut} syncStatus={syncStatus} />

      {/* Body row */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Desktop sidebar */}
        <Sidebar
          screen={screen} setScreen={setScreen}
          session={session} onProfile={handleProfile}
          syncStatus={syncStatus}
        />

        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {screen === "overview"     && <FinancialDashboard data={dashboardData} financials={financials ?? undefined} onNavigate={setScreen} onConfirmRecurring={handleConfirmRecurringPayment} loggingRecurringIds={loggingRecurringIds} justConfirmedIds={justConfirmedIds} />}
          {screen === "budget"       && <BudgetScreen financials={financials} dashData={dashboardData} onChange={handleChange} />}
          {screen === "setup"        && <SetupScreen financials={financials} dashData={dashboardData} onChange={handleChange} />}
          {screen === "finances"     && <InputPanel financials={financials} dashData={dashboardData} onChange={handleChange} session={session} onConfirmRecurring={handleConfirmRecurringPayment} loggingRecurringIds={loggingRecurringIds} justConfirmedIds={justConfirmedIds} onEdit={handleEdit} onPay={setPayingDebtId} />}
          {screen === "transactions" && <TransactionsScreen financials={financials} onChange={handleChange} onEdit={(id) => handleEdit("transaction", id)} />}
          {screen === "categories"   && <CategoriesScreen financials={financials} onChange={handleChange} />}
          {screen === "goals"        && <GoalsScreen dashData={dashboardData} financials={financials} onChange={handleChange} onEdit={(id) => handleEdit("goal", id)} />}
          {screen === "debts"        && <DebtsScreen financials={financials} dashData={dashboardData} onEdit={(id) => handleEdit("debt", id)} onPay={setPayingDebtId} />}
          {screen === "recurring"    && <RecurringScreen financials={financials} onEdit={(id) => handleEdit("recurring", id)} />}
          {screen === "projections"  && <ProjectionsScreen financials={financials} dashData={dashboardData} />}
          {screen === "journey"      && <JourneyScreen financials={financials} dashData={dashboardData} onNavigate={setScreen} />}
          {screen === "currency"     && <CurrencyScreen financials={financials} onChange={handleChange} />}
          {screen === "balancecheck" && <BalanceCheckScreen financials={financials} dashData={dashboardData} onChange={handleChange} />}
          {screen === "wishlist"     && <WishlistScreen financials={financials} onChange={handleChange} />}
          {screen === "statistics"   && <StatisticsScreen financials={financials} dashData={dashboardData} />}
        </div>

      </div>

      {/* Mobile bottom nav */}
      <BottomNav screen={screen} setScreen={setScreen} />

      {/* Merge notice (Phase 2.7 sub-phase 3) -- deliberately NOT auto-dismissed.
          A silent-by-default notification about money changing is what this
          exists to avoid (owner's instruction, 2026-09-01); it stays until
          the user dismisses it themselves. */}
      {mergeNotice && (
        <div
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md rounded-2xl px-4 py-3.5 shadow-2xl z-50 flex items-start gap-3"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <span className="text-sm flex-1" style={{ color: T.text }}>
            {mergeNotice.text}
            {mergeNotice.showReviewLink && (
              <>
                {" "}
                <button
                  onClick={() => { setScreen("transactions"); setMergeNotice(null); }}
                  className="underline font-medium"
                  style={{ color: T.brass }}
                >
                  Review in Transactions
                </button>
              </>
            )}
          </span>
          <button
            onClick={() => setMergeNotice(null)}
            aria-label="Dismiss"
            className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-lg hover:opacity-70 transition-opacity"
            style={{ color: T.mute }}
          >
            ✕
          </button>
        </div>
      )}

      {/* One-time notice: shown once per account migrated onto the confirm-on-due model (Phase 2.5.3) */}
      {!financials.recurringModelNoticeSeen && financials.recurring.some((r) => r.confirmCutoverDate) && (
        <RecurringModelNoticeModal
          outstandingCount={dashboardData.upcomingRenewals.reduce((s, r) => s + r.overdueCount, 0)}
          onDismiss={handleDismissRecurringModelNotice}
        />
      )}

      {/* Shared edit surface -- one sheet per entity kind, opened from
          whichever screen the user was looking at (see EditTarget above). */}
      {editing?.kind === "debt" && (() => {
        const debt = financials.debts.find((d) => d.id === editing.id);
        return debt ? (
          <EditDebtSheet debt={debt} financials={financials} onChange={handleChange} onClose={() => setEditing(null)} />
        ) : null;
      })()}
      {editing?.kind === "recurring" && (() => {
        const rec = financials.recurring.find((r) => r.id === editing.id);
        return rec ? (
          <EditRecurringSheet
            recurring={rec} financials={financials} onChange={handleChange} onClose={() => setEditing(null)}
            onBackfillRecurring={handleBackfillRecurringCycle} backfillingIds={backfillingIds}
          />
        ) : null;
      })()}
      {editing?.kind === "goal" && (() => {
        const goal = financials.goals.find((g) => g.id === editing.id);
        return goal ? (
          <EditGoalSheet goal={goal} financials={financials} onChange={handleChange} onClose={() => setEditing(null)} />
        ) : null;
      })()}
      {payingDebtId && (() => {
        const debt = financials.debts.find((d) => d.id === payingDebtId);
        return debt ? (
          <PayDebtSheet debt={debt} financials={financials} onChange={handleChange} onClose={() => setPayingDebtId(null)} />
        ) : null;
      })()}
      {editing?.kind === "transaction" && (() => {
        const tx = financials.transactions.find((t) => t.id === editing.id);
        return tx ? (
          <EditTransactionSheet transaction={tx} financials={financials} onChange={handleChange} onClose={() => setEditing(null)} />
        ) : null;
      })()}
    </div>
  );
}
