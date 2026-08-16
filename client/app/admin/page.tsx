"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, isAppAdmin, ensureFirstUserIsAdmin, listUsers } from "../../lib/auth";
import { getLastSyncTime } from "../../lib/syncService";
import { useTheme } from "../../contexts/ThemeContext";
import { Signet } from "../../components/EssaBrand";

const SERIF: React.CSSProperties = { fontFamily: "Spectral, Georgia, serif" };
// Relative — proxied to the real API server by the next.config.js rewrite,
// so this reflects the actual deployed API_URL, not just localhost.
const API = "";

interface ServerHealth {
  ok: boolean;
  latencyMs: number;
  service?: string;
  error?: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  isAdmin?: boolean;
  lastSync: string | null;
  hasData: boolean;
}

function EmailField({ email }: { email: string }) {
  const T = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: T.mute }}>
      <span style={{ filter: shown ? "none" : "blur(4px)", transition: "filter 0.2s", userSelect: shown ? undefined : "none" as React.CSSProperties["userSelect"] }}>{email}</span>
      <button onClick={() => setShown((v) => !v)} className="text-[9px] px-1.5 py-0.5 rounded hover:opacity-70" style={{ border: `1px solid ${T.line}`, color: T.mute }}>
        {shown ? "hide" : "show"}
      </button>
    </span>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  const T = useTheme();
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        background: ok ? T.jade + "18" : T.coral + "18",
        color: ok ? T.jade : T.coral,
        border: `1px solid ${ok ? T.jade + "40" : T.coral + "40"}`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: ok ? T.jade : T.coral }} />
      {label}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const T = useTheme();
  return (
    <section className="rounded-2xl p-6 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <h2 className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, mono = false, sensitive = false, copyable = false }: { label: string; value: React.ReactNode; mono?: boolean; sensitive?: boolean; copyable?: boolean }) {
  const T = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  function copy() {
    if (typeof value !== "string") return;
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="flex items-start justify-between gap-4 py-2.5" style={{ borderBottom: `1px solid ${T.line}` }}>
      <span className="text-sm flex-shrink-0" style={{ color: T.mute }}>{label}</span>
      <div className="flex items-center gap-2 text-right">
        <span
          className="text-sm"
          style={{
            color: T.text,
            fontFamily: mono ? "monospace" : undefined,
            wordBreak: "break-all",
            filter: sensitive && !revealed ? "blur(5px)" : "none",
            userSelect: sensitive && !revealed ? "none" : undefined,
            transition: "filter 0.2s",
          }}
        >
          {value}
        </span>
        {sensitive && (
          <button
            onClick={() => setRevealed((v) => !v)}
            className="text-[10px] px-2 py-1 rounded-lg flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ color: T.mute, border: `1px solid ${T.line}` }}
          >
            {revealed ? "hide" : "show"}
          </button>
        )}
        {copyable && typeof value === "string" && (
          <button
            onClick={copy}
            className="text-[10px] px-2 py-1 rounded-lg flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ color: T.mute, border: `1px solid ${T.line}` }}
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        )}
      </div>
    </div>
  );
}

// Gated by one specific account's email (isAppAdmin, in auth.ts), not by
// environment -- this panel is meant to be reachable on the live production
// site for that one real account, not just during local dev. Unlike the
// previous NODE_ENV-based version of this gate, that means AdminPageContent's
// full source (the DB/rate-limit/architecture details below) does ship in
// the public JS bundle to every visitor: a runtime session check can't be
// proven false at build time, so it can't be dead-code-eliminated the way
// the old dev-only check could. That's still safe to ship, because nothing
// below is an actual credential -- NEXT_PUBLIC_DB_URL is never set in
// production (verified against the live deploy), so the connection string
// shown always falls back to the placeholder, and everything else (rate
// limits, PBKDF2 iteration count, theme names) is operational trivia, not a
// secret. The real access gate is the session check in AdminPageContent's
// effect below.
export default function AdminPage() {
  return <AdminPageContent />;
}

function AdminPageContent() {
  const router = useRouter();
  const T      = useTheme();

  const [ready,   setReady]   = useState(false);
  const [health,  setHealth]  = useState<ServerHealth | null>(null);
  const [users,   setUsers]   = useState<UserRow[]>([]);
  const [pinging, setPinging] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s || !isAppAdmin(s.email)) { router.replace("/"); return; }
    // Unrelated to the gate above (isAppAdmin checks the session's email,
    // not this per-browser flag) -- kept only to back the per-row "Admin"
    // badge in the Registered users list below.
    ensureFirstUserIsAdmin();

    // Build user rows. essa_last_sync is a single browser-wide key, not
    // namespaced per account — attaching it to every row would misleadingly
    // claim every listed user "last synced" at the same moment. Only the
    // currently signed-in user's row can honestly show it.
    const rows: UserRow[] = listUsers().map((u) => ({
      ...u,
      lastSync: u.id === s.userId ? localStorage.getItem("essa_last_sync") : null,
      hasData:  !!localStorage.getItem(`essa_data_${u.id}`),
    }));
    setUsers(rows);
    setReady(true);

    // Auto-ping on mount
    ping();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ping() {
    setPinging(true);
    const t0 = Date.now();
    try {
      const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(4000) });
      const latencyMs = Date.now() - t0;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setHealth({ ok: true, latencyMs, service: json.service });
    } catch (e: unknown) {
      setHealth({ ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : "Unreachable" });
    }
    setPinging(false);
  }

  if (!ready) return null;

  const dbUrl = process.env.NEXT_PUBLIC_DB_URL ?? "postgresql://<user>:<password>@<project>-pooler.<region>.aws.neon.tech/<database>?sslmode=require";
  const maskedUrl = dbUrl.replace(/:\/\/[^:]+:[^@]+@/, "://<user>:<password>@");
  const lastSync  = getLastSyncTime();

  return (
    <div className="min-h-screen" style={{ background: T.ink }}>

      {/* Header */}
      <header
        className="flex items-center gap-3 px-6 py-3 sticky top-0 z-10"
        style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}
      >
        <button onClick={() => router.back()} className="text-sm px-3 py-1.5 rounded-lg hover:opacity-70 transition-opacity" style={{ color: T.mute }}>
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <Signet size={22} />
          <span className="text-sm font-semibold" style={{ color: T.text, ...SERIF }}>ESSA</span>
        </div>
        <span
          className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest"
          style={{ background: T.brass + "20", color: T.brass, border: `1px solid ${T.brass}40` }}
        >
          Admin
        </span>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>System administration</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Admin panel</h1>
        </div>

        {/* Server health */}
        <Card title="API server">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {health === null ? (
                <StatusBadge ok={false} label="Not checked" />
              ) : health.ok ? (
                <>
                  <StatusBadge ok label="Online" />
                  <span className="text-xs" style={{ color: T.mute }}>{health.latencyMs} ms · {health.service}</span>
                </>
              ) : (
                <>
                  <StatusBadge ok={false} label="Offline" />
                  <span className="text-xs" style={{ color: T.coral }}>{health.error}</span>
                </>
              )}
            </div>
            <button
              onClick={ping}
              disabled={pinging}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80 disabled:opacity-50"
              style={{ background: T.panelSoft, color: T.text, border: `1px solid ${T.line}` }}
            >
              {pinging ? "Pinging…" : "↻ Ping server"}
            </button>
          </div>

          <div className="space-y-0" style={{ borderTop: `1px solid ${T.line}` }}>
            <Row label="API base URL" value="/api (proxied, see API_URL in client/.env)" mono />
            <Row label="Health endpoint" value={`${API}/api/health`} mono copyable />
            <Row label="Sync push" value={`POST ${API}/api/sync/push`} mono copyable />
            <Row label="Sync pull" value={`GET ${API}/api/sync/pull?email=…`} mono />
          </div>

          {/* Offline troubleshooting guide */}
          {health && !health.ok && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: T.coral + "0E", border: `1px solid ${T.coral}35` }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: T.coral }}>How to fix: server offline</p>
              <ol className="space-y-2 text-xs" style={{ color: T.mute }}>
                <li className="flex gap-2"><span style={{ color: T.coral }}>1.</span> Open a terminal (PowerShell or Command Prompt)</li>
                <li className="flex gap-2"><span style={{ color: T.coral }}>2.</span> Navigate to the ESSA server folder (wherever you cloned the repo)</li>
                <li className="flex gap-2"><span style={{ color: T.coral }}>3.</span> Start the server:
                  <code className="ml-1 px-2 py-0.5 rounded text-[11px]" style={{ background: T.ink, color: T.jade }}>npm run dev</code>
                </li>
                <li className="flex gap-2"><span style={{ color: T.coral }}>4.</span> Wait for a log line containing: <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: T.ink, color: T.jade }}>&quot;event&quot;:&quot;server_started&quot;</code></li>
                <li className="flex gap-2"><span style={{ color: T.coral }}>5.</span> Click <strong style={{ color: T.text }}>↻ Ping server</strong> above to verify.</li>
              </ol>
              <p className="text-[10px]" style={{ color: T.mute }}>
                The server must be running for sync to work. Your financial data is safe in localStorage even while offline.
              </p>
            </div>
          )}
        </Card>

        {/* Database */}
        <Card title="Database · Postgres (Neon)">
          <div className="space-y-0" style={{ borderTop: `1px solid ${T.line}` }}>
            <Row label="Provider" value="Neon (Postgres 16)" />
            <Row label="Database" value="neondb" mono />
            <Row label="Auth" value="Password (in connection string)" />
            <Row label="Pooled connection string" value={maskedUrl} mono sensitive copyable />
            <Row label="Migrations" value="Run against DIRECT_URL. Neon's pooler doesn't support the prepared statements Prisma Migrate needs" />
            <Row label="Push/relink retries" value="Up to 3 attempts on a transaction connection blip, ~250-750ms apart" />
          </div>
          <div className="rounded-xl p-4 space-y-2 text-xs" style={{ background: T.panelSoft, color: T.mute }}>
            <p className="font-semibold" style={{ color: T.text }}>Common database issues</p>
            <p><span style={{ color: T.brass }}>•</span> <strong style={{ color: T.text }}>Connection refused / project suspended:</strong> Neon&apos;s free tier suspends idle compute after inactivity; the first request after a while wakes it up and can take a few seconds.</p>
            <p><span style={{ color: T.brass }}>•</span> <strong style={{ color: T.text }}>Push/relink fails with &quot;something went wrong on our side&quot;:</strong> Neon&apos;s pooler can intermittently fail to open the dedicated connection an interactive transaction needs, especially under bursty load (PrismaClientInitializationError or P2028). The server already retries this automatically up to 3 times; a failure after that means it genuinely couldn&apos;t get a connection in time, try again in a few seconds.</p>
            <p><span style={{ color: T.brass }}>•</span> <strong style={{ color: T.text }}>Migration fails with a prepared-statement error:</strong> Make sure <code className="px-1 py-0.5 rounded" style={{ background: T.ink, color: T.jade }}>DIRECT_URL</code> in <code className="px-1 py-0.5 rounded" style={{ background: T.ink, color: T.jade }}>server/.env</code> points at the non-pooled host (no <code className="px-1 py-0.5 rounded" style={{ background: T.ink, color: T.jade }}>-pooler</code> in the hostname).</p>
            <p><span style={{ color: T.brass }}>•</span> <strong style={{ color: T.text }}>Prisma error:</strong> Run <code className="px-1 py-0.5 rounded" style={{ background: T.ink, color: T.jade }}>npx prisma migrate deploy</code> in the server folder to apply any pending migrations.</p>
          </div>
        </Card>

        {/* Rate limits */}
        <Card title="Rate limits">
          <div className="space-y-0" style={{ borderTop: `1px solid ${T.line}` }}>
            <Row label="/api/sync/*" value="100 requests / 15 min / IP" />
            <Row label="/api/auth/check-email" value="30 requests / 15 min / IP" />
            <Row label="/api/events" value="30 requests / 15 min / IP" />
          </div>
          <p className="text-[11px]" style={{ color: T.mute }}>
            Each route has its own limiter (keyed by IP), so heavy use of one never eats into another&apos;s budget. A 429 response means this IP hit its window; it resets on a rolling basis, not a fixed clock.
          </p>
        </Card>

        {/* Sync status */}
        <Card title="Sync status">
          <div className="space-y-0" style={{ borderTop: `1px solid ${T.line}` }}>
            <Row label="Auto-sync" value={<StatusBadge ok label="Enabled: fires 2.5 s after each change" />} />
            <Row label="Last synced" value={lastSync ? new Date(lastSync).toLocaleString("en-GB") : "Never"} />
            <Row label="Sync endpoint" value={`${API}/api/sync/push`} mono />
            <Row label="Storage model" value="Full snapshot per user (push overwrites, pull restores)" />
          </div>
        </Card>

        {/* Users */}
        <Card title={`Registered users · ${users.length} total`}>
          {users.length === 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>No users registered yet.</p>
          ) : (
            <div className="space-y-3">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="rounded-xl p-4"
                  style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-medium" style={{ color: T.text }}>{u.name}</p>
                      <EmailField email={u.email} />
                    </div>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      {u.isAdmin && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider"
                          style={{ background: T.brass + "20", color: T.brass, border: `1px solid ${T.brass}40` }}>
                          Admin
                        </span>
                      )}
                      <StatusBadge ok={u.hasData} label={u.hasData ? "Has data" : "No data"} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: T.mute }}>
                    <span>ID: <span className="font-mono" style={{ color: T.text }}>{u.id.slice(0, 8)}…</span></span>
                    <span>Registered: {new Date(u.createdAt).toLocaleDateString("en-GB")}</span>
                    <span>Last sync: {u.lastSync ? new Date(u.lastSync).toLocaleString() : "Never"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* App info */}
        <Card title="Application">
          <div className="space-y-0" style={{ borderTop: `1px solid ${T.line}` }}>
            <Row label="App name" value="ESSA: Earn · Spend · Save · Achieve" />
            <Row label="Version" value="1.0.0" />
            <Row label="Framework" value="Next.js 14 App Router" />
            <Row label="Financial data" value="AES-256-GCM encrypted · PBKDF2 key derivation · 120,000 iterations" />
            <Row label="User registry" value="Stored in localStorage (essa_users_v1); passwords hashed, not encrypted" />
            <Row label="Storage" value="localStorage (financial data encrypted) + Postgres/Neon (auto-sync)" />
            <Row label="Themes" value="6 themes: Ledger · Midnight · Obsidian · Aurora · Ember · Ivory" />
          </div>
          <div className="rounded-xl px-4 py-3 text-xs leading-relaxed" style={{ background: T.brass + "12", color: T.brass, border: `1px solid ${T.brass}28` }}>
            Sensitive fields on this page are blurred by default. Click <strong>show</strong> to reveal them.
          </div>
        </Card>

      </div>
    </div>
  );
}
