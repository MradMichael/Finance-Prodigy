# Phase 2.8: goal progress from the ledger, and the sessions 41–43 follow-ups

**Written:** 2026-11-05 (session 43), for whoever picks this up next.
**Authority:** `docs/CLAUDE_CODE_BRIEF.md` (rules 1–18, §6.5) and `docs/ROADMAP.md` (Phase 2.8) still govern.
This file records the plan and the owner's decisions; it does not replace either.

**Findings are named by label only (LB0–LB6).** This repository is public. Their descriptions are kept
out of it on purpose; ask the owner for them.

**Rule 6:** nothing here is complete until the owner confirms it.

## Merged to `main`

| What | Merge |
|---|---|
| Plan H 5a: goal progress computed from contributions and corrections; `openingAmount` migration | `72de874` (2026-10-09) |
| Privacy copy fixes: LB0, the About page, the sign-up and recover caveats and their size, the About badge; ROADMAP records plan H 5a | `dadd757` |
| The Privacy page's LB6 caveat and its date (5 November 2026); one shared lira mistype check, now on the split entry too | `4733cd5` |
| 2.8.5a–e (LB3): two devices' corrections to one account settle on the later statement, with the approved notices | `5a5ef2c` (2026-11-05) |
| LB2's merge fix: a goal's achievement cleared by an edit stays cleared after a sync | `fix/lb2-deliberate-clear` (2026-11-09, session 45) |
| 2.8.1 (LB1): `goalAchievement()`, the rule, unwired (nothing reads it yet) | `feat/2.8.1-goal-achievement` (2026-11-09, session 47) |

## LB2's merge fix: merged, not yet owner-verified

**Merged to `main` from `fix/lb2-deliberate-clear`** (2026-11-09, session 45; a merge commit). The rule is the owner's,
from the session 45 list and its answers. No new wording. Not marked complete (Rule 6).

- A goal's achievement is stamped once (`achievedAt`), and a merge never drops one on its own. A person's
  clear is an edit: the edit sheet clears it when a save leaves the goal below its target.
- **Only one device changed the goal since the last sync:** the merge takes that device's copy. If that
  copy has no stamp, it was a deliberate clear, and it stays cleared. If it has one, the earliest stamp any
  copy holds stays, as before.
- **Both devices changed it (a clash):** the earliest stamp any copy holds stays, as before. The merge can't
  tell a clear from a stamp the winning copy never saw, because a contribution sets the stamp without
  marking an edit.
- **Debts are unchanged:** a debt's before-ledger payoff date is still kept from any copy.
- **Tests first:** `client/lib/goal-achieved-clear.test.tsx` (2 red before the fix; guards for the clash,
  older copies, a newer backup and debts; 4 perturbations each red).
- **Known limits (owner-accepted):**
  - A clear made while the other device also edited that goal comes back.
  - A device still on an older build re-applies the old rule until it updates.
  - The stored stamp is still what readers use; deriving it from the ledger is 2.8.1–2.8.4.

## 2.8.5 (LB3): merged, owner-verified

**Merged to `main` at `5a5ef2c`** (2026-11-05; a merge commit, not squashed), from
`claude/concurrent-corrections-2.8.5` rebased onto `38c2d48`. Steps 2.8.5a–e, each tests-first. **The owner's
two-device check by hand passed** before the merge (Rule 6). On the merged tree: full client suite 2,890
passed, 13 skipped; `tsc` and lint clean; server 230 passed, 13 skipped; build clean.

Owner's decisions (sessions 42–43):
- **Rule:** when two devices each correct the same account (safety net, a debt, a goal) before syncing,
  the later statement stays and the other device's correction is soft-deleted, restorable from Recently
  deleted.
- **Notice only, nothing set aside,** when a correction crosses an ordinary payment, contribution, deposit
  or withdrawal on the other device, or involves a period close.
- **Wording (2.8.5e), approved:** sentences 1–4 as drafted. In 5 and 6 a signed figure is never shown: the
  other device's movement is named by account and direction (a payment, a contribution, a deposit, a
  withdrawal; the other way, or both ways at once, an increase or a decrease).
- **Testing:** never against production. The owner checks two devices by hand.
- **Approved (session 43):** several movements in one direction read as a count and a total ("2 payments
  totalling $150"); movements that cancel out produce no notice, since the balance is then exactly what the
  correction stated.
- **Known limits:** device clocks decide "later"; the protection holds once every device runs the new code.

## The rest of 2.8: planned, not approved to build

Each step is a SAFE STOP, tests-first (RED before GREEN), one concern per commit.

| Step | What | Owner's answer |
|---|---|---|
| 2.8.1 | A pure, unwired function deriving a goal's achievement from its ledger, the sibling of `debtPayoff` | Dated by the latest crossing that still stands, matching `debtPayoff`. **Planned below (session 46); approved (session 47)** |
| 2.8.2 | The before-ledger record for goals reached before the ledger began; nothing reads it yet; zero-diff checked. **No migration and no schema bump** (proposed session 46, approved session 47; below) | — |
| 2.8.3 | Every reader of achievement switches to the derived value (LB1). A visible change, so its own bug-fix commit. **Planned below; approved (session 47)** | — |
| 2.8.4 | The stored achievement stops being written, after one release of dual-writing; the merge keeps the before-ledger record instead (LB2; its merge part is fixed already, above) | Dual-write for one release |
| 2.8.6 | Goal withdrawals | A $0 row with a negative `goalAmount`; moves nothing in the budget |
| 2.8.7 | Contributions from the other currency's pool, at the rate on the day | LB4 and LB5 are fixed first, each its own commit |
| 2.8.8 | Retire `currentAmount` | Waits for the owner's confirmation that every device is updated |

## 2.8.1–2.8.3 (LB1): plan approved (session 47, 2026-11-09; written in session 46)

**Approved by the owner in session 47.** All eight open questions take the recommendation (answers below),
and the Projections wording is approved. The build is 2.8.1 and 2.8.2 merged, then 2.8.3 held for the owner's
review. Each step's status is recorded in this section as it merges.

**Built so far:**
- **2.8.1 is merged** (session 47): `goalAchievement()` in `client/lib/localData.ts`, unwired.
  - Tests first: 25 in `client/lib/goal-achievement.test.ts`, red until it existed.
  - 5 perturbations each turned a test red: the rounded percent as the rule, no deleted filter in the walk,
    the first crossing, rounding row by row, and the rate on the day over a stored rate.

The private detail lives outside the repo (ask the owner): every place that
decides or shows "achieved" today, with file and line, the proof that they disagree, and worked examples.
Decisions already in force: the date is the latest crossing that still stands, as `debtPayoff`'s is; the
stored achievement is dual-written for one release.

### Today

Goal screens use four different tests for "achieved":
- the stored stamp (`achievedAt`);
- the dashboard's rounded percent;
- the exact saved figure against the target;
- a target of 0 or less counting as met.

They disagree in realistic cases. 2.8.3 moves every one of them to one rule.

### The rule (2.8.1)

`goalAchievement(goal, data) → { achieved, on }`, in `client/lib/localData.ts` beside `goalProgress` and
`debtPayoff`.
- **Achieved:** the saved figure (`goalProgress`) is at or over the target, or the target is 0 or less (today's
  convention). It's the same figure every screen shows, so the yes/no can't disagree with it.
- **On:** the goal's live rows (not deleted, not purged), sorted by date, then creation time, then id. Each
  step's total uses the exact formula `goalProgress` ends on, so the last total equals the figure to the cent.
  The last row that takes the total from under the target to at or over it dates the achievement (its own
  day).
  - A goal crosses upward; a debt crosses downward. The two conditions mirror each other (re-derived, rule 18).
- **Edge cases:**
  - **Withdrawals** (2.8.6) and negative corrections count like any row: under the target un-achieves; a
    later row brings it back and dates it.
  - **A raised target** un-achieves at once. **A lowered target** is walked against the new target, because
    targets keep no history.
  - **A pause** doesn't change achievement. The badge still reads paused first.
  - **Lira rows** convert exactly as the saved figure converts them. Today's rate never moves an achievement.
  - **Closes** write no goal rows.
  - **Deleted rows** are out while deleted and come back on restore.
  - **Future-dated rows** count, as they do in the saved figure (open question 2).

### The before-ledger record (2.8.2)

When the goal is achieved and no row crosses (the opening amount alone meets the target), the date is the
stored stamp's local day: a day string is kept as is, and an instant is converted. With no stamp, there is no
date.

**No migration and no schema bump:**
- The stamp already holds that date. 2.8.4 turns it into exactly that record by no longer writing it (the
  pattern of a debt's `paidOffBeforeLedger`).
- A new field would only rename it, and the bump it needs would pause every older build's sync until it
  reloads.

### Every reader on the rule (2.8.3)

- **What moves to the rule:**
  - the dashboard's goals gain `achieved` and `achievedOn`;
  - the Overview, Goals, My Finances (Goals), Journey, Projections and the PDF report read them.
- **The percent:** 100% only when achieved; otherwise at most 99%. Only the 99.5–99.99% band changes.
- **Projections' empty state** gets the line below (for approval) when the goals left are paused rather than
  achieved.
- **Unchanged:** the writers and the merge (the dual-write).

### Sync, older builds, rollback

- **No clocks:** the rule reads only rows, the opening amount and the target, which all merge under the
  fingerprint rule. Two devices that have synced agree.
- **During the dual-write release:**
  - the stamp is still written as today, and read by new builds only as the before-ledger record;
  - older builds read exactly what they read today.
- **The session-45 tension:** the merge keeps the earliest stamp, while the rule dates by the latest crossing.
  It can't show on screen when a row crosses, because the row dates it.
- **2.8.4** stops both writers, and the merge goes back to "always the earliest". It waits for one release
  and the owner's word that every device shows the new build (Profile's version line).
- **Rollback:** revert each merge. None of 2.8.1–2.8.3 writes anything new.

### Tests first

- **2.8.1:**
  - exact and one-cent cases;
  - one, two and withdrawn crossings;
  - deleted, restored and purged rows;
  - same-day order;
  - corrections;
  - lira rows at stored and on-the-day rates;
  - paused goals, and targets raised and lowered;
  - future-dated rows;
  - a seeded property test: the yes/no always equals "saved ≥ target", and the walk's total always equals the
    saved figure;
  - three time zones.
- **2.8.2:** day and instant stamps in three zones; no stamp; a stale stamp ignored whenever a row crosses.
- **2.8.3:** each screen asserted on the rounding, deleted-row, backdated, before-ledger, paused-and-reached
  and paused-only cases. Today's T5 tests and a zero-diff snapshot are guards.
- **Perturbations** (each must turn a test red):
  - the rounded percent as the rule;
  - no deleted filter;
  - the first crossing;
  - per-row rounding;
  - a day stamp parsed as UTC;
  - the before-ledger record ignored;
  - the wrong rate;
  - Projections on the rounded percent;
  - no 99 cap;
  - Journey on the stamp;
  - paused read as achieved.

### Wording (approved, session 47)

Projections, when no goal is left to plan because each is achieved or paused (at least one paused and not
reached):

> Nothing left to plan: every goal is achieved or paused.

"All goals achieved. 🎉" stays when every goal is achieved. No other new words.

### Merges and the owner's checks by hand

| Merge | Visible | Check by hand |
|---|---|---|
| 2.8.1 | nothing | nothing changes |
| 2.8.2 | nothing | nothing changes; screenshots of the goal screens, to compare after 2.8.3 |
| 2.8.3 | yes | On a throwaway goal ($100 target): $99.60 reads not achieved everywhere (99%, Add payment shown, planned). $0.40 more reads achieved, dated today. Delete that row: not achieved; restore it: achieved again, same date. A row dated three days back that reaches a goal is dated that day. A paused, reached goal shows the same on a second device after a sync. Then the real account against the screenshots |

### The owner's answers (session 47: each takes the recommendation)

1. A lowered target is dated by the row that crossed it.
2. Future-dated rows count, as they do in the saved figure. A warning when a contribution is dated in the future
   is planned separately.
3. Percentages show at most 99% until a goal is achieved.
4. The empty-state line above is approved.
5. 2.8.2 has no migration and no schema bump.
6. 2.8.4 waits for one release and the owner's word that every device is updated.
7. A reached, paused goal shows "Achieved" and "Paused", and counts in Journey.
8. Same-instant rows are ordered by id for goals; debts are unchanged.

## Income-history fallback: decided, not approved to build

Decision (owner, session 41): for periods before the first income snapshot, fall back to the **earliest**
snapshot, not today's income. The test that pins today's fallback is rewritten first and must fail before
the fix (rule 4). It visibly changes past periods' figures, so it needs a before/after check on the owner's
data.

## InputPanel split (`client/components/InputPanel.tsx`): planned, not approved to build

Every step preserves behaviour, ships on its own, and is covered by a test that exists before the move. Any
step that would change behaviour becomes its own bug-fix item, never part of a move. Each move step also
needs a manual or Playwright check at 375 px: sections open and closed, toasts, dialog focus and Escape, the
phone layout, the remembered last entry.

| Step | What |
|---|---|
| S0 | Tests only: characterise what has no test yet (assets add and delete, the transfer form's guard, adding a debt, adding and pausing a goal, a History row) |
| S1 | The lira mistype check as one function: **done**, merged at `4733cd5` |
| S2 | The mistype dialog as one component, shared with the edit sheet (this also settles the dialog duplication) |
| S3 | The card lookup as one helper |
| S4 | Building a new goal as one function (no change to how achievement is set: that is 2.8.3) |
| S5 | One transaction row component, keeping today's two variants through a prop |
| S6 | Move the Assets section |
| S7 | Move the Transfer section |
| S8 | Move the Debts section |
| S9 | Move the Goals section |
| S10 | Move the Recurring section |
| S11 | Move This month and History (they share S5's row) |
| S12 | Move Log an entry (the most state, so last) |
| S13 | The remaining shell: tabs, stats strip, toast |

Separate bug items, not part of any move: D6, D9 (pinned by a test first), D10, D11.

Numbering note (rule 12): the session 41 report listed eight section moves under S6–S12; here This month
and History share S11, so S0–S13 holds every step once.

## Later items

- **Split-entry dialog wording**, its own item. Owner's draft: "L£400 is unusually low for a real purchase.
  Did you mean to put this amount in the USD field?"
- **Dialog duplication**: with the InputPanel split (S2).
- **LB6 server cleanup** (2.4.132 steps 2–3): needs its own plan and approval. The Privacy caveat stands
  until it ships.
