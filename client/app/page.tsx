"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import FinancialDashboard from "../components/FinancialDashboard";
import InputPanel from "../components/InputPanel";
import TransactionsScreen from "../components/screens/TransactionsScreen";
import GoalsScreen from "../components/screens/GoalsScreen";
import DebtsScreen from "../components/screens/DebtsScreen";
import BudgetScreen from "../components/screens/BudgetScreen";
import SetupScreen from "../components/screens/SetupScreen";
import RecurringScreen from "../components/screens/RecurringScreen";
import ProjectionsScreen from "../components/screens/ProjectionsScreen";
import JourneyScreen from "../components/screens/JourneyScreen";
import Sidebar from "../components/shell/Sidebar";
import BottomNav from "../components/shell/BottomNav";
import TopBar from "../components/shell/TopBar";
import type { Screen, SyncStatus } from "../components/screens/shared";
import { loadData, saveData, isEmptyFinancials } from "../lib/localData";
import type { LocalFinancials } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { getSession, hasValidSession, signOut } from "../lib/auth";
import type { Session } from "../lib/auth";
import { pushToServer, pullFromServer, hasAutoPulled, markAutoPulled } from "../lib/syncService";
import { useTheme } from "../contexts/ThemeContext";
import { Signet } from "../components/EssaBrand";

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

  const syncTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef  = useRef<Session | null>(null);

  // keep a stable ref so the debounce closure always sees the latest session
  useEffect(() => { sessionRef.current = session; }, [session]);

  const autoSync = useCallback(async (data: LocalFinancials, email: string) => {
    setSyncStatus("syncing");
    const result = await pushToServer(email, data);
    setSyncStatus(result.ok ? "synced" : "offline");
    // fade back to idle after 4 s so the indicator doesn't stay forever
    setTimeout(() => setSyncStatus((s) => s !== "syncing" ? "idle" : s), 4000);
  }, []);

  useEffect(() => {
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
      if (isEmptyFinancials(data) && !hasAutoPulled(s.userId)) {
        markAutoPulled(s.userId);
        const result = await pullFromServer(s.email);
        if (result.ok && !isEmptyFinancials(result.data)) {
          const pulled = { ...result.data, userName: s.name };
          await saveData(pulled, s.userId);
          setFinancials(pulled);
          return;
        }
      }
      setFinancials({ ...data, userName: s.name });
    });
  }, [router]);

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
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    function snapshot(history: { ym: string; value: number }[] | undefined, value: number) {
      const h = history ?? [];
      if (h.find((e) => e.ym === ym)?.value === value) return h;
      return [...h.filter((e) => e.ym !== ym), { ym, value }]
        .sort((a, b) => a.ym.localeCompare(b.ym))
        .slice(-24);
    }

    function snapshotBudgetPct(
      history: { ym: string; needs: number; wants: number; savings: number }[] | undefined,
      pct: { needs: number; wants: number; savings: number },
    ) {
      const h = history ?? [];
      const existing = h.find((e) => e.ym === ym);
      if (existing && existing.needs === pct.needs && existing.wants === pct.wants && existing.savings === pct.savings) return h;
      return [...h.filter((e) => e.ym !== ym), { ym, ...pct }]
        .sort((a, b) => a.ym.localeCompare(b.ym))
        .slice(-24);
    }

    const updatedNetWorth  = snapshot(financials.netWorthHistory, dashboardData.netWorth.total);
    const updatedIncome    = snapshot(financials.incomeHistory, financials.income);
    const updatedLbpRate   = snapshot(financials.lbpRateHistory, financials.lbpRate);
    const updatedBudgetPct = snapshotBudgetPct(financials.budgetRuleHistory, dashboardData.budgetTargetPct);

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

  if (!session || !financials || !dashboardData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: T.ink }}>
        <Signet size={40} />
        <p className="text-sm" style={{ color: T.mute }}>Loading…</p>
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
          {screen === "overview"     && <FinancialDashboard data={dashboardData} onNavigate={setScreen} />}
          {screen === "budget"       && <BudgetScreen financials={financials} dashData={dashboardData} onChange={handleChange} />}
          {screen === "setup"        && <SetupScreen financials={financials} dashData={dashboardData} onChange={handleChange} />}
          {screen === "finances"     && <InputPanel financials={financials} dashData={dashboardData} onChange={handleChange} session={session} />}
          {screen === "transactions" && <TransactionsScreen financials={financials} />}
          {screen === "goals"        && <GoalsScreen dashData={dashboardData} financials={financials} onChange={handleChange} />}
          {screen === "debts"        && <DebtsScreen financials={financials} dashData={dashboardData} />}
          {screen === "recurring"    && <RecurringScreen financials={financials} />}
          {screen === "projections"  && <ProjectionsScreen financials={financials} dashData={dashboardData} />}
          {screen === "journey"      && <JourneyScreen financials={financials} dashData={dashboardData} onNavigate={setScreen} />}
        </div>

      </div>

      {/* Mobile bottom nav */}
      <BottomNav screen={screen} setScreen={setScreen} />
    </div>
  );
}
