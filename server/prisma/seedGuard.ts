/**
 * CODE-03 (2026-10-05): the gate in front of `prisma db seed`.
 *
 * The seed writes a demo account and warehouse rows. It used to write them to
 * whatever DATABASE_URL named -- and server/.env names production, so on this
 * machine `npx prisma db seed` (or `migrate reset`, which runs it) would have
 * written there.
 *
 * Fail closed, per 2.4.123: an ALLOW-list on an explicit marker, never a
 * deny-list of what production looks like. The default is to refuse. To seed,
 * the environment must say ESSA_DB_ROLE=local or ESSA_DB_ROLE=test, AND the
 * database must agree with the claim:
 *   local -- the host is loopback (localhost, 127.0.0.1, [::1]);
 *   test  -- the database's own name says test (essa_test, test_essa, ...).
 * DATABASE_URL must pass, and so must DIRECT_URL when it's set.
 *
 * Reasons never repeat any part of a connection string -- structural facts
 * only, the same rule the rest of the project follows for credentials.
 */
export type SeedVerdict = { ok: true; role: "local" | "test" } | { ok: false; reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const TEST_NAME = /(^|[_-])test($|[_-])/i;

function urlFits(name: string, value: string | undefined, role: "local" | "test"): string | null {
  if (!value) return `${name} is not set.`;
  let url: URL;
  try { url = new URL(value); } catch { return `${name} is not a parseable connection string.`; }
  if (role === "local" && !LOOPBACK.has(url.hostname)) {
    return `ESSA_DB_ROLE=local, but ${name}'s host is not a loopback address.`;
  }
  if (role === "test" && !TEST_NAME.test(decodeURIComponent(url.pathname.replace(/^\//, "")))) {
    return `ESSA_DB_ROLE=test, but ${name}'s database name does not mark it as a test database (e.g. essa_test).`;
  }
  return null;
}

export function checkSeedTarget(env: Record<string, string | undefined>): SeedVerdict {
  const role = env.ESSA_DB_ROLE;
  if (role !== "local" && role !== "test") {
    return { ok: false, reason: "the database is not marked as local or test. Set ESSA_DB_ROLE=local (loopback host) or ESSA_DB_ROLE=test (a database named like essa_test) to seed it." };
  }
  const problem = urlFits("DATABASE_URL", env.DATABASE_URL, role)
    ?? (env.DIRECT_URL !== undefined ? urlFits("DIRECT_URL", env.DIRECT_URL, role) : null);
  return problem ? { ok: false, reason: problem } : { ok: true, role };
}
