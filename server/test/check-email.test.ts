// PRIORITY 5 -- CHECK-EMAIL. No page promise names this route. It is load-
// bearing: the next-open backup prompt (opt-in part 3) offers "delete the
// copy on the server" on the strength of it, and sign-up warns on it. So the
// response must say exactly whether a copy exists -- and nothing else.
//
// 2.4.165 B: the address travels in the body of a POST. The old GET form,
// with the address in the URL, is gone (step 3); the last describe pins that.
import { describe, it, expect } from "vitest";
import { store } from "./support/fakePrisma";
import { api, hash, storedData, SENTINEL } from "./support/http";

const check = (email: string) => api().post("/api/auth/check-email").send({ email });

describe("check-email says whether a copy exists, and nothing more", () => {
  it("a copy exists: { exists: true } -- no row fields, no data", async () => {
    store.seedUserSync({ email: "has-copy@example.com", authTokenHash: hash("t"), dataJson: storedData() });
    const res = await check("has-copy@example.com");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: true });
    expect(res.text).not.toContain(SENTINEL);
    expect(res.text).not.toContain(hash("t"));
  });

  it("no copy: { exists: false }", async () => {
    const res = await check("no-copy@example.com");
    expect(res.body).toEqual({ exists: false });
  });

  it("the address is normalised the way the rest of sync normalises it", async () => {
    // emailSchema trims and lower-cases; a mixed-case query must find the
    // row, or the prompt would withhold "delete" from someone with a copy.
    store.seedUserSync({ email: "mixed-case@example.com", authTokenHash: hash("t") });
    const res = await check("  Mixed-Case@Example.com ");
    expect(res.body).toEqual({ exists: true });
  });

  it("checking never writes", async () => {
    // Premise: the request reached the route (a missing one writes nothing too).
    expect((await check("anyone@example.com")).body).toEqual({ exists: false });
    expect(store.writes).toEqual([]);
  });
});

describe("the address is read only from the body", () => {
  it("an address in a POST's URL alone is refused (422), not answered", async () => {
    store.seedUserSync({ email: "has-copy@example.com", authTokenHash: hash("t") });
    const res = await api().post("/api/auth/check-email?email=has-copy%40example.com").send({});
    expect(res.status).toBe(422);
    expect(res.body).not.toHaveProperty("exists");
  });

  it("the old GET form is gone: 404, and no answer", async () => {
    store.seedUserSync({ email: "has-copy@example.com", authTokenHash: hash("t") });
    const res = await api().get("/api/auth/check-email").query({ email: "has-copy@example.com" });
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty("exists");
  });
});
