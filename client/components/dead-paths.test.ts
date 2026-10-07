// CODE-02 (blind-spot audit): dead weight in the client bundle.
//
// * The dashboard shipped a fetch of GET /api/dashboard with an ~80-line MOCK
//   payload and a "demo data, API offline" banner as its fallback. The
//   server has no such route, and the app always passes `data`, so the path
//   never ran -- but it would have shown invented figures if it ever woke.
// * EssaBrand shipped four marks (Cartouche, Crest, Facet, Nameplate) that
//   nothing renders.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as Brand from "./EssaBrand";

const client = join(__dirname, "..");
const read = (p: string) => readFileSync(join(client, p), "utf8");
function sources(dir: string): string[] {
  return readdirSync(join(client, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(join(client, p)).isDirectory()) return f === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe("CODE-02: no dead paths", () => {
  it("the client never calls /api/dashboard, which the server doesn't serve", () => {
    expect(read("../server/src/app.ts")).not.toMatch(/dashboard/);
    const dash = read("components/FinancialDashboard.tsx");
    expect(dash).not.toMatch(/\/api\/dashboard/);
    expect(dash).not.toMatch(/\bMOCK\b/);
    expect(dash).not.toMatch(/demo data, API offline/);
  });

  it("every brand mark exported is rendered somewhere in the app", () => {
    const app = [...sources("app"), ...sources("components")].filter((p) => !p.endsWith("EssaBrand.tsx")).map(read).join("\n");
    const unused = Object.keys(Brand).filter((name) => !new RegExp(`<${name}\\b`).test(app));
    expect(unused).toEqual([]);
  });
});
