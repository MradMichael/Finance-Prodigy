// The zero-behaviour refactor (index.ts -> app.ts createApp) still serves.
// Also the harmless file isolation.test.ts runs in a child process.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("createApp", () => {
  it("serves /api/health without listening on a port", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "essa-api" });
  });
});
