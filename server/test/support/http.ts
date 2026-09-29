import { createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app";

/** The same hash the server stores: SHA-256 of the token, hex. */
export const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh app per request, so rate limiters never carry over between tests. */
export const api = () => request(createApp());

/**
 * A marker placed inside stored financial data, so any refused response can
 * be checked for leaking it. A status code alone does not prove "no data".
 */
export const SENTINEL = "SENTINEL-FINANCIAL-DATA-7f3a";
export const storedData = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ income: 3150.75, note: SENTINEL, ...extra });
