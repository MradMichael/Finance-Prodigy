"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSession, updateProfile, deleteAccount, signOut, isAdmin, ensureFirstUserIsAdmin } from "../../lib/auth";
import type { Session } from "../../lib/auth";
import { loadData, saveData } from "../../lib/localData";
import { pullFromServer, getLastSyncTime } from "../../lib/syncService";
import { useTheme, useThemeControl } from "../../contexts/ThemeContext";
import { THEMES, type ThemeKey } from "../../lib/theme";

function Field({
  label, type = "text", value, onChange, placeholder,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  const T = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest mb-1.5 font-medium" style={{ color: T.mute }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-4 py-3 text-sm transition-all duration-150"
        style={{
          background: T.panelSoft,
          border: `1px solid ${focused ? T.jade : T.line}`,
          color: T.text,
          outline: "none",
          boxShadow: focused ? `0 0 0 3px ${T.jade}28` : "none",
          colorScheme: "dark",
        }}
      />
    </div>
  );
}

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
  const [admin,         setAdmin]         = useState(false);
  const [name,          setName]          = useState("");
  const [saveMsg,       setSaveMsg]       = useState("");
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [syncMsg,       setSyncMsg]       = useState("");
  const [syncing,       setSyncing]       = useState(false);
  const [lastSync,      setLastSync]      = useState<string | null>(null);

  useEffect(() => {
    ensureFirstUserIsAdmin();
    const s = getSession();
    if (!s) { router.replace("/sign-in"); return; }
    setSession(s);
    setName(s.name);
    setLastSync(getLastSyncTime());
    setAdmin(isAdmin(s.userId));
  }, [router]);

  async function handlePull() {
    if (!session) return;
    setSyncing(true); setSyncMsg("");
    const result = await pullFromServer(session.email);
    setSyncing(false);
    if (result.ok) {
      await saveData(result.data, session.userId);
      setLastSync(result.syncedAt);
      setSyncMsg("✓ Data restored from database.");
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

  function handleDelete() {
    if (!session) return;
    if (deleteConfirm.toLowerCase() !== "delete") return;
    deleteAccount(session.userId);
    router.push("/sign-in");
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
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95"
              style={{ background: T.jade, color: T.ink }}
            >
              Save changes
            </button>
            {saveMsg && (
              <span className="text-xs ml-3" style={{ color: T.jade }}>{saveMsg}</span>
            )}
          </form>
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
              Your data is automatically saved to SQL Server whenever you make changes — no action needed.
            </p>
            {lastSync && (
              <p className="text-[11px] mt-2 flex items-center gap-1.5" style={{ color: T.jade }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: T.jade }} />
                Last synced: {new Date(lastSync).toLocaleString("en-GB")}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs mb-2" style={{ color: T.mute }}>
              To restore data from the database (e.g. on a new device):
            </p>
            <button
              onClick={handlePull}
              disabled={syncing}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              style={{ background: T.line, color: T.text }}
            >
              {syncing ? "⏳ Restoring…" : "⬇ Restore from database"}
            </button>
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
          {admin && (
            <Link
              href="/admin"
              className="flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm transition-all hover:opacity-80"
              style={{ background: T.brass + "12", color: T.brass, border: `1px solid ${T.brass}28` }}
            >
              <span className="flex items-center gap-2">
                <span>⚙</span> Admin panel
              </span>
              <span>→</span>
            </Link>
          )}
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
    </div>
  );
}
