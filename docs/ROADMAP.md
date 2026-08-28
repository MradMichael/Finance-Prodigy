# ESSA — Development Roadmap

**Repository:** `MradMichael/Finance-Prodigy`
**Companion documents:** `docs/CLAUDE_CODE_BRIEF.md` (standards), `docs/AUDIT_2026-08.md` (findings), `docs/STAGING_ENVIRONMENT_RUNBOOK.md` (deferred infrastructure)
**Version:** 1.0 — August 2026

---

## 0. How to use this document

Place at `docs/ROADMAP.md`. Reference it at the start of a session alongside `CLAUDE_CODE_BRIEF.md`, which remains the authority on standards, definition of done, and standing rules.

### The governing constraint

**The owner's available time is unpredictable.** It depends on an active GCC job search that takes priority. A phase may start and then receive no attention for three weeks.

Every phase in this document is therefore designed to be **independently shippable**. At no point should `main` be left in a state where a feature is half-migrated, a data format is partially converted, or the app is coherent only if the next phase lands soon. If a phase cannot be completed in one working block, it must be broken into sub-phases that each satisfy this property before work begins.

The marker **SAFE STOP** appears at every point where work can halt indefinitely with the app in a consistent, shippable state.

### Standing rules (carried from the brief)

1. Present a plan and wait for approval before writing code.
2. Report before fixing. One concern per commit.
3. No unrequested refactoring.
4. Money math gets unit tests before modification.
5. Never invent a status — UNKNOWN with a reason is a valid answer.
6. Never mark a phase complete without the owner's confirmation.

### Rules specific to this roadmap

7. **Do not start a phase before its dependencies are marked complete.** Dependencies are stated explicitly and are not advisory.
8. **After the cohort launches, this ordering is provisional.** Real user behaviour outranks this document. If cohort feedback contradicts the sequence below, say so and propose a revision rather than following it.
9. **No feature work while a Launch Blocker is open.**

---

## Phase 0 — Loose ends

**Status:** ✅ **complete — 2026-08-18** · **Blocks:** cohort launch · **Stop-safe:** yes, after each item

Small, contained, no design decisions. Each is one commit on its own branch.

| # | Item | Source | Notes |
|---|---|---|---|
| 0.1 | Apply `roundMoney` to the two missed goal-contribution sites in `InputPanel.tsx` and `GoalsScreen.tsx` | Audit — money-precision pass | ✅ Done — `1315aec` |
| 0.2 | `/recover` copy: resetting a password does not sign you out on other devices | Approved earlier, verify whether it shipped | ✅ Done — had NOT actually shipped despite the earlier approval (verified by reading the deployed page before assuming); added `388b684` |
| 0.3 | Same notice wherever a password reset completes | Follows 0.2 | ✅ Done, same commit — form itself + the success-state modal via a new optional `note` prop, scoped so sign-up/first-migration-sign-in are unaffected |

**Acceptance:** `tsc` clean (245/245 tests), both builds clean. Merged to `main` in one push (`7898747`) and deployed — Vercel build `Ready`, all production aliases repointed, confirmed via `vercel inspect`.

**SAFE STOP — confirmed.** `main` is in a consistent, shippable state. Phase 1 may begin.

---

## Phase 1 — F1 Dual-currency (USD / LBP)

**Status:** ✅ COMPLETE — 2026-08-21. All five sub-phases (1.1-1.5) built, merged to `main`, and owner-verified live against the deployed build (Rule 6) · **Blocked:** cohort launch, now unblocked · **Depends on:** Phase 0
**This was the last Launch Blocker. It is complete.**

### Why this is pre-cohort

Every monetary record currently stores a bare number with no currency. Lebanese users earn, spend and save across two currencies with a volatile relationship; a single-currency model misrepresents their actual financial position.

The decisive argument for doing it now rather than later is migration scope. Today the production database holds **one real row** — the owner's. After the cohort, it holds ten or more, each encrypted client-side, each requiring a decrypt-transform-re-encrypt pass on a device the owner does not control, for data the user cannot manually verify if it silently goes wrong. Migrating one row is a contained task. Migrating ten strangers' financial records is a different category of risk.

### Design requirements

- Every monetary record stores: **amount**, **currency code**, and **the exchange rate applied at the time of the transaction**.
- A single configurable reference rate, defaulting to **89,500 LBP per USD**, stored as data — never in code.
- Historical records retain the rate at which they were entered. Changing the reference rate must not retroactively alter past reports.
- Every displayed total states its currency. No unlabelled amounts anywhere.
- A user can enter in either currency and view any report in either.
- Grep for and eliminate any hardcoded `1500` or `15000` rate. The audit found three matches, all confirmed false positives — re-verify after this change.

### Migration requirements — read carefully

Stored data is encrypted client-side. A schema change is not a server-side operation.

- Add a **schema version marker** to the stored blob before any transform. Without it, a partially-migrated record is indistinguishable from an unmigrated one.
- The migration runs **on load, lazily, per device** — the same pattern as the recovery fix. No batch server-side transform.
- **Starting in 1.2, a load that migrates must also write the migrated result back to storage immediately, not defer to the next natural save.** 1.1's harness deliberately does not do this — with an empty migration table there's nothing yet for it to protect — but once 1.2 adds a real transform, load-migrate-without-persisting means what's on disk and what's on screen have silently diverged the instant migration runs: a crash, a closed tab, or a pull from another device before the next edit would read the stale, unmigrated bytes again, or push them to the server. This is a required part of 1.2's acceptance, not an optional follow-up.
- The migration must be **idempotent**. A device that syncs, migrates, and syncs again must not double-convert.
- **Untouched records default to USD.** Every existing amount is USD today; the transform is additive, not interpretive.
- Write a test that runs the migration twice over the same fixture and asserts identical output.
- Verify against a real export of the owner's own data — 42 transactions, 4 goals, 2 debts — before any deploy.

### Sub-phases — each independently shippable

| # | Sub-phase | Stop-safe after? |
|---|---|---|
| 1.1 | Schema version marker + lazy migration harness, no currency logic yet. **✅ COMPLETE — 2026-08-19.** Built and merged to `main`; the separate migration-chain-gap defect found while planning 1.2 closed on its own branch and merged (`5903f2d`). Owner's live-verification check against the deployed build, signed into the real account, confirmed per Rule 6: 42 transactions, 4 goals, 2 debts, debt payoff figures unchanged. | Yes — no behaviour change |
| 1.2 | Data model: currency code and rate on every monetary record, defaulting to USD. **✅ COMPLETE — 2026-08-20.** Built and merged (`8f4f408`); write-back-on-migration added to the 1.1 harness as required. Verified against the owner's real 42-transaction export (both as its own schemaVersion and forced to v0, to exercise the double-hop) — byte-identical dashboard totals before/after. Owner's live-verification check per Rule 6: write-back confirmed in a real browser against the deployed build (disposable account, real reload, decrypted straight from localStorage — `schemaVersion: 2`, `goals[0].currency: "USD"`, LBP transaction's `lbpRateAtEntry` correctly populated), plus the owner's own visible check against the deployed build, passed. | Yes — app behaves identically, model is richer |
| 1.3 | Reference rate as configurable stored data, with history. **✅ COMPLETE — 2026-08-20.** Landed via `72e7cc7` (single `DEFAULT_LBP_RATE` constant, no more duplicated `89500` literal). Owner confirmed (2026-08-20): the commit was authorized, and the rest of 1.3's requirements — configurable stored rate, historical records retaining the rate in effect at entry — were already built as groundwork during 1.2; deduplicating the literal was the only gap 1.3 still had to close. | Yes — no behaviour change |
| 1.4 | Entry in either currency. **✅ COMPLETE — 2026-08-21.** Built and merged (`40c24ab`, merge commit `7fd5266`). Currency picker on goal/debt creation, locked at creation; both critical currency-treatment bugs found in plan review fixed and tested (contribution-transaction currency, requiredMonthly/paceRatio split); every cross-record aggregation converted to USD at point of use; CurrencyScreen's exposure figure and copy corrected to include goals. `tsc` clean, 277/277 tests pass, both builds clean. Owner's live-verification check per Rule 6, against the deployed build: created an LBP goal, contributed to it — the contribution amount was correct, the card displayed `L£`, the quick-add suggestion was LBP-scale (not silently converted), and CurrencyScreen's exposure figure counted it. Passed. | Yes |
| 1.5 | Display and reporting in either currency, every total labelled. **✅ COMPLETE — 2026-08-21.** Built and merged (`f80fa48`, merge commit `fc2b12e`). A full sweep found exactly 5 gaps, all in the two files 1.4 deliberately left untouched (`printReport.ts`, `FinancialDashboard.tsx`); both now use `fmtCur`/USD-converted display consistently with every other screen. `tsc` clean, 279/279 tests pass, both builds clean. Owner's live-verification check per Rule 6, against the deployed build: Overview shows `L£` correctly; both PDF reports show converted `$` with no LBP leaking through; a large reconciliation check (L£10,000,000,000 = $111,732) matched exactly. Passed. **Incidental finding from the same check (2.4.23): the goal card's "Left" figure truncated at large LBP magnitudes — a display/CSS issue, not an arithmetic one. Fixed and deployed the same day (`1255ecd`), Target/Left now stack vertically, live-verified at 375px width.** | Yes — feature complete |

**Do not begin 1.2 before 1.1 is merged and verified against real data.**

**Acceptance:** owner's own 42 transactions survive migration byte-identical in value; double-migration test passes; no unlabelled amount anywhere in the UI; no hardcoded rate.

**SAFE STOP after each sub-phase.**

---

## Phase 2.5 — Recurring items: confirm-on-due, not live-estimated

**Status:** 🟡 built and merged, NOT complete — pending owner's live check (updated 2026-08-24) · **Depends on:** Phase 1 · **Blocks:** Phase 2 (cohort launch), Phase 3

**Progress so far, not a completion claim (Rule 6 — only the owner marks a phase complete):** 2.5.1 (schema v2→v3, `confirmCutoverDate`/`recurringId` fields), 2.5.2 (pure cycle logic — `dueCycles`/`isCycleConfirmed`/`isCycleOverdue`/`buildRecurringConfirmLog`), and 2.5.3 ("the flip" — every consumer switched from the live `monthlyEquivalent()` estimate to confirm-on-due, OVERDUE UI, confirm action on Overview + InputPanel, one-time migration notice) are all built, tested first, merged to `main`, pushed, Vercel `Ready`. Two related live bugs found and fixed along the way, both merged: `nextOccurrence` checking its `endDate`/`totalAmount` bounds at the wrong point (2.4.24), and `recurringPaidSoFar`'s totalAmount cap being calendar-elapsed-time based instead of confirmed-payment based (2.4.25) — full detail in `docs/AUDIT_2026-08.md`. **Owner is doing the live check on the deployed build directly (own data, own account) — this phase is not marked complete until that comes back.** 2.5.4 (cleanup: retire `monthlyEquivalent`/`lastPaidCycle`, resolve `normalizeSync.ts`, close 2.4.21/2.5.26 as obsolete) not started.

**Decided 2026-08-22, moved ahead of the cohort — reordered from the original "first thing after launch" decision, same day.** Not a display fix — a model change. Read-only investigation completed (not written up as a separate doc; findings summarized below since this is the durable planning record for the work).

**Why moved before launch, reversing the original call:** owner's explicit reason — the ledger should reconcile before anyone else uses it. The original post-launch placement was reasoned from the app's own perspective (this class of bug is already fixed, waiting costs nothing *technically*); moving it earlier is reasoned from trust — a cohort's very first experience of the app's numbers should be under the model that's actually going to stay, not one already known to drift from reality via an unstored live estimate. Everything below (the model itself, the rationale bullets on scope/sizing, and the three implementation decisions) is unchanged from the original entry — only the position in the sequence and its dependency on Phase 2 changed.

### The model change

Today, a recurring item's cost is estimated live on every render (`monthlyEquivalent()` in `client/lib/localData.ts`) and folded into spend totals, budget pace, the health score, and trend charts — whether or not a real transaction was ever logged for it. The only way it becomes a real `StoredTransaction` is the optional "Log payment" action.

The new model: a recurring item's due date prompts the user to confirm payment. On confirmation, it becomes a real `StoredTransaction` in the ledger — the only path in. Unconfirmed past its due date, it shows OVERDUE until resolved. No live estimate deducting from balances with no row behind it, ever.

### Scope and sizing (why this isn't a quick fix, regardless of timing)

- **Phase 1.4-sized.** A full sweep found `monthlyEquivalent()` feeding spend totals across 8 files (`computeDashboard.ts` — needs/wants/savings spend, health score, budget pace, rollover, trend chart, savings streak, alerts — plus `InputPanel.tsx`, `CategoriesScreen.tsx`, `CurrencyScreen.tsx`, `StatisticsScreen.tsx`, `TransactionsScreen.tsx`). Removing it is mechanical in most of those; the historical-months question below is not.
- **The owner's time is unpredictable** (the governing constraint stated at the top of this document) — a change this size still deserves a full, uninterrupted design pass; moving it earlier doesn't shrink the work, it just changes what's waiting on it.
- **The confirm/overdue UX is something real usage will keep refining.** How pushy an OVERDUE state should be, how many days of grace, what it looks like on a phone — pre-launch design gets this to a reasonable first version; **Rule 8** (below) still applies once the cohort is live and using it for real.
- **2.4.21 (the cross-month double-count bug this model obsoletes) is already fixed.** Its trigger required clicking "Log payment," a button no brand-new user presses in week one regardless of whether this ships before or after them — this was never itself an argument for either ordering, just a reason the *old* placement carried little near-term risk. The reconciliation argument for building it first stands on its own.

### Design decisions made ahead of implementation (recorded now, not re-litigated later)

- **Historical months never confirmed: backfill, not retroactive-overdue or retroactive-empty.** Checked what the app actually remembers today: `StoredRecurring.lastPaidCycle` is a single most-recent-cycle pointer, not a ledger — there is no historical confirmation record to preserve. Marking every pre-existing recurring item's past cycles OVERDUE would flood every existing user with meaningless noise (nobody's confirming last year's rent). Silently zeroing them rewrites historical spend/rollover/trend/streak data, against the precedent this project already committed to with `incomeHistory`/`lbpRateHistory`/`budgetRuleHistory` (past months judged against what was true then). **Backfill** — grandfather everything before the migration cutover as implicitly settled, enforce confirm-or-overdue only for cycles due after it — is the only option consistent with that precedent, and matches every other Phase 1 migration's own shape (schema version marker, migrate once, never reinterpret old data).
- **2.4.21 and 2.5.26 become obsolete-by-architecture when this ships, not carried forward as open fixes.** 2.4.21 (cross-month double-count) existed because a live estimate and an optional confirmed transaction had to stay reconciled via date-matching — this model removes the live estimate, so there's nothing left to reconcile. 2.5.26 (recurring spend excluded from Transactions' "All time" totals) was a question about summing a live, unstored estimate across all time — a confirmed recurring payment is a real transaction under this model and shows up in All-time totals the same as any other, no special-casing needed. Both findings should be closed as superseded, not re-verified against the new code.
- **`server/src/lib/normalizeSync.ts` gets fixed or explicitly abandoned as part of this, not left as-is.** Confirmed directly: this file (the currently-unused analytics warehouse, not the live app) has its own third, independent recurring-spend calculation — raw `rec.amount`, no pro-ration, referencing a `frequency`/`dayOfMonth` shape that doesn't match `StoredRecurring`'s real one. Doesn't affect anything live today, but a third parallel implementation of "what does recurring cost" is the same duplicate-logic risk already flagged in 2.4.22 — decide its fate deliberately when this is designed, don't just let it keep drifting.

**Requirements** (high-level; not designed yet)
- A recurring item's due date surfaces a confirm-payment prompt; confirming creates a real `StoredTransaction`.
- Unconfirmed past due: an OVERDUE state, visible somewhere a user will actually see it (Overview alerts at minimum).
- No code path computes a live, unstored monthly estimate into spend/budget/health/trend totals.
- Migration: pre-cutover recurring history backfilled as settled; schema version bump per the established harness pattern (see Phase 1.1).
- `normalizeSync.ts`'s recurring fact-table logic fixed to match the confirm-on-due model, or explicitly removed — not left silently stale.

**Acceptance:** a recurring item due today prompts for confirmation and only affects totals once confirmed; left unconfirmed, it reads OVERDUE, not silently deducted; an account with recurring history from before the migration shows no false OVERDUE backlog; 2.4.21/2.5.26 closed as obsolete in the audit doc.

**SAFE STOP.**

---

## Phase 2.6 — Emergency fund and debt balances become ledger-derived

**Status:** built and merged, NOT complete — pending owner's live check (updated 2026-08-28, same "Rule 6" gate as Phase 2.5) · **Depends on:** Phase 2.5 · **Blocks:** Phase 2 (cohort launch). **2.6.1/2.6.2 (data model, migration, derived-balance pure logic) merged, live. 2.6.3(a)/(b)/(c) (the flip, soft delete, edit-transaction UI) all merged together 2026-08-26 (`4a77742`), Vercel confirmed. 2.6.4 (shared `PaymentMethodPicker`, debt/goal payment-form gaps, `debtAdjustment`) all three steps merged 2026-08-27 (`22d2b1f`), Vercel confirmed. Phase 2.6 in full is now code-complete; not marked done until the owner's own live check confirms it on the real account (2.4.27 — the finding that started this phase — stays open until then).**
>
> **Deployment note, decided 2026-08-26:** flipping every *reader* to derived in (a), while the writers that still mutate the raw fields directly (`InputPanel.tsx`'s EF add/subtract checkboxes, `recordDebtPayment`, `SetupScreen.tsx`'s EF field) don't yet create linked transactions, makes those writers silently invisible once (a) alone is live — a user checks "add to EF" or records a debt payment and no number they can see moves. Owner's call: hold (a), (b), and (c) off production (reviewed separately, as three commits, but not merged to `main` individually) until all three are ready, then deploy together so no live account ever sits in the gap.
>
> **2.6.3(b) — soft delete, built 2026-08-26.** `StoredTransaction.deletedAt` (added in 2.6.1) is now live: "Delete transaction" in `InputPanel.tsx` stamps it instead of removing the row, with a brief inline confirmation ("Deleted — recoverable in Transactions," no expiry stated since retention is undecided). New `activeTransactions(transactions)` helper in `localData.ts` excludes soft-deleted rows; every normal read across the app (`computeDashboard.ts`'s totals/trend/rollover/streaks via one central filter at its own normalization step, plus each screen that reads `financials.transactions` directly — InputPanel, Categories, Currency, Goals, Journey, Statistics, `printReport.ts`, `ImportStatement.tsx`'s import-dedup check) now excludes deleted rows. `isCycleConfirmed`/`recurringPaidSoFar` filter internally, so a deleted recurring-confirm transaction correctly un-confirms its cycle with no special-case code anywhere that calls them. Recovery lives in `TransactionsScreen.tsx`: an always-visible "🗑 Recently deleted" pill (shows a count badge once non-zero, never hidden at zero) next to the existing search/filter row, toggling into a list of soft-deleted transactions each with a Restore button. Placement and copy were presented and approved before building, per the owner's explicit requirement that recovery be discoverable by someone who doesn't already know it exists. Live-verified end-to-end via a real browser session (Playwright against the local dev server + API): add → delete → toast → vanishes from Transactions and every total → appears in Recently Deleted with the right count → Restore → reappears everywhere. 393/393 suite, tsc clean, both builds clean, verified numerically invisible against the owner's real export (0 of 55 real transactions have `deletedAt` set, so the filter is a no-op today).
>
> **2.6.3(c) — the remaining writers, built 2026-08-26.** `StoredTransaction.updatedAt` added (stamped on every write: create, edit, confirm, restore, soft-delete, import) — folded into this sub-phase's own data-model touch rather than deferred to Phase 2.7, since it's what makes that phase's edit-vs-edit merge resolution possible at all. `efAmount` widened to `number | null`, mirroring `cycleDate`'s undefined-vs-null distinction (owner's instruction): undefined = never linked, explicit null = deliberately detached, since 0 is a legitimate contribution someone might mean. `debtId` gets no equivalent sentinel (owner's confirmation: it has no fallback behavior to disambiguate, so a null carrying no information isn't added). InputPanel's EF checkboxes now reveal an editable amount field (blank = full transaction amount, typed = a partial one) and set `efAmount` on the created transaction instead of mutating `emergencyFundBalance` — what makes "$300 of this $325 payment came from EF" (2.4.27's exact case) enterable, not just theoretically representable. `recordDebtPayment` creates a real `debtId`-linked transaction via new `buildDebtPaymentTx`, with a bucket picker the owner required rather than a silent default (a minimum payment is a Need, a voluntary overpayment closer to Savings). `SetupScreen.tsx`'s EF field is reframed as "your real current balance": saving computes the delta against the live derived balance and creates one correction transaction via new `buildEfAdjustmentTx` (`amount: 0` deliberately, so a correction never moves a spend total, only `efAmount` does) — `emergencyFundOpeningBalance` is now write-once forever after its initial snapshot, same as `debt.openingBalance`. The edit-transaction form (`InputPanel.tsx`, both list sections) gains an Emergency Fund amount field and a Linked Debt dropdown, each with its own Detach/unlink action, mirroring the existing `cycleDate` Detach pattern. **Known gap, not built, flagged rather than silently skipped**: Edit Debt's Balance field is still read-only with no correction mechanism — `buildEfAdjustmentTx`'s "amount: 0, only efAmount carries the real value" trick doesn't transfer to debts, since `derivedDebtBalance` has only one field (`amount`) doing double duty as both "the linked value" and "what counts toward spend," so a debt-only equivalent would need either accepting a phantom spend-total entry or a new schema mechanism — deferred, not decided. Tests-first throughout (`buildDebtPaymentTx`/`buildEfAdjustmentTx`, tested against the exact 2.4.27 scenario). Live-verified end-to-end via a real browser session: partial EF draw, debt payment with a picked (non-default) bucket, editing a transaction to link then detach both EF and a debt, confirming the derived debt balance moves and reverts correctly each time. 400/400 suite, tsc clean, both builds clean, verified numerically invisible against the owner's real export.

### Context

Found live, in normal use, not by audit sweep (`docs/AUDIT_2026-08.md`, finding 2.4.27, re-rated Launch Blocker): the owner paid a real $325 debt, $300 sourced from the emergency fund. There is currently no way to record that as a transaction without something breaking — tag it "pay from EF" and it can't also link to the debt it paid down or represent a partial ($300 of $325) source; log it untagged and it silently double-counts as ordinary NEEDS/WANTS spending on top of the balance changes that already happened through a different path; record it via the debt's own "pay" action and it creates no transaction at all, so the EF portion is invisible. **Every path forces a choice between correct balances and a visible, accurate ledger row.** The owner chose correct balances — a real $325 payment has zero transaction record, and (confirmed by direct code read) is unrecoverable: `StoredTransaction` has no soft-delete/tombstone, no `createdAt`, and neither the client (`localStorage`, single-key overwrite) nor the server (`POST /push`, a Postgres `upsert` overwriting one column) keeps any history.

This is the same root defect Phase 2.5 was built to eliminate for recurring items (2.4.21: two parallel, unlinked sources of truth for "did this happen") — `emergencyFundBalance` and `debt.balance` are stored numbers nudged by a side effect of a different action (`InputPanel.tsx:254,257` for EF; `:352-367`'s `recordDebtPayment` for debts), with no ledger entry that can be inspected, edited, or reversed. A cohort user will hit this the first time they pay a debt from savings, and most won't notice which side of the tradeoff they landed on.

### The key design insight: EF and debts are just TrackedBalances

This app already has a structure that's immune to this exact bug: `TrackedBalance.expected` (`computeDashboard.ts`) is genuinely *derived* — recomputed from the live transaction list every time, never stored-and-mutated. That's precisely why 2.4.27/2.4.28 don't extend to tracked balances (checked directly this session). The fix isn't "add a link and hope edit/delete remember to reverse it" — it's to stop storing `emergencyFundBalance`/`debt.balance` as mutable fields at all, and derive them from the ledger the same way `expected` already works: an opening balance plus every linked transaction since.

### Data model (Sub-phase 2.6.1)

- **`StoredTransaction.createdAt?: string`** — new. Separates "when this was entered" from `date` ("when it happened"), per owner's explicit ask.
- **`StoredTransaction.deletedAt?: string`** — new. Soft-delete/tombstone: "Delete transaction" stamps this instead of removing the row; every normal read (spend totals, lists, derived balances) filters `deletedAt == null`; a "recently deleted" view makes it recoverable. Directly closes the "delete-and-redo is the only correction path, and it destroys data" gap.
- **`StoredTransaction.debtId?: string`** — links this transaction to the debt it paid down. v1 keeps it simple: the transaction's full `amount` applies to that one debt; a payment split across multiple debts is two transactions (same pattern already recommended for the dual-currency-single-transaction backlog item).
- **`StoredTransaction.efAmount?: number`** — signed; positive = this transaction also added to EF, negative = also drew from EF. Replaces the `txAddToEF`/`txFromEF` checkboxes' side-effect with a real, inspectable field on the transaction itself. Critically, `|efAmount|` can be *less* than the transaction's own `amount` — this is what makes "$300 of this $325 came from EF" representable on one real transaction instead of forcing a choice.
- **`emergencyFundOpeningBalance`** (on `LocalFinancials`) and **`StoredDebt.openingBalance`** — migration snapshots the current `emergencyFundBalance`/`debt.balance` values into these, exactly Phase 2.5.1's backfill shape: nothing retroactive, the balance a user already saw doesn't change, only movements from the migration point forward go through the new mechanism.
- Migration step follows the established shape (`addRecurringConfirmModel` in `localData.ts` as the direct precedent) — schema version bump, non-clobbering.

### Pure derivation logic (Sub-phase 2.6.2)

Tests-first (Standing Rule 4 — this is money math), siblings of Phase 2.5's own pure functions:
- **`derivedEfBalance(data)`** = `emergencyFundOpeningBalance` + sum of `efAmount` over every non-deleted transaction.
- **`derivedDebtBalance(debt, transactions)`** = `debt.openingBalance` − sum of `amount` over every non-deleted transaction where `debtId` matches.

Ships unwired, same discipline as 2.5.2 — proven correct in isolation before 8+ screens depend on it.

### The flip + edit-transaction flow (Sub-phase 2.6.3)

Every direct reader/writer of `emergencyFundBalance`/`debt.balance` switches together, atomically, same reasoning as 2.5.3 (a mix of derived and stored readings across screens would disagree with each other exactly the way this whole phase exists to prevent): `SetupScreen.tsx`'s manual EF field becomes an opening-balance-adjustment transaction; `InputPanel.tsx`'s EF checkboxes and `recordDebtPayment` become transaction-creation with `efAmount`/`debtId` set instead of direct field mutation; `computeDashboard.ts`, `DebtsScreen.tsx`, `printReport.ts`'s debt table, and everywhere else that reads the old fields switch to the derived functions.

**Edit-transaction flow — new capability, doesn't exist today.** Once balances are derived instead of stored-and-mutated, editing *or* soft-deleting a transaction requires no special reversal logic anywhere: the derived balance recomputes fresh from whatever the transaction list now says, automatically. The UI work is real (an edit form per transaction row, mirroring the existing edit pattern already proven in Debts/Recurring — `startEditDebt`/`saveEditDebt` as the direct template) but the underlying mechanics are free once the derivation is real.

### Migration for existing balances

Answered directly, per owner's question: existing `emergencyFundBalance`/`debt.balance` values have no ledger behind them today, and none gets invented retroactively. They become each account's `emergencyFundOpeningBalance`/`debt.openingBalance` — a real, dated starting point (the migration moment), not a fabricated transaction history. Everything from that point forward goes through the new mechanism; everything before it stays exactly as it already was, matching Phase 2.5.1's own precedent exactly.

### Acceptance

A debt payment sourced partly from EF is recordable as one real transaction, visible in Transactions, correctly reducing both the debt and EF by their own real amounts. Editing or soft-deleting that transaction correctly and automatically adjusts both derived balances with no special-case code. A pre-existing account's EF/debt balances are unchanged by the migration itself. Soft-deleted transactions are recoverable from a "recently deleted" view, not gone.

### Scope, and whether this sits before the cohort

**Comparable in size to Phase 2.5 as a whole**, not a small follow-on — data model + migration, pure derivation logic, a genuinely new edit-transaction UI (nothing like it exists today), and a consumer sweep shaped like 2.5.3's own. **Recommended before the cohort**, same reasoning Phase 2.5 itself was reordered on: the ledger should reconcile under its final model before anyone else trusts it — and unlike 2.5's risk, this one has already fired once, in completely normal use, on a real account, not a contrived edge case.

**Added 2026-08-25, after 2.4.37/2.4.38/Import shipped — a new argument for this same design, not a change to it.** Import from file (2.4.39) restores `LocalFinancials` wholesale from a JSON snapshot, the same way Pull does. Under today's model, `emergencyFundBalance`/`debt.balance` are plain stored fields — an import restores whatever value happened to be in the file, correct or not, with no way to tell which. Under the derived model this phase builds, those fields don't exist to import at all: `derivedEfBalance`/`derivedDebtBalance` recompute fresh from whichever transactions came back with the file. An import that's missing a transaction produces a balance that's honestly wrong in an inspectable way (the ledger shows what's missing), not silently wrong in an invisible one (a stale number with nothing behind it). This is the same principle 2.4.31's fix was already built on (real dollars need a real transaction, never an assumption) — Import turns out to be a second, independent path that benefits from it for free, not just the recurring-confirm flow it was originally designed for.

**SAFE STOP.**

---

## Phase 2.6.4 — Debt/goal payment forms close the gaps 2.6.3(c) left at the point of use

**Status:** all three steps built 2026-08-27 on `fix/payment-method-picker-2.6.4`, 421/421 tests, tsc clean, both builds clean, held for review, not merged · **Depends on:** Phase 2.6.3(a)/(b)/(c) (merged, live) · **Blocks:** nothing declared yet — real, rated High (2.4.41), but not unilaterally added as a Phase 2 precondition; owner to decide separately.

### Context

Found live during the Phase 2.6 post-deploy check, two related gaps in the same two forms:

- **2.4.41 (High):** `buildDebtPaymentTx` and `buildGoalContributionTx` both hardcode `paymentMethod: "other"`. `"other"` never matches a Cash or Card tracked balance's grouping key (`computeDashboard.ts:775`), so a debt payment or goal contribution can never reduce a tracked balance's `expected` figure, no matter which real account the money actually left. Before 2.6.3(c), a debt payment was invisible to balance reconciliation because it created no transaction at all; after (c), it's invisible because the transaction it now creates is mistagged. Phase 2.6's own new code reproducing the exact class of defect Phase 2.6 exists to eliminate.
- **The debt-payment form still can't represent 2.4.27's own original case.** (c) gave the main transaction form a partial EF-amount field ("$300 of this $325 came from EF"), but `recordDebtPayment`'s own form has no EF field at all — the case that started Phase 2.6 still isn't enterable at the one point of use where it actually happens (paying a debt from savings).
- **No category on a debt payment**, unlike every other transaction-creating form.
- **Edit Debt's Balance field is still read-only**, with no correction mechanism — flagged as a known gap when 2.6.3(c) shipped, not decided then.

Also found while designing this: `GoalsScreen.tsx` has its **own, second, independent** goal-contribution form (`pay()`) beside `InputPanel.tsx`'s inline one — both feed `buildGoalContributionTx`, so any fix has to reach both or repeat the exact "one screen fixed, the other silently still wrong" gap this project has already been burned by once (the Phase 1.4 survey missed this same site before).

### Data model

One new field: **`StoredTransaction.debtAdjustment?: number | null`** — a debt-total correction, independent of `amount`, mirroring `efAmount`'s relationship to EF exactly (so a correction can carry `amount: 0` and move nothing in any spend total, only the debt balance). No schema version bump — additive optional field, same class as `updatedAt`.

**Sentinel semantics, decided now, matching `efAmount`/`cycleDate` exactly (owner's explicit instruction — three carrier fields behave identically):**
- `undefined` — this transaction has never carried a debt-total correction. The default/absent state for every transaction that isn't specifically a correction.
- explicit `null` — a correction *was* attached and has been deliberately detached (mirrors `efAmount`'s null, not `cycleDate`'s — see below for why the edit-form UI treats both `undefined` and `null` as "show the same 'not attached' prompt," same as `efAmount` already does).
- a real number, including `0` — a correction of that magnitude is attached. Zero is legitimate (e.g. confirming a balance is already exactly right, same reasoning `efAmount: 0` is legitimate).

**Only meaningful paired with `debtId`** — same dependency `cycleDate` has on `recurringId`. The edit-transaction form's "Debt correction" section is only offered once a debt is linked via the existing "Linked debt" dropdown; clearing that dropdown also resets `debtAdjustment` to `undefined` rather than leaving a correction pointed at nothing.

`derivedDebtBalance`'s formula gains one term: `paid = Σ (t.amount + (t.debtAdjustment ?? 0))` over every non-deleted, `debtId`-matched transaction. `undefined` and `null` both contribute `0` to the sum — identical arithmetic either way, exactly like `efAmount`'s absent-vs-detached distinction never changes `derivedEfBalance`'s math either. The distinction is for the edit-form's own state and mental model, not the calculation.

**By construction, a `debtAdjustment`-carrying transaction is generically editable through the same edit-transaction form as any other** — no special-casing based on whether `buildDebtAdjustmentTx` or a later manual edit created it, the same way an `efAmount`-carrying transaction is uniformly editable regardless of whether the main form's checkbox or `buildEfAdjustmentTx` (via SetupScreen) originally set it.

### Builder signature changes

- **`buildDebtPaymentTx(debt, amount, bucket, lbpRate, opts?: { category?: string; efAmount?: number; paymentMethod?: PaymentMethod; cardId?: string; cardLabel?: string })`** — closes 2.4.27-at-point-of-use (partial EF), the category gap, and half of 2.4.41.
- **`buildGoalContributionTx(goal, amount, lbpRate, opts?: { paymentMethod?: PaymentMethod; cardId?: string; cardLabel?: string; paymentNote?: string })`** — closes the other half of 2.4.41, for both call sites.
- **New `buildDebtAdjustmentTx(debt, delta)`** — structurally identical to `buildEfAdjustmentTx`: `amount: 0`, `debtId: debt.id`, `debtAdjustment: delta`.

### UI — shared component, not six copies

Payment-method-plus-card is already duplicated three times (main entry, edit "This month", edit "History" — `InputPanel.tsx:950-1063`, `:1157`, `:1389`). Adding it inline to the debt-payment form and both goal-contribution forms would make six near-identical ~70-line copies — the same pattern that already produced the `achievedAt` discrepancy, the duplicate `DebtInput` construction, the duplicate goal-contribution logic, and `fmtCur` existing twice (owner's own list, all real prior incidents in this codebase).

**Extract `PaymentMethodPicker`** — owns its own add-card-panel state internally (not lifted to each parent), takes `cards`/`onSaveCard` as props. `saveCard()` gets parameterized (`saveCard(type, last4)` instead of reading module-level `newCardType`/`newCardLast4`) so the component calls it directly without its own copy of the persistence logic. The 3 *existing* copies are left alone — migrating those is a separate decision, not bundled here.

**Per-form:**
- **Debt-payment form** (`InputPanel.tsx:2222-2258`): gains an EF toggle (pay-from-EF only — a debt payment only ever draws from EF, never contributes to it, unlike the main form's two-way checkbox), same blank-means-full-amount partial pattern (c) already built; a category `<select>`, same options as every other form; `PaymentMethodPicker`.
- **Goal-contribution forms** (`InputPanel.tsx:1609-1627` and `GoalsScreen.tsx`'s `pay()`): both gain `PaymentMethodPicker` only — no EF/category fields, not asked for and goals aren't debts.
- **Edit Debt form** (`InputPanel.tsx:2145-2168`): the read-only Balance line becomes an editable "your real current balance" field, the same pattern `SetupScreen.tsx` already uses for EF — commit computes `delta = derivedDebtBalance(...) − entered` (note the sign: opposite of `commitEfBalance`'s `entered − efBalance`, since `derivedDebtBalance` subtracts `paid` from `openingBalance` while `derivedEfBalance` adds contributions to it) and calls `buildDebtAdjustmentTx` if non-zero.
- **Edit-transaction form** (`InputPanel.tsx`, both "This month" and "History" blocks): gains a fourth optional section, "Debt correction" — Link/Detach + amount, mirroring the existing `efAmount` section exactly, shown only when a debt is linked via the existing dropdown.

### Build order (owner's instruction — each committed and reported before the next; held for review, nothing merged until all of it is ready)

1. `PaymentMethodPicker` extraction (+ `saveCard` parameterization), adopted by no new call sites yet — provably inert if nothing else lands, same "ships unwired first" discipline as 2.6.2. **BUILT 2026-08-27.**
2. The three form adoptions (debt-payment form's EF/category/payment-method fields; both goal-contribution forms' payment-method field) — closes 2.4.41 and the point-of-use EF gap. **BUILT 2026-08-27.**
3. (d): `debtAdjustment` field, `buildDebtAdjustmentTx`, `derivedDebtBalance` formula update, Edit Debt's editable-balance field, and the edit-transaction form's new "Debt correction" section. **BUILT 2026-08-27** — one correction to this section's own design during implementation: the delta formula below was specified as `entered − derivedDebtBalance(...)`, copying `buildEfAdjustmentTx`'s formula verbatim; caught by tests-first before any UI landed that this is backwards for debt (`derivedDebtBalance` subtracts `paid` from `openingBalance`, `derivedEfBalance` adds contributions to it — opposite directions relative to the carrier field). The correct, implemented formula is `delta = derivedDebtBalance(...) − entered`. See 2.4.41's `docs/AUDIT_2026-08.md` entry for the full live-verification writeup.

### Acceptance

A debt payment can be tagged with a real payment method (and card, where relevant), a category, and a partial EF-sourced amount, all in the one form where the payment is actually recorded. A goal contribution, from either of its two entry points, can be tagged with a real payment method. Balance Check's `expected` correctly reflects a cash- or card-sourced debt payment or goal contribution going forward. Correcting a debt's total produces one real, inspectable transaction — never a silently-edited scalar with nothing behind it — and that transaction is editable/detachable through the same generic edit-transaction form as any other, no special-casing by origin.

**SAFE STOP** after step 1 and after step 2 — each sub-step leaves `main` behaviorally consistent (either the picker exists unused, or the three forms work with `debtAdjustment` still not implemented, matching today's read-only Edit Debt behavior exactly). Step 3 completes the phase.

---

## Phase 2.7 — Sync merge for transactions

**Status:** not started, design approved 2026-08-26 · **Depends on:** Phase 2.6 (all of 2.6.3, including (c)) · **Blocks:** Phase 2 (cohort launch).

### Context

Found while designing 2.6.3(c), not by audit sweep: two devices (phone, laptop) each recording a transaction between syncs is a routine, weekly occurrence for a two-device user, not an edge case. Today, whichever device pushes second either silently overwrites the other's real transaction or gets rejected outright (2.4.38's `stale_push` conflict) — and detection without merge just names which data is about to be lost, it doesn't save it. A finance app that silently drops a transaction during completely normal dual-device use is a worse defect than most of what's already on the Launch Blocker list, and unlike 2.4.33 it needs no outage or sign-in trigger to fire.

### Why this depends on 2.6.3(c) specifically, not just (a)/(b)

`derivedEfBalance`/`derivedDebtBalance` (2.6.2/2.6.3a) already make EF/debt balances a pure function of the transaction ledger — that's what makes "merge the transactions, the balances fall out correct for free" true at all. But per the owner's own deploy-together decision, (a)/(b)/(c) ship as one unit — so by the time this phase's merge logic runs against a live account, every EF/debt write will already be transaction-based (2.6.3(c)'s EF checkboxes/`recordDebtPayment`/`SetupScreen` rework). No non-transaction EF/debt mutation path exists left to worry about.

### Design (approved 2026-08-26)

**Scope: transactions merge automatically; everything else keeps today's pick-a-side resolution, applied after the transaction merge lands on top of whichever side is chosen** — not a full merge of every entity array. `debts`/`goals`/`recurring`/`assets`/`cards`/`trackedBalances` have no delete-tombstones today; naively unioning them by id would risk resurrecting something one device hard-deleted, the same bug class 2.6.3(b) exists to prevent, just on a different entity. Left alone for this phase.

- **`mergeTransactions(local, server)`** — pure function, siblings of `derivedEfBalance`/`derivedDebtBalance`, tests-first (Standing Rule 4 — this is the merge the rest of the phase leans on). Union by `id`: present on one side only → keep it. `deletedAt` set on either side → tombstone wins over an active copy. Same `id`, both active, fields differ (a real edit-vs-edit conflict) → resolved by `updatedAt` (added to `StoredTransaction` in 2.6.3(c) — see below) once a device has both timestamps; last-writer-wins, since a genuine conflict is rare enough for a two-device personal app that blocking a routine sync on it is worse than an occasional silently-applied "wrong" pick — but the merge result should carry enough information for the caller to say what happened (e.g. "resolved 1 conflicting edit"), not resolve it invisibly. Exact confirm/note UX to be decided when this phase starts, not now.
- **Known residual gap, accepted, not hidden**: a merged-in transaction can reference a `debtId`/`recurringId` that only exists on the discarded side of a non-transaction conflict. Low blast radius — `derivedDebtBalance` only counts a transaction toward a debt it actually matches, so a dangling reference sits inert rather than corrupting anything, same severity class as the already-logged 2.4.35 (orphaned `recurringId`).
- **`syncService.ts` wiring** — no server changes: the server already stores one opaque blob with zero merge awareness (confirmed by reading `sync.ts`), so merge is entirely client-side. On a conflict: pull the server's current data via the existing `pullFromServer`, run `mergeTransactions` against local, keep local's non-transaction fields (falling back to today's pick-a-side prompt only if those also differ), push the merged result via the existing `pushToServer` (succeeds now that `baseSyncedAt` reflects the just-pulled `syncedAt`).
- **`autoSync`'s conflict path** (`page.tsx`) attempts the merge automatically in the background on a 409, rather than only setting the static "Sync conflict — resolve in Settings" indicator — the pain point is routine, so the fix should be too. Surface a brief, dismissible confirmation of what happened (e.g. "Merged with your other device — 2 new transactions added"), matching the toast precedent from 2.6.3(b) — a number moving with no explanation is worse than the conflict badge it replaces. Falls back to today's static conflict indicator only when a real non-transaction conflict remains.
- **Profile page's existing Push/Pull conflict card** gains a third, primary "Merge" action (Push/Pull demoted to manual overrides for when someone actually wants to discard a side).

### Two additions folded into 2.6.3(c)'s own data model, not built here

1. **`StoredTransaction.updatedAt?: string`**, stamped on every write (create, edit, confirm, restore) — added as part of 2.6.3(c) since that sub-phase is already touching the transaction model and building the edit form; adding it later would mean a second migration for a field already known to be needed now. This is what makes edit-vs-edit resolution above possible at all.
2. Edit-vs-edit resolution itself (last-writer-wins vs. requiring manual review) was revisited once `updatedAt` is available and decided in favor of auto-resolving with a note, not blocking — see the design section above.

### Acceptance

Two devices each log a different transaction between syncs; both survive after either device's next sync, with no user action required beyond the existing sync flow. A transaction deleted on one device stays deleted after merging with a stale copy of it from the other. A genuine same-transaction edit conflict resolves automatically (last-writer-wins) and is visible in the outcome, not silent. No server-side change required.

**SAFE STOP.**

---

## Phase 2 — Cohort launch

**Not a development phase.** Owner-executed.

Preconditions: Phase 0, Phase 1, **Phase 2.5, Phase 2.6, and Phase 2.7** complete (updated 2026-08-26 — same reasoning each time: the ledger, and now sync itself, should reconcile under its final model before anyone outside the owner uses it), 12 of 12 on the launch checklist in `CLAUDE_CODE_BRIEF.md` §3.2, real-device mobile check passed.

Once live, **Rule 8 activates**: the ordering below becomes provisional and subject to what real users actually do.

---

## Phase 3 — F2 Recurring obligations with end dates

**Status:** not started · **Depends on:** Phase 1, Phase 2.5 · **Blocks:** Phase 4

**Dependency note added 2026-08-22:** Phase 2.5 now sits between Phase 1 and this one, and both touch `StoredRecurring` directly. Building this phase's forward-capacity view on the live-estimate model would mean redoing it once 2.5 lands — plan this against the confirm-on-due model, not the one described below.

The owner's own dominant financial fact is a fixed monthly installment with a known termination date. Modelling recurring obligations as indefinite understates future capacity and produces a misleading forward picture. `StoredRecurring` already supports an optional `endDate` and `isRecurringActive()` enforces it — this phase surfaces it in the product rather than building it from nothing.

**Requirements**
- An obligation has amount, currency, frequency, start date, optional end date.
- Excluded from projections beyond its end date.
- UI surfaces remaining installments and total remaining commitment.
- A forward view shows monthly disposable capacity, **including the step change when an obligation terminates.**

**Acceptance:** given the owner's real installment schedule, the forward view correctly shows capacity increasing at termination.

**SAFE STOP.**

---

## Phase 4 — F3 Goal feasibility engine

**Status:** not started · **Depends on:** Phase 3

**This is the highest-value feature in the roadmap and the strongest reason for the product to exist.** It automates the question the owner currently answers by exporting a report and reasoning over it manually: *can I actually afford this, by that date?*

**Requirements**
- A goal has target amount, target date, currency, and active/archived status.
- Given current balances, projected capacity from Phase 3, and existing allocations, the engine reports per goal: **achievable**, **achievable with adjustment**, or **not achievable by the target date**.
- Where not achievable: state the specific shortfall and the monthly contribution required to close it.
- Where goals compete for the same capacity: **state the conflict explicitly.** Never silently assume parallel funding.
- Archived goals excluded from capacity, retained as records.

**Design note.** The conflict case is the one that makes this feature honest. An engine that reports three goals each individually achievable, while funding all three from the same money, is worse than no engine. Test that case first.

**Acceptance:** validated against the owner's real goals and real capacity; conflict case produces an explicit warning.

**SAFE STOP.**

---

## Phase 5 — F4 In-app monthly report

**Status:** not started · **Depends on:** Phase 1, Phase 3

The owner already produces and reads a monthly report externally. It should be a first-class product output.

**Requirements**
- One page per month, generated on demand: income, obligations, category spending, savings movement, goal progress.
- Month-on-month comparison highlighting material changes.
- Shareable as image or PDF, sized for WhatsApp.
- Contains no data belonging to any other user.

**SAFE STOP.**

---

## Phase 6 — F5 Spending intelligence

**Status:** not started · **Depends on:** Phase 5

- Category spending compared against **the user's own trailing three-month average**, never generic benchmarks.
- Detection of recurring subscription charges the user has not explicitly declared.
- Plain-language observations: "Fuel is 40% above your usual month," not a variance table.

**Tone constraint (from the brief).** This feature observes a person's finances during difficult periods. It reports facts and highlights options. It does not congratulate, admonish, or moralise.

**SAFE STOP.**

---

## Phase 7 — F6 PWA and offline resilience

**Status:** not started · **Depends on:** none after Phase 1

Users are on inconsistent Lebanese mobile networks.

- Installable to a phone home screen.
- Offline read of previously loaded data; queued write syncing on reconnection.
- Deferred loading to reduce initial bundle. Current: 87.7 kB shared, 258 kB first load, all 14 screens in one non-route-split bundle.

**Conflict warning.** Queued offline writes interact with sync conflict resolution. Report the interaction before implementing.

**SAFE STOP.**

---

## Phase 8 — F7 Arabic and RTL

**Status:** not started · **Depends on:** Phase 5

- Full translation with right-to-left layout.
- Locale-appropriate number and date formatting.
- Language selectable independently of currency.

**Do this last.** Every string added in Phases 3–7 is a string that must be translated; doing it earlier means translating twice.

**SAFE STOP.**

---

## Phase 9 — Generalized currency (beyond USD/LBP)

**Status:** not started (added 2026-08-25, owner's explicit assessment: Phase 1-sized, not building before the cohort) · **Depends on:** Phase 1

**The ask:** a user outside Lebanon (e.g. Europe) should be able to use EUR instead of LBP — USD stays the anchor currency, but the *second* currency shouldn't be hardcoded to LBP specifically.

**Why this is Phase-1-sized, not a small follow-on.** `Currency` is a closed 2-value union (`"USD" | "LBP"`, `client/lib/localData.ts:3`), and that assumption is load-bearing, not incidental — 90 occurrences of LBP-specific branching (`=== "LBP"`, the `L£` symbol, dual-currency toggles) across 18 files, per a direct grep this session. Concretely, generalizing means:
- Widening `Currency` from a 2-value union to an open set (ISO codes), which ripples into every `Currency`-typed field across `StoredTransaction`/`StoredRecurring`/`StoredGoal`/`StoredDebt`/`StoredAsset`/`TrackedBalance`.
- `lbpRate`/`lbpRateHistory`/`lbpRateAtEntry`/`DEFAULT_LBP_RATE` are all LBP-*named*, single-flat-value fields — becoming a currency-keyed rate map (`exchangeRates: Record<string, number>`, and the historized equivalent) is a real data-model change requiring its own migration, not a rename.
- `toUSDShared`/`toUSDForMonth`/`valueForMonth` (the entire conversion engine) assume exactly one foreign currency anchored against USD — generalizing to *any* foreign currency is an architecture change to the conversion layer itself, not a third hardcoded branch alongside the other two.
- Every currency-symbol/toggle site (`CurrencyToggle` in `form/Primitives.tsx`, `fmtCur`, every hardcoded `"$"`/`"L£"` ternary) needs a symbol/formatting lookup instead of a binary choice.

Phase 1 (1.1–1.5, the dual-currency work already built) took multiple sub-phases to introduce exactly *one* additional currency correctly. Generalizing to *any* second currency is comparable in size, arguably larger — it means removing the binary assumption Phase 1 just finished building in, everywhere it appears, not repeating Phase 1's pattern a third time.

**Acceptance (sketch, not final — design this properly when scheduled):** a user can pick any supported currency as their "second currency" at setup; every screen that today hardcodes LBP behaves identically for the chosen currency; historized past-month figures for an account that switches its second currency mid-history don't retroactively rewrite what was already shown.

**SAFE STOP.**

---

## Deferred backlog

Not scheduled. Each requires an explicit decision to activate.

| Item | Why deferred | Trigger to revisit |
|---|---|---|
| Next.js 14→16 (rewrite-smuggling CVE) | Major version bump; adversary must be positioned on infrastructure path; not a ten-person risk | After cohort is stable, or any sign of exploitation |
| Finding 2.2.16 — server-side registration gap | Zero of 36 live rows affected; naive fix is an account-takeover bug | If any account is found in the gap state |
| Email ownership verification | Enables email squatting; support friction, not data exposure | If squatting actually occurs, or before public launch |
| Password change while signed in | Path exists via recovery code | Cohort complaint |
| Staging environment (option B) | New infrastructure; runbook written and ready | After cohort is live and stable |
| Environment identifier in `/api/health` | Bundle with staging work | With staging |
| Server-side admin gating | Nothing cross-user behind the gate | If anything sensitive is ever added to `/admin` |
| Dual-currency single transaction (one bill paid partly USD, partly LBP — e.g. $10 + L£200,000) | Real gap, but small compared to Phase 9 above — added 2026-08-25. `StoredTransaction` has exactly one `amount`+`currency` pair; a schema-level split (`amount2?`/`currency2?`) would touch every one of the dozens of `t.amount`/`t.currency` read sites across the app. The pragmatic version doesn't touch the schema at all: one form submission in `InputPanel.tsx` creates *two* ordinary `StoredTransaction` rows (one per currency), no new fields, no consumer changes needed anywhere else — sized at roughly a day, not a phase. Minor accepted tradeoff: two line items in Transactions instead of one for what was conceptually a single payment. | Owner decides it's worth building — small enough to fold into any nearby work, not just a dedicated phase |

---

## Sequencing summary

```
Phase 0  Loose ends            — now
Phase 1  Dual-currency         — last Launch Blocker
Phase 2.5  Recurring confirm-on-due  — built, merged, 🟡 pending owner's live check
Phase 2.6  EF/debt ledger-derived    — 2.6.1/2.6.2 merged, 2.6.3(a)/(b)/(c) all approved+built+held, ready for combined deploy, cohort-blocking (2.4.27)
Phase 2.6.4  Debt/goal payment-form gaps  — all 3 steps built 2026-08-27, held for review, not merged, blocking status undecided (2.4.41)
Phase 2.7  Sync merge (transactions) — design approved, not started, depends on 2.6.3(c), cohort-blocking
Phase 2  COHORT LAUNCH         — ordering below becomes provisional
Phase 3  Recurring end dates
Phase 4  Goal feasibility      — flagship
Phase 5  Monthly report
Phase 6  Spending intelligence
Phase 7  PWA / offline
Phase 8  Arabic / RTL          — last, to avoid translating twice
Phase 9  Generalized currency  — unscheduled, Phase-1-sized, not before cohort
```

**Critical path to launch: Phase 0 → Phase 1 → real-device check → ship.** Everything after Phase 2 waits on evidence from real users.

---

## Session protocol

Open a session by stating which phase and sub-phase is being worked, confirming its dependencies are complete, and presenting a plan. Wait for approval.

Close a session by stating what shipped, what did not, whether `main` is in a SAFE STOP state, and what the next session should pick up. **If `main` is not in a safe state, say so explicitly and first** — that is the single most important line in any session summary, because the next session may be three weeks away.
