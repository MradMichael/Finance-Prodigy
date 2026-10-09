// DRAFT, held for the owner's approval (session 8, item 7). Not approved
// wording; the branch that uses it is held until it is.
//
// Owner: one-sided edits inside closed periods are named. When the other
// device changed a transaction dated inside a cycle this account has closed
// (a live close, not reopened), the merge that takes the change says so.

/** One edit the other device made inside a closed cycle, as the notice names it. */
export interface ClosedEdit { description: string; amount: number; currency: "USD" | "LBP"; cycleLabel: string }

const money = (amount: number, currency: "USD" | "LBP") =>
  currency === "LBP" ? `L£${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** DRAFT sentence. */
export const CLOSED_EDIT_SENTENCE = (e: ClosedEdit): string =>
  `Your other device changed "${e.description}" (${money(e.amount, e.currency)}) in ${e.cycleLabel}, a cycle you've closed.`;
