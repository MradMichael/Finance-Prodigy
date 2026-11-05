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

## 2.8.5 (LB3): built, held, not merged

**Branch:** `claude/concurrent-corrections-2.8.5`, rebased onto `4733cd5`. Steps 2.8.5a–e are built, each
tests-first. **It is not merged until the owner's two-device check by hand passes.**

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
| 2.8.1 | A pure, unwired function deriving a goal's achievement from its ledger, the sibling of `debtPayoff` | Dated by the latest crossing that still stands, matching `debtPayoff` |
| 2.8.2 | Additive migration for goals achieved before the ledger began; nothing reads it yet; zero-diff checked | — |
| 2.8.3 | Every reader of achievement switches to the derived value (LB1). A visible change, so its own bug-fix commit | — |
| 2.8.4 | The stored achievement stops being written, after one release of dual-writing; the merge keeps the before-ledger record instead (LB2) | Dual-write for one release |
| 2.8.6 | Goal withdrawals | A $0 row with a negative `goalAmount`; moves nothing in the budget |
| 2.8.7 | Contributions from the other currency's pool, at the rate on the day | LB4 and LB5 are fixed first, each its own commit |
| 2.8.8 | Retire `currentAmount` | Waits for the owner's confirmation that every device is updated |

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
