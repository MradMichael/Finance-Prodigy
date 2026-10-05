// CODE-03 (2026-10-05): the Prisma seed wrote a demo account and warehouse
// rows to whatever DATABASE_URL named, with no check -- and server/.env names
// production. It now refuses unless the database is EXPLICITLY marked local or
// test. Fail closed, per 2.4.123: an allow-list on an explicit marker, so it
// never needs to recognise production and can't be fooled by a new host.
//
// The guard is a pure function of the environment, so nothing here connects
// to anything (and setup.ts's layer 1 would stop a client if anything tried).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkSeedTarget } from "../prisma/seedGuard";

// Shapes only. Neither host exists; no real credential appears anywhere here.
const PROD_SHAPED = "postgresql://owner:s3cretpass@ep-quiet-forest-123456-pooler.eu-central-1.aws.example.net/neondb?sslmode=require";
const LOCAL = "postgresql://essa:pw@localhost:5432/essa_dev";

const env = (over: Record<string, string | undefined>) => ({ DATABASE_URL: LOCAL, ...over });

describe("the seed refuses any database not explicitly marked local or test", () => {
  it("refuses with no marker -- even a local database, because the default is no", () => {
    expect(checkSeedTarget(env({})).ok).toBe(false);
    expect(checkSeedTarget({ DATABASE_URL: PROD_SHAPED }).ok).toBe(false);
  });

  it("accepts only the exact markers local and test", () => {
    for (const role of ["production", "staging", "prod", "LOCAL", " local", "local ", "true", "1", "yes", ""]) {
      expect(checkSeedTarget(env({ ESSA_DB_ROLE: role })).ok, JSON.stringify(role)).toBe(false);
    }
  });

  it("local: only a loopback host", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(checkSeedTarget({ ESSA_DB_ROLE: "local", DATABASE_URL: `postgresql://u:p@${host}:5432/essa_dev` }).ok, host).toBe(true);
    }
    for (const url of [PROD_SHAPED, "postgresql://u:p@localhost.example.net:5432/essa_dev", "postgresql://u:p@10.0.0.5:5432/essa_dev"]) {
      expect(checkSeedTarget({ ESSA_DB_ROLE: "local", DATABASE_URL: url }).ok, url).toBe(false);
    }
  });

  it("test: only a database whose own name says test", () => {
    for (const db of ["essa_test", "test_essa", "essa-test-ci", "test"]) {
      expect(checkSeedTarget({ ESSA_DB_ROLE: "test", DATABASE_URL: `postgresql://u:p@db.example.net:5432/${db}` }).ok, db).toBe(true);
    }
    for (const db of ["neondb", "essa", "contest", "testdb", "latest"]) {
      expect(checkSeedTarget({ ESSA_DB_ROLE: "test", DATABASE_URL: `postgresql://u:p@db.example.net:5432/${db}` }).ok, db).toBe(false);
    }
  });

  it("DIRECT_URL, when set, has to pass the same test as DATABASE_URL", () => {
    expect(checkSeedTarget({ ESSA_DB_ROLE: "local", DATABASE_URL: LOCAL, DIRECT_URL: PROD_SHAPED }).ok).toBe(false);
    expect(checkSeedTarget({ ESSA_DB_ROLE: "local", DATABASE_URL: LOCAL, DIRECT_URL: "postgresql://u:p@127.0.0.1:5432/essa_dev" }).ok).toBe(true);
  });

  it("refuses a missing or unparseable DATABASE_URL", () => {
    expect(checkSeedTarget({ ESSA_DB_ROLE: "local" }).ok).toBe(false);
    expect(checkSeedTarget({ ESSA_DB_ROLE: "local", DATABASE_URL: "not a url" }).ok).toBe(false);
  });

  it("never repeats any part of a connection string in its reason", () => {
    const cases = [
      {}, { ESSA_DB_ROLE: "production" }, { ESSA_DB_ROLE: "local" }, { ESSA_DB_ROLE: "test" },
    ].map((o) => checkSeedTarget({ DATABASE_URL: PROD_SHAPED, ...o }));
    for (const v of cases) {
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      for (const part of ["owner", "s3cretpass", "ep-quiet-forest", "example.net", "neondb", "sslmode"]) {
        expect(v.reason, part).not.toContain(part);
      }
    }
  });
});

describe("seed.ts checks before anything can reach a database", () => {
  const src = readFileSync(resolve(__dirname, "../prisma/seed.ts"), "utf8");

  it("runs the guard, and exits on refusal, before any PrismaClient exists", () => {
    const guardAt = src.indexOf("checkSeedTarget(process.env)");
    const exitAt = src.indexOf("process.exit(1)", guardAt);
    const clientAt = src.indexOf("new PrismaClient(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(guardAt);
    expect(exitAt).toBeGreaterThan(guardAt);
    expect(exitAt).toBeLessThan(clientAt);
    expect(src.match(/new PrismaClient\(/g)).toHaveLength(1);
  });
});
