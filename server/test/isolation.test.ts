// THE CONSTRAINT BEFORE EVERYTHING (audit 2.4.156): these tests must never
// reach the production database. server/.env IS production, and Prisma loads
// it by itself when a client is constructed. Each isolation layer in
// test/support/setup.ts is proven here on its own, so removing one is caught
// even while the others still hold.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { prisma as routesPrisma } from "../src/lib/prisma";
import { prisma as fake } from "./support/fakePrisma";
import { CI_PLACEHOLDER } from "./support/setup";

const SERVER = path.resolve(__dirname, "..");
const VITEST = path.join(SERVER, "node_modules", "vitest", "vitest.mjs");

/** Run ONE harmless test file in a child process with a given environment. */
function childRun(env: Record<string, string | undefined>) {
  const e: Record<string, string | undefined> = { ...process.env, ...env };
  return spawnSync(process.execPath, [VITEST, "run", "test/health.test.ts"], {
    cwd: SERVER, env: e as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000,
  });
}

describe("layer 1 -- no real PrismaClient can exist in the test process", () => {
  it("constructing one throws instead of connecting", () => {
    expect(() => new PrismaClient()).toThrow(/REFUSING: a real PrismaClient/);
  });
  it("the Prisma namespace is still real, because the routes depend on its error classes", () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2025", clientVersion: "t" });
    expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe("layer 2 -- the routes' Prisma client is the in-memory fake", () => {
  it("src/lib/prisma resolves to the fake, not a client", () => {
    expect(routesPrisma).toBe(fake);
  });
});

describe("server/.env is never loaded into the test process", () => {
  it("after importing @prisma/client, the connection variables are still unset or the placeholder", () => {
    // Prisma's .env autoload lives in the client constructor; layer 1 stops
    // the constructor. This asserts the outcome rather than the mechanism.
    for (const k of ["DATABASE_URL", "DIRECT_URL"]) {
      const v = process.env[k];
      expect(v === undefined || v === CI_PLACEHOLDER).toBe(true);
    }
  });
});

describe("layer 3 -- the environment guard refuses any real connection string", () => {
  it("a non-placeholder DATABASE_URL stops the whole run, and the value is not echoed", () => {
    // A clearly fake host -- never the real one. The guard must not print
    // what it refused: in real life that string is a credential.
    const r = childRun({ DATABASE_URL: "postgresql://u:secretpw@guard-test.invalid:5432/db" });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(r.status).not.toBe(0);
    expect(out).toMatch(/REFUSING TO RUN: DATABASE_URL/);
    expect(out).not.toMatch(/secretpw|guard-test\.invalid/);
  }, 90_000);

  it("the same for DIRECT_URL", () => {
    const r = childRun({ DIRECT_URL: "postgresql://u:secretpw@guard-test.invalid:5432/db" });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toMatch(/REFUSING TO RUN: DIRECT_URL/);
  }, 90_000);

  it("the CI placeholder is allowed -- the premise, so the refusals above are the guard and not a broken child run", () => {
    const r = childRun({ DATABASE_URL: CI_PLACEHOLDER, DIRECT_URL: CI_PLACEHOLDER });
    expect(r.status).toBe(0);
  }, 90_000);
});
