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

**Status:** in progress (updated 2026-08-24) · **Depends on:** Phase 1 · **Blocks:** Phase 2 (cohort launch), Phase 3

**Progress so far, not a completion claim (Rule 6 — the phase itself isn't done):** 2.5.1 (schema v2→v3, `confirmCutoverDate`/`recurringId` fields) and 2.5.2 (pure cycle logic — `dueCycles`/`isCycleConfirmed`/`isCycleOverdue`/`buildRecurringConfirmLog`, completely unwired) both built, tested first, merged to `main`, live. Two related live bugs found and fixed along the way, both merged: `nextOccurrence` checking its `endDate`/`totalAmount` bounds at the wrong point (2.4.24), and `recurringPaidSoFar`'s totalAmount cap being calendar-elapsed-time based instead of confirmed-payment based (2.4.25) — full detail in `docs/AUDIT_2026-08.md`. 2.5.3 ("the flip" — wiring all 8 consumers + OVERDUE UI) is planned but not yet built.

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

## Phase 2 — Cohort launch

**Not a development phase.** Owner-executed.

Preconditions: Phase 0, Phase 1, **and Phase 2.5** complete (updated 2026-08-22 — the ledger reconciles under its final model before anyone outside the owner uses it), 12 of 12 on the launch checklist in `CLAUDE_CODE_BRIEF.md` §3.2, real-device mobile check passed.

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

---

## Sequencing summary

```
Phase 0  Loose ends            — now
Phase 1  Dual-currency         — last Launch Blocker
Phase 2  COHORT LAUNCH         — ordering below becomes provisional
Phase 3  Recurring end dates
Phase 4  Goal feasibility      — flagship
Phase 5  Monthly report
Phase 6  Spending intelligence
Phase 7  PWA / offline
Phase 8  Arabic / RTL          — last, to avoid translating twice
```

**Critical path to launch: Phase 0 → Phase 1 → real-device check → ship.** Everything after Phase 2 waits on evidence from real users.

---

## Session protocol

Open a session by stating which phase and sub-phase is being worked, confirming its dependencies are complete, and presenting a plan. Wait for approval.

Close a session by stating what shipped, what did not, whether `main` is in a SAFE STOP state, and what the next session should pick up. **If `main` is not in a safe state, say so explicitly and first** — that is the single most important line in any session summary, because the next session may be three weeks away.
