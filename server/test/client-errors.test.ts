// INF-02 (owner, session 30): error reports from the app reach our own
// server's log (Render's logs), and nothing else: no number, no email
// address, no quoted text, no IP, no user agent. Its own small parser and
// limiter; strict shape.
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { api } from "./support/http";

const REPORT = { kind: "TypeError", message: "Cannot read properties of undefined (reading 'amount')", where: ["/_next/static/chunks/app/page-abc123.js:12:345"], page: "/" };

async function logged(send: () => PromiseLike<unknown>): Promise<{ raw: string; lines: Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const sink = ((c: unknown) => { chunks.push(String(c)); return true; }) as never;
  vi.spyOn(process.stdout, "write").mockImplementation(sink);
  vi.spyOn(process.stderr, "write").mockImplementation(sink);
  try { await send(); } finally { vi.restoreAllMocks(); }
  const raw = chunks.join("");
  return { raw, lines: raw.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) };
}

describe("INF-02: client error reports", () => {
  it("a report is logged as client_error with exactly its four fields, and answered 204", async () => {
    let status = 0;
    const { lines } = await logged(async () => { status = (await api().post("/api/client-errors").set("User-Agent", "UA/1").set("X-Forwarded-For", "203.0.113.5").send(REPORT)).status; });
    expect(status).toBe(204);
    const mine = lines.filter((l) => l.event === "client_error");
    expect(mine).toHaveLength(1);
    const { event: _e, level: _l, ts: _ts, ...fields } = mine[0] as Record<string, unknown>;
    expect(fields).toEqual({ kind: "TypeError", message: REPORT.message, where: REPORT.where, page: "/" });
  });

  it("nothing identifying reaches the log: no IP, no user agent", async () => {
    const { raw } = await logged(async () => { await api().post("/api/client-errors").set("User-Agent", "Distinctive-UA/9").set("X-Forwarded-For", "203.0.113.77").send(REPORT); });
    expect(raw).toContain("client_error"); // premise
    expect(raw).not.toContain("203.0.113.77");
    expect(raw).not.toContain("Distinctive-UA");
  });

  it("the server scrubs the message again: numbers, addresses and quoted text from an older or altered client", async () => {
    const { lines } = await logged(async () => {
      await api().post("/api/client-errors").send({ ...REPORT, message: `Pharmacy 650000 for someone@example.com "Spinneys" 'Groceries at Spinneys'` });
    });
    const m = String(lines.find((l) => l.event === "client_error")?.message);
    expect(m).toBe(`Pharmacy # for <email> "…" '…'`);
  });

  it.each([
    ["an extra field", { ...REPORT, email: "x@example.com" }],
    ["a frame from another site", { ...REPORT, where: ["https://evil.example/x.js:1:2"] }],
    ["a page with a query", { ...REPORT, page: "/profile?x=1" }],
    ["a kind that isn't a name", { ...REPORT, kind: "Type Error; drop" }],
    ["seven frames", { ...REPORT, where: Array.from({ length: 7 }, () => REPORT.where[0]) }],
  ])("refuses %s, and logs nothing", async (_name, body) => {
    let status = 0;
    const { lines } = await logged(async () => { status = (await api().post("/api/client-errors").send(body)).status; });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(lines.filter((l) => l.event === "client_error")).toHaveLength(0);
  });

  it("refuses a body over 8 KB", async () => {
    const res = await api().post("/api/client-errors").send({ ...REPORT, message: "x".repeat(9000) });
    expect(res.status).toBe(413);
  });

  // Session 31: the privacy page says "ESSA doesn't record your IP address with it." Whatever the
  // server writes while handling reports (a valid one, a malformed one, an oversize one, a flood),
  // no line carries the sender's address, as given or as Express resolves it.
  it("no line ESSA writes while handling reports carries an IP address", async () => {
    const app = createApp();
    const ADDR = ["203.0.113.41", "203.0.113.42", "203.0.113.43", "203.0.113.44"];
    const { raw } = await logged(async () => {
      await request(app).post("/api/client-errors").set("X-Forwarded-For", ADDR[0]).send(REPORT);
      await request(app).post("/api/client-errors").set("X-Forwarded-For", ADDR[1]).send({ ...REPORT, extra: 1 });
      await request(app).post("/api/client-errors").set("X-Forwarded-For", ADDR[2]).send({ ...REPORT, message: "x".repeat(9000) });
      for (let i = 0; i < 22; i++) await request(app).post("/api/client-errors").set("X-Forwarded-For", ADDR[3]).send(REPORT);
    });
    expect(raw).toContain("client_error"); // premise: lines were written
    for (const a of ADDR) expect(raw).not.toContain(a);
    expect(raw).not.toMatch(/127\.0\.0\.1|::ffff:|"ip"|remoteAddress/);
  });

  it("a flood from one client is refused after 20 in 15 minutes, with the existing sentence", async () => {
    const app = createApp();
    for (let i = 0; i < 20; i++) expect((await request(app).post("/api/client-errors").set("X-Forwarded-For", "203.0.113.5").send(REPORT)).status).toBe(204);
    const res = await request(app).post("/api/client-errors").set("X-Forwarded-For", "203.0.113.5").send(REPORT);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Too many requests. Please wait a few minutes and try again.");
  });
});
