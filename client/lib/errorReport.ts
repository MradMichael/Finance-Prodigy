"use client";

// INF-02 (owner, session 30): nothing told the owner when the app failed on
// someone's device. An error nothing caught (a window `error` or an unhandled
// promise rejection) and an error that reaches an error boundary now send one
// short report to our own server (/api/client-errors, same origin through the
// rewrite; server/src/routes/clientErrors.ts), which writes it to the server's
// log, readable in Render's logs. No third-party service.
//
// What a report holds, and nothing else: the kind of error, its message with
// every number, email address, quoted text and URL removed, where in ESSA's own
// scripts it happened (the script file names carry the build), and the page's path. Nothing from storage, no
// account, no address. At most MAX_PER_LOAD reports per page load, each distinct
// error once. It never throws and never shows anything.

export const REPORT_PATH = "/api/client-errors";
export const MAX_PER_LOAD = 5;
const MAX_MESSAGE = 200;
const MAX_FRAMES = 6;

export interface ClientErrorReport {
  kind: string;
  message: string;
  where: string[];
  page: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"()<>]+/gi;
const CODE_NAME = /^[A-Za-z_$][\w$]{0,40}$/;

/** A message with nothing of the person's in it: URLs to their path, addresses and numbers gone, quoted text gone unless it's a code name. */
export function scrubMessage(message: string): string {
  const s = String(message)
    .replace(URL_RE, (u) => { try { return new URL(u).pathname; } catch { return "<url>"; } })
    .replace(EMAIL, "<email>")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'([^']*)'/g, (_m, inner: string) => (CODE_NAME.test(inner) ? `'${inner}'` : "'…'"))
    .replace(/`[^`]*`/g, "`…`")
    .replace(/\d[\d.,:]*/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s;
}

/** ESSA's own script frames, as file:line:column (no host, no query), at most MAX_FRAMES. */
export function framesOf(stack: string | undefined, origin: string): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const line of stack.split("\n")) {
    const m = line.match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
    if (!m) continue;
    let url: URL;
    try { url = new URL(m[1]); } catch { continue; }
    if (url.origin !== origin || !url.pathname.startsWith("/_next/")) continue; // not ESSA's (an extension, another site)
    out.push(`${url.pathname}:${m[2]}:${m[3]}`);
    if (out.length === MAX_FRAMES) break;
  }
  return out;
}

/** The report for an error, or for whatever a rejected promise carried. */
export function buildReport(error: unknown, page: string, origin: string, rejection = false): ClientErrorReport {
  const e = error instanceof Error ? error : null;
  const kind = e ? (e.name || "Error") : rejection ? "UnhandledRejection" : "Error";
  const message = e ? e.message : typeof error === "string" ? error : "";
  return {
    kind: /^[A-Za-z][\w]{0,39}$/.test(kind) ? kind : "Error",
    message: scrubMessage(message),
    where: framesOf(e?.stack, origin),
    page: page.split(/[?#]/)[0].slice(0, 100) || "/",
  };
}

let sent = 0;
const seen = new Set<string>();

/** Sends one report, best effort; repeats of the same error and anything past the cap are dropped. */
export function reportError(error: unknown, rejection = false): void {
  try {
    if (typeof window === "undefined" || sent >= MAX_PER_LOAD) return;
    const r = buildReport(error, window.location.pathname, window.location.origin, rejection);
    const id = `${r.kind}|${r.message}|${r.where[0] ?? ""}`;
    if (seen.has(id)) return;
    seen.add(id);
    sent += 1;
    const body = JSON.stringify(r);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      && navigator.sendBeacon(REPORT_PATH, new Blob([body], { type: "application/json" }))) return;
    fetch(REPORT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // never let reporting become a second failure
  }
}

let installed = false;

/** The two window handlers, once per page load. */
export function installErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason, true));
}

/** Tests only: a fresh page load. */
export function resetForTests(): void {
  sent = 0; seen.clear(); installed = false;
}
