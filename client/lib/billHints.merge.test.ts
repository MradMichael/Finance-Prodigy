// Session 62 (FIX_PLANS session 61, item 3): "Not a bill" is kept in the data (inside the encrypted copy, not per
// device: per device would hold merchant names in plain text) as `billHintsSetAside`, and merged by the
// fingerprint rule as one record: a side that hasn't changed it since this device's last sync takes the other's
// (so an Undo after a sync holds); when both changed it, or there is no record of the last sync, the union (no
// setting-aside lost). Code that doesn't know the field keeps the server's copy (travel slice 0).
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";
import { mergeFinancials, unknownFieldsOf } from "./syncMerge";
import { seenOf } from "./syncSeen";

const T0 = new Date("2026-11-24T12:00:00.000Z");
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, ...o }) as LocalFinancials;
const merged = (local: LocalFinancials, server: LocalFinancials, last?: LocalFinancials) =>
  mergeFinancials(local, server, T0, last ? seenOf(last) : undefined).data.billHintsSetAside;

describe("billHintsSetAside in a merge", () => {
  const before = base({ billHintsSetAside: ["netflix|USD"] });
  it("set aside here since the last sync, nothing there: kept", () => {
    expect(merged(base({ billHintsSetAside: ["netflix|USD", "gym|USD"] }), before, before)).toEqual(["gym|USD", "netflix|USD"]);
  });
  it("set aside there, nothing here: taken", () => {
    expect(merged(before, base({ billHintsSetAside: ["netflix|USD", "gym|USD"] }), before)).toEqual(["gym|USD", "netflix|USD"]);
  });
  it("an Undo here after the last sync holds (the server still has it)", () => {
    expect(merged(base({ billHintsSetAside: [] }), before, before)).toEqual([]);
  });
  it("both changed since the last sync: the union", () => {
    expect(merged(base({ billHintsSetAside: ["gym|USD"] }), base({ billHintsSetAside: ["netflix|USD", "alfa recharge|USD"] }), before)).toEqual(["alfa recharge|USD", "gym|USD", "netflix|USD"]);
  });
  it("no record of the last sync: the union", () => {
    expect(merged(base({ billHintsSetAside: ["gym|USD"] }), base({ billHintsSetAside: ["netflix|USD"] }))).toEqual(["gym|USD", "netflix|USD"]);
  });
  it("neither copy has the field: none is added", () => {
    expect("billHintsSetAside" in mergeFinancials(base(), base(), T0, seenOf(base())).data).toBe(false);
  });
  it("one copy without the field (older code's), the other with it: kept", () => {
    expect(merged(base(), base({ billHintsSetAside: ["netflix|USD"] }))).toEqual(["netflix|USD"]);
  });
  it("this code knows the field (older code would keep the server's copy as an unknown one)", () => {
    expect(unknownFieldsOf(base({ billHintsSetAside: ["netflix|USD"] }))).toEqual({});
  });
});
