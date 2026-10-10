// Owner-approved (session 9): the other device's one-sided changes to
// transactions inside a cycle this account has closed (a live close, not
// reopened) are named by the merge that takes them: an edit (draft B,
// approved), an add, a delete (the owner's wording).
import { noticeMoney } from "./noticeMoney";

/** One change the other device made inside a closed cycle, as the notice names it. */
export interface ClosedEdit { kind: "changed" | "added" | "deleted"; description: string; amount: number; currency: "USD" | "LBP"; cycleLabel: string }

const VERB: Record<ClosedEdit["kind"], string> = { changed: "changed", added: "added", deleted: "deleted" };

export const CLOSED_EDIT_SENTENCE = (e: ClosedEdit): string =>
  `Your other device ${VERB[e.kind]} "${e.description}" (${noticeMoney(e.amount, e.currency)}) in ${e.cycleLabel}, a cycle you've closed.`;
