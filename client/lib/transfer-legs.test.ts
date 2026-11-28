// Session 69, step D: the monthly report finds a transfer's legs with transferLegLinks (one pass) instead of
// isTransferLeg per row (one scan of every entry per row). For every TRANSFER row the two must agree.
import { it, expect } from "vitest";
import { isTransferLeg, transferLegLinks, type StoredTransaction } from "./localData";

const t = (id: string, o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id, amount: 10, currency: "USD", bucket: "TRANSFER", description: id, date: "2026-07-03", ...o }) as StoredTransaction;

it("agrees with isTransferLeg on every TRANSFER row", () => {
  const all = [
    t("in", { amount: 50, linkedPaymentId: "k1" }), t("out", { amount: -50, linkedPaymentId: "k1" }), // a transfer's two legs
    t("lone", { amount: 30, linkedPaymentId: "k2" }), // a reimbursement linked back to a spend (not a leg)
    t("spend", { bucket: "WANTS", amount: 30, linkedPaymentId: "k2" }),
    t("usd", { bucket: "NEEDS", amount: 5, linkedPaymentId: "k3" }), t("lbp", { bucket: "NEEDS", amount: 9, linkedPaymentId: "k3" }), // a split payment
    t("plain", { amount: 18 }),
    t("deletedLeg", { amount: 70, linkedPaymentId: "k4" }), t("deletedOther", { amount: -70, linkedPaymentId: "k4", deletedAt: "2026-07-04T00:00:00.000Z" }),
  ];
  const legs = transferLegLinks(all);
  for (const row of all.filter((x) => x.bucket === "TRANSFER")) {
    expect([row.id, !!row.linkedPaymentId && legs.has(row.linkedPaymentId)]).toEqual([row.id, isTransferLeg(row, all)]);
  }
  expect([...legs].sort()).toEqual(["k1", "k4"]);
});
