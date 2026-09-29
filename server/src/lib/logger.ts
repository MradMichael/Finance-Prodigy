/**
 * Structured logging — one JSON object per line to stdout/stderr. No
 * external service, no account/API key needed: this is deliberately just a
 * format upgrade over bare console.log/error, since every real host
 * (Railway, Render, etc.) already captures stdout/stderr and most can parse
 * JSON log lines into filterable, queryable fields. A real error-tracking
 * service (Sentry or similar) is a bigger, account-requiring step — this
 * covers "a failed sync doesn't just vanish" without that dependency.
 */

type Level = "info" | "warn" | "error";

/**
 * The fields every line owns. Caller-supplied data must never overwrite one
 * (audit 2.4.163): events.ts once passed { event } and every analytics line
 * lost its `analytics_event` label, so the counts could not be selected on
 * the host. A colliding caller key is KEPT as meta_<key> rather than dropped
 * -- refusing an overwrite should not become a second silent loss.
 */
const OWNED_FIELDS = ["ts", "level", "event"] as const;

function write(level: Level, event: string, meta?: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    safe[(OWNED_FIELDS as readonly string[]).includes(key) ? `meta_${key}` : key] = value;
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...safe,
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

/** Pulls the fields worth logging off an unknown caught value without assuming it's an Error. */
function errorMeta(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name };
  return { message: String(err) };
}

export const logger = {
  info:  (event: string, meta?: Record<string, unknown>) => write("info", event, meta),
  warn:  (event: string, meta?: Record<string, unknown>) => write("warn", event, meta),
  error: (event: string, err?: unknown, meta?: Record<string, unknown>) =>
    write("error", event, { ...(err !== undefined ? errorMeta(err) : {}), ...meta }),
};
