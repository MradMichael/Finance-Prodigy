"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSession, hasValidSession, updateProfile, deleteAccount, signOut, ensureFirstUserIsAdmin, regenerateRecoveryCode } from "../../lib/auth";
import RecoveryCodeModal from "../../components/RecoveryCodeModal";
import type { Session } from "../../lib/auth";
import { loadData, saveData, activeTransactions } from "../../lib/localData";
import { computeDashboard } from "../../lib/computeDashboard";
import { buildReportHtml } from "../../lib/printReport";
import { pushToServer, pullFromServer, getLastSyncTime, confirmOverwriteIfNeeded } from "../../lib/syncService";
import type { LocalFinancials } from "../../lib/localData";
import { isAnalyticsOptedIn, setAnalyticsOptIn } from "../../lib/analytics";
import { useTheme, useThemeControl } from "../../contexts/ThemeContext";
import { THEMES, type ThemeKey } from "../../lib/theme";
import Field from "../../components/form/Field";

const THEME_SWATCHES: { key: ThemeKey; accent: string; bg: string }[] = [
  { key: "ledger",   accent: "#4FD1A5", bg: "#11302C" },
  { key: "midnight", accent: "#58AEFF", bg: "#0C1230" },
  { key: "obsidian", accent: "#2DCA6A", bg: "#1C1A17" },
  { key: "aurora",   accent: "#B060FF", bg: "#130F28" },
  { key: "ember",    accent: "#FF7820", bg: "#221200" },
  { key: "ivory",    accent: "#007848", bg: "#EDE8E1" },
];

export default function ProfilePage() {
  const router  = useRouter();
  const T       = useTheme();
  const { theme: activeTheme, setTheme } = useThemeControl();

  const [session,       setSession]       = useState<Session | null>(null);
  const [name,          setName]          = useState("");
  const [saveMsg,       setSaveMsg]       = useState("");
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [syncMsg,       setSyncMsg]       = useState("");
  const [syncing,       setSyncing]       = useState(false);
  const [pdfDetailed,   setPdfDetailed]   = useState(false);
  const [pdfDateFrom,   setPdfDateFrom]   = useState("");
  const [pdfDateTo,     setPdfDateTo]     = useState("");
  const [downloading,   setDownloading]   = useState<"data" | "pdf" | null>(null);
  const [downloadMsg,   setDownloadMsg]   = useState("");
  const [importing,     setImporting]     = useState(false);
  const [importMsg,     setImportMsg]     = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [recoveryMsg,     setRecoveryMsg]     = useState("");
  const [regenerating,    setRegenerating]    = useState(false);
  const [lastSync,      setLastSync]      = useState<string | null>(null);
  const [analyticsOn,   setAnalyticsOn]   = useState(false);

  useEffect(() => {
    ensureFirstUserIsAdmin();
    const s = getSession();
    if (!s || !hasValidSession()) {
      // Same session-outlives-its-key gap as the main dashboard — this page
      // also calls loadData/saveData (export, pull), so it needs the same guard.
      if (s) signOut();
      router.replace("/sign-in");
      return;
    }
    setSession(s);
    setName(s.name);
    setLastSync(getLastSyncTime());
    setAnalyticsOn(isAnalyticsOptedIn());
  }, [router]);

  function toggleAnalytics() {
    const next = !analyticsOn;
    setAnalyticsOptIn(next);
    setAnalyticsOn(next);
  }

  async function handlePull() {
    if (!session) return;
    // 2.4.37: this device may hold real data the server's copy would
    // silently replace -- ask first if so, rather than the previous
    // unconditional overwrite.
    if (!(await confirmOverwriteIfNeeded(session.userId, "what's on the server"))) return;
    setSyncing(true); setSyncMsg("");
    const result = await pullFromServer(session.email);
    if (result.ok) {
      await saveData(result.data, session.userId);
      setLastSync(result.syncedAt);
      setSyncMsg("✓ Data restored from database. Reloading…");
      // The dashboard (app/page.tsx) only reads localStorage once, into React
      // state, on its own mount -- it has no way to know data changed here on
      // a different route. Without a hard reload, the dashboard keeps showing
      // (and editing on top of) its stale pre-pull state, and the very next
      // edit there would silently overwrite the just-restored data with a
      // merge based on that stale state. A full navigation forces it to
      // remount and re-read the localStorage this just wrote.
      setTimeout(() => { window.location.href = "/"; }, 700);
    } else {
      setSyncing(false);
      setSyncMsg("✗ " + result.error);
    }
  }

  async function handlePush() {
    if (!session) return;
    setSyncing(true); setSyncMsg("");
    const data = await loadData(session.userId);
    const result = await pushToServer(session.email, data);
    setSyncing(false);
    if (result.ok) {
      setLastSync(result.syncedAt ?? null);
      setSyncMsg("✓ Pushed to database.");
    } else {
      setSyncMsg("✗ " + result.error);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !name.trim()) return;
    updateProfile(session.userId, name.trim());
    const updated = { ...session, name: name.trim() };
    setSession(updated);
    setSaveMsg("Saved!");
    setTimeout(() => setSaveMsg(""), 2000);
  }

  async function handleDelete() {
    if (!session) return;
    if (deleteConfirm.toLowerCase() !== "delete") return;
    const { serverCleanupOk } = await deleteAccount(session.userId);
    // 2.2.18: local deletion has already happened by this point regardless
    // -- this only decides whether to also warn about the server half, not
    // whether to proceed. alert() (not a styled inline message) because
    // this page navigates away immediately after; a message left in
    // component state would never be seen once unmounted, and this file
    // already uses the same native-dialog pattern elsewhere.
    if (!serverCleanupOk) {
      alert("Your local data has been deleted. We couldn't confirm your server backup was also removed -- this doesn't affect your device, but a copy may still exist on the server.");
    }
    router.push("/sign-in");
  }

  // "You can leave anytime, nothing's locked in" is a real trust signal for
  // a financial app asking strangers for their data — and cheap to build,
  // since LocalFinancials is already a single serializable object.
  async function handleExport() {
    if (!session) return;
    setDownloading("data"); setDownloadMsg("");
    try {
      const data = await loadData(session.userId);
      // A soft-deleted transaction still has its full payload -- it's
      // filtered from every calculation, not stripped. Left unfiltered
      // here, every transaction ever deleted (with description, amount,
      // everything) would leave the device the moment this file does.
      const exportData = { ...data, transactions: activeTransactions(data.transactions) };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `essa-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  }

  // The counterpart to handleExport — restoring one of those downloaded
  // files back into the account. Added per owner's explicit request (2.4.37):
  // before this, an export was read-only for anyone but a developer with
  // filesystem access — the data existed but there was no way in the app
  // itself to put it back, which is exactly the gap the owner hit recovering
  // from 2.4.33 by hand. Same destination as Pull (saveData, full reload),
  // same guard (confirmOverwriteIfNeeded) — the only thing that changes is
  // where the replacement data comes from.
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // clears the input so re-selecting the same file later still fires onChange
    if (!file || !session) return;
    setImportMsg("");

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportMsg("✗ That file isn't valid JSON.");
      return;
    }
    // Deliberately loose — this only needs to catch "wrong file entirely"
    // (a PDF renamed .json, a bank statement CSV saved as .json, an empty
    // file), not validate the full schema. migrateFinancials (via saveData)
    // already handles real schema differences between export vintages; a
    // strict validator here would just be a second, competing definition of
    // "valid," another duplicate-logic site this project has been bitten by
    // before.
    if (
      typeof parsed !== "object" || parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).transactions) ||
      typeof (parsed as Record<string, unknown>).schemaVersion !== "number"
    ) {
      setImportMsg("✗ That doesn't look like an ESSA export file.");
      return;
    }

    if (!(await confirmOverwriteIfNeeded(session.userId, "the file you selected"))) return;

    setImporting(true);
    try {
      await saveData(parsed as LocalFinancials, session.userId);
      setImportMsg("✓ Data restored from file. Reloading…");
      // Same reload requirement as handlePull — see its own comment.
      setTimeout(() => { window.location.href = "/"; }, 700);
    } catch {
      setImportMsg("✗ Couldn't restore that file.");
      setImporting(false);
    }
  }

  // "Download as PDF" is just printing a report to the browser's own Save
  // as PDF destination — no PDF-generation library needed. Opens in a new
  // tab (rather than printing the profile page itself) so the report gets
  // its own clean, print-optimized layout instead of fighting the app's
  // dark theme and navigation chrome.
  async function handleDownloadPdf() {
    if (!session) return;
    setDownloadMsg("");
    // Opened synchronously, before any await, so browsers still treat it as
    // a direct response to the click rather than a popup to block — once an
    // await separates window.open() from the click event, most browsers no
    // longer consider it user-initiated.
    const win = window.open("", "_blank");
    if (!win) {
      // popup blocked — this used to fail with zero feedback, leaving the
      // user thinking the button just didn't work.
      setDownloadMsg("✗ Your browser blocked the report from opening. Allow popups for this site and try again.");
      return;
    }
    setDownloading("pdf");
    try {
      const data = await loadData(session.userId);
      const dash = computeDashboard(data);
      const html = buildReportHtml(session.name, data, dash, {
        detailed: pdfDetailed,
        dateFrom: pdfDetailed && pdfDateFrom ? pdfDateFrom : undefined,
        dateTo: pdfDetailed && pdfDateTo ? pdfDateTo : undefined,
      });
      win.document.write(html);
      win.document.close();
      win.onload = () => win.print();
    } finally {
      setDownloading(null);
    }
  }

  async function handleRegenerateRecovery() {
    if (!session) return;
    setRecoveryMsg("");
    if (!confirm("Generate a new recovery code? Your old recovery code will stop working immediately.")) return;
    setRegenerating(true);
    try {
      const result = await regenerateRecoveryCode(session.userId);
      if (!result.ok) { setRecoveryMsg(result.error); return; }
      setNewRecoveryCode(result.recoveryCode);
      // Regenerating only updates this device's local record — the server
      // still has whatever recovery token the last push carried, which is
      // now stale. Push immediately so the new code actually works from
      // another device right away, instead of silently waiting on the next
      // unrelated data edit to carry it up (the gap that made an already-
      // regenerated code fail to recover from a second device).
      const data = await loadData(session.userId);
      await pushToServer(session.email, data);
    } finally {
      setRegenerating(false);
    }
  }

  const initials = session ? session.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) : "…";

  return (
    <div className="min-h-screen" style={{ background: T.ink }}>

      {/* Top bar */}
      <header
        className="flex items-center gap-3 px-6 py-3"
        style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}
      >
        <button
          onClick={() => router.push("/")}
          className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ color: T.mute }}
        >
          ← Back
        </button>
        <span className="text-sm font-medium" style={{ color: T.text }}>Account settings</span>
      </header>

      <div className="max-w-lg mx-auto px-4 py-10 space-y-6">

        {/* Avatar */}
        <div className="flex flex-col items-center gap-3 py-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold shadow-lg"
            style={{ background: T.jade + "25", color: T.jade, border: `2px solid ${T.jade}40` }}
          >
            {initials}
          </div>
          {session && (
            <p className="text-sm" style={{ color: T.mute }}>{session.email}</p>
          )}
        </div>

        {/* Appearance */}
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <h2 className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
            Appearance
          </h2>
          <p className="text-xs" style={{ color: T.mute }}>Choose your color palette</p>
          <div className="grid grid-cols-3 gap-3">
            {THEME_SWATCHES.map(({ key, accent, bg }) => {
              const meta = THEMES[key];
              const active = activeTheme === key;
              return (
                <button
                  key={key}
                  onClick={() => setTheme(key)}
                  className="rounded-2xl p-4 text-left transition-all hover:opacity-90 active:scale-95"
                  style={{
                    background: bg,
                    border: `2px solid ${active ? accent : "transparent"}`,
                    boxShadow: active ? `0 0 0 1px ${accent}40` : "none",
                  }}
                >
                  <div className="flex gap-1.5 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ background: accent }} />
                    <div className="w-3 h-3 rounded-full opacity-60" style={{ background: accent }} />
                    <div className="w-3 h-3 rounded-full opacity-30" style={{ background: accent }} />
                  </div>
                  <p className="text-xs font-semibold" style={{ color: accent }}>{meta.name}</p>
                  <p className="text-[10px] mt-0.5 opacity-60" style={{ color: accent }}>{meta.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Edit name */}
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <h2 className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
            Profile
          </h2>
          <form onSubmit={handleSave} className="space-y-4">
            <Field label="Display name" value={name} onChange={setName} placeholder="Your name" />
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
              style={{ background: T.jade, color: T.ink }}
            >
              Save changes
            </button>
            {saveMsg && (
              <span className="text-xs ml-3" style={{ color: T.jade }}>{saveMsg}</span>
            )}
          </form>
        </div>

        {/* Account recovery */}
        <div
          className="rounded-2xl p-6 space-y-3"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <h2 className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
            Account recovery
          </h2>
          <p className="text-xs" style={{ color: T.mute }}>
            Your recovery code is shown once and never stored, so it can&apos;t be displayed again. Lost it? Generate a
            new one now, while you know you&apos;re safely signed in. The old code stops working immediately.
          </p>
          <button
            onClick={handleRegenerateRecovery}
            disabled={regenerating}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: T.line, color: T.text }}
          >
            {regenerating ? "Generating…" : "Generate new recovery code"}
          </button>
          {recoveryMsg && <p className="text-xs" style={{ color: T.coral }}>{recoveryMsg}</p>}
        </div>

        {/* Sign out */}
        <div
          className="rounded-2xl p-6"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
            Session
          </h2>
          <button
            onClick={() => { signOut(); router.push("/sign-in"); }}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: T.line, color: T.text }}
          >
            Sign out
          </button>
        </div>

        {/* Database sync */}
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
              Database sync
            </h2>
            <p className="text-xs mt-1" style={{ color: T.mute }}>
              Most changes sync to the database automatically a few seconds after you make them. Use the buttons below to push or restore immediately instead of waiting.
            </p>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: T.mute }}>
              <strong style={{ color: T.text }}>Privacy note:</strong> Your financial data is encrypted in this browser (AES-256). The sync backup stored on the server is protected by your password but is not end-to-end encrypted: the server can read it. If you prefer full privacy, disable sync by not pushing, and use <em>Download my data</em> below to back up locally.
            </p>
            {lastSync && (
              <p className="text-[11px] mt-2 flex items-center gap-1.5" style={{ color: T.jade }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: T.jade }} />
                Last synced: {new Date(lastSync).toLocaleString("en-GB")}
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs mb-2" style={{ color: T.mute }}>
                Push this device&apos;s data to the database now:
              </p>
              <button
                onClick={handlePush}
                disabled={syncing}
                className="w-full px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: T.line, color: T.text }}
              >
                {syncing ? "⏳ Syncing…" : "⬆ Push to database"}
              </button>
            </div>
            <div>
              <p className="text-xs mb-2" style={{ color: T.mute }}>
                Restore data from the database (e.g. on a new device):
              </p>
              <button
                onClick={handlePull}
                disabled={syncing}
                className="w-full px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: T.line, color: T.text }}
              >
                {syncing ? "⏳ Restoring…" : "⬇ Restore from database"}
              </button>
            </div>
          </div>

          {syncMsg && (
            <p className="text-xs" style={{ color: syncMsg.startsWith("✓") ? T.jade : T.coral }}>
              {syncMsg}
            </p>
          )}
        </div>

        {/* About & Help */}
        <div
          className="rounded-2xl p-6 space-y-3"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <h2 className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
            App info
          </h2>
          <Link
            href="/about"
            className="flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm transition-all hover:opacity-80"
            style={{ background: T.panelSoft, color: T.text }}
          >
            <span>About ESSA · FAQ · Contact</span>
            <span style={{ color: T.mute }}>→</span>
          </Link>
          <Link
            href="/security"
            className="flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm transition-all hover:opacity-80"
            style={{ background: T.panelSoft, color: T.text }}
          >
            <span>Trust &amp; Security</span>
            <span style={{ color: T.mute }}>→</span>
          </Link>
        </div>

        {/* Your data */}
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
              Your data
            </h2>
            <p className="text-xs mt-1" style={{ color: T.mute }}>
              Download everything ESSA has for your account: transactions, goals, debts, recurring payments, and
              settings, as a JSON file. Yours to keep, move elsewhere, or back up by hand.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleExport}
              disabled={downloading !== null}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              style={{ background: T.line, color: T.text }}
            >
              {downloading === "data" ? "⏳ Preparing…" : "⬇ Download my data"}
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={downloading !== null}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              style={{ background: T.line, color: T.text }}
            >
              {downloading === "pdf" ? "⏳ Preparing…" : "⬇ Download as PDF"}
            </button>
            <label
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 flex items-center gap-2 cursor-pointer"
              style={{ background: T.line, color: T.text, opacity: importing ? 0.5 : 1 }}
            >
              {importing ? "⏳ Restoring…" : "📁 Import from file"}
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                disabled={importing}
                className="hidden"
              />
            </label>
          </div>
          {downloadMsg && (
            <p className="text-xs" style={{ color: downloadMsg.startsWith("✓") ? T.jade : T.coral }}>
              {downloadMsg}
            </p>
          )}
          {importMsg && (
            <p className="text-xs" style={{ color: importMsg.startsWith("✓") ? T.jade : T.coral }}>
              {importMsg}
            </p>
          )}
          <p className="text-[10px]" style={{ color: T.mute }}>
            Restores from a previously downloaded export — replaces this device&apos;s current data, same as Restore from database above, just from a file instead of the server.
          </p>

          {/* PDF report options */}
          <div className="rounded-xl px-4 py-3 space-y-3" style={{ background: T.panelSoft }}>
            <div className="flex gap-2">
              {([
                { key: false, label: "Summary" },
                { key: true, label: "Detailed" },
              ] as const).map((opt) => (
                <button
                  key={String(opt.key)}
                  onClick={() => setPdfDetailed(opt.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: pdfDetailed === opt.key ? T.jade + "22" : T.ink,
                    border: `1px solid ${pdfDetailed === opt.key ? T.jade : T.line}`,
                    color: pdfDetailed === opt.key ? T.jade : T.mute,
                  }}
                >
                  {opt.label} PDF
                </button>
              ))}
            </div>
            {pdfDetailed && (
              <div>
                <p className="text-[11px] mb-1.5" style={{ color: T.mute }}>
                  Include transactions from this date range (leave blank for all time):
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={pdfDateFrom}
                    onChange={(e) => setPdfDateFrom(e.target.value)}
                    className="rounded-lg px-2.5 py-1.5 text-xs"
                    style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, colorScheme: "dark" }}
                  />
                  <span className="text-xs" style={{ color: T.mute }}>to</span>
                  <input
                    type="date"
                    value={pdfDateTo}
                    onChange={(e) => setPdfDateTo(e.target.value)}
                    className="rounded-lg px-2.5 py-1.5 text-xs"
                    style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, colorScheme: "dark" }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Analytics opt-in */}
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
                Help improve ESSA
              </h2>
              <p className="text-xs mt-1" style={{ color: T.mute }}>
                On by default, sends anonymous counts for a handful of named actions (like completing onboarding
                steps), no third-party tracker, no identity attached, never your financial data. Turn it off anytime.
              </p>
            </div>
            <button
              onClick={toggleAnalytics}
              role="switch"
              aria-checked={analyticsOn}
              className="flex-shrink-0 w-11 h-6 rounded-full relative transition-colors"
              style={{ background: analyticsOn ? T.jade : T.line }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                style={{ background: T.ink, left: analyticsOn ? "22px" : "2px" }}
              />
            </button>
          </div>
        </div>

        {/* Danger zone */}
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{ background: T.panel, border: `1px solid ${T.coral}30` }}
        >
          <h2 className="text-sm font-semibold" style={{ color: T.coral, fontFamily: "Spectral, Georgia, serif" }}>
            Danger zone
          </h2>
          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
              style={{ background: T.coral + "18", color: T.coral, border: `1px solid ${T.coral}40` }}
            >
              Delete account & all data
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: T.mute }}>
                This will permanently delete your account and all financial data. Type <strong style={{ color: T.coral }}>delete</strong> to confirm.
              </p>
              <Field
                label="Type delete to confirm"
                value={deleteConfirm}
                onChange={setDeleteConfirm}
                placeholder="delete"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleteConfirm.toLowerCase() !== "delete"}
                  className="px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                  style={{ background: T.coral, color: T.ink }}
                >
                  Delete permanently
                </button>
                <button
                  onClick={() => { setShowDelete(false); setDeleteConfirm(""); }}
                  className="px-4 py-2 rounded-xl text-sm transition-all hover:opacity-70"
                  style={{ color: T.mute }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

      </div>

      {newRecoveryCode && (
        <RecoveryCodeModal code={newRecoveryCode} onContinue={() => setNewRecoveryCode(null)} />
      )}
    </div>
  );
}
