# Rate staleness — plan, decisions, and what's left

**Status (corrected 2026-11-09, session 45; this line read "not merged" after the merge):** Phases 1 and 3 are **merged to `main` at `1169e8b`** (2026-11-05, a merge commit), from `claude/gallant-wright-899t1h` (deleted from the remote on 2026-11-09, after a check that it was fully in `main`). Whether the owner's preview check came before the merge isn't recorded here: UNKNOWN. Not complete until the owner confirms it (Rule 6). Phases 2 and 4 were not approved and are not built.

**Pillars:** Spend and Save. Every USD/LBP figure depends on the rate, so a stale rate distorts budgets, balances and goal progress.

**Who it's for:** the owner and the friends-and-family cohort.

**Hard constraint:** no automatic rate fetching from any outside service (privacy-first). A new rate is always typed by the user.

---

## 1. What already existed before this work

Checked in code, not inferred (rule 13). Searches run: `rateAge|rateUpdated|rateSetAt|staleRate|rateStale|daysOld|lastRate|lbpRateUpdatedAt|recordRateEdit|rate-stale|LBP_RATE_STALE_DAYS` across `client/` and `server/`, plus the onboarding checklist and `ROADMAP.md`.

| Piece | Where (at the start) | What it did |
|---|---|---|
| Stamp field | `client/lib/localData.ts` `lbpRateUpdatedAt` | ISO instant set on each rate edit; absent if never edited |
| Threshold | `LBP_RATE_STALE_DAYS = 14` | One shared constant, not a user setting |
| Day counting | `calendarDaysSince` | Local calendar days (COPY-08), DST-safe |
| The write | `recordRateEdit` | Sets the rate, the stamp, a dated `lbpRateLog` entry and `settingsUpdatedAt.lbpRate` |
| Currency-screen warning | `RateStaleness` in `CurrencyScreen.tsx` | Silent under 3 days, amber from 3, red from 14 |
| Overview alert | `computeDashboard.ts` `rate-stale` | Warning from 14 days, routes to the Currency screen |
| Sync | `syncMerge.ts` `RULE_FIELDS`; `syncSeen.ts` `SETTING_FIELDS.lbpRate` | Rate and stamp merge as one setting; a two-sided clash goes to the later `settingsUpdatedAt` |

The original "rate staleness" item lives in the uncommitted old queue and was not read (by instruction), so its original wording is UNKNOWN.

## 2. Where the request and the code disagreed

| # | Request | Code | Outcome |
|---|---|---|---|
| C1 | Warn after N days | Fixed at 14, no setting | Owner: keep 14. No Phase 4. |
| C2 | Show the age where currency is converted | 22 component/app files convert | Owner: entry form only, when LBP is selected |
| C3 | Update in one tap | A new value must be typed (no outside rate source) | Only "still correct" is one tap: Confirm |
| C4 | A stale rate distorts figures | Live totals correct themselves on update; **LBP records entered while stale keep that rate** (`withRate` → `lbpRateAtEntry`; `rateOn` reads the dated log) | **Open**, see §6 |
| C5 | Everyone gets warned | A never-edited rate never warns (deliberate, tested) | Owner: keep never-edited accounts silent |
| C6 | The stamp means "checked" | Focus/blur on the rate field committed the same value and stamped it | **Fixed** (Phase 1) |
| C7 | Confirm from where you are | `SetupScreen.tsx` notes a single stamping surface | Confirm only on the Currency screen; Overview confirm (Phase 2) not approved |
| C8 | Warn me | Overview shows the top 3 alerts, critical first; `rate-stale` is a warning and can be pushed out | **Open**, see §6 |

## 3. Owner's decisions (2026-11-05)

1. A confirm writes `lbpRateUpdatedAt` and does **not** advance `settingsUpdatedAt.lbpRate`, so a real change always wins a clash.
2. Fix C6 in its own commit, RED first. Keep the broader behaviour: only Confirm marks the rate as checked, and retyping the same value is not an edit.
3. Never-edited accounts stay silent.
4. The rate-age label goes on the entry form only, when LBP is selected.
5. Fixed 14 days; no Phase 4.
6. Phase 2 (confirm from the Overview alert) is not approved.
7. The clash notice wording stays as is.
8. The label's wording was approved as drafted: "Rate L£89,500 per $1, last checked 20 days ago."

## 4. What was built

**Phase 1:**

| Commit | Change |
|---|---|
| `39c8ac7` | `confirmRate(d, now)` in `localData.ts`: stamps `lbpRateUpdatedAt` only. Rate, `lbpRateLog` and `settingsUpdatedAt` untouched. |
| `3c843a0` | C6: the rate field commits only a value different from the stored rate (after clamping). |
| `ad462b6` | "Still L£X per $1 — confirm" button under the Currency-screen warning (from 3 days, 44 px); "Rate confirmed today." for that visit, cleared by a real edit. |

**Phase 3:**

| Commit | Change |
|---|---|
| `454bce3` | `lib/rateAge.ts`: `rateAge(updatedAt, now) → { ageDays, level: "fresh" \| "nudge" \| "stale" } \| null`. The warning and the alert read it. Behaviour unchanged. |
| `2a323b6` | Test pinning the clash notice for a confirm on one device against a change on the other |
| `7f07cf6` | `RateAgeChip`: "Rate L£X per $1, last checked N days ago.", brass from 3 days, coral from 14, silent when fresh or never edited |
| `ac6444f` | Entry form: 2 lines in `InputPanel.tsx`, the chip under the transaction form's currency toggle when LBP is selected. Away from the split-entry legs (`claude/privacy-lb6-mistype-check` works there). |

**Why `confirmRate` is not `recordRateEdit(d, sameValue)`.** Found by a probe before building: that version beat a real change made earlier the same day on the other phone, and the merged rate came back as the old value (89,500 over a real 100,000). It advances `settingsUpdatedAt`, and its same-day log entry carries a later `at`. Swapping that version back in fails 5 of the 9 `confirmRate` tests, including both two-device ones.

## 5. Before-approval checks (§6.5)

1. **What reverses it.** A confirm has no undo, deliberately. `lbpRateUpdatedAt` is overwritten and not restored; it changes no figure, only how long the warning stays quiet (at worst 14 days). Nothing else is written, so there is nothing else to restore or remove.
2. **Which claims are inherited.**
   - "Updating the rate fixes past figures" was re-derived against `withRate` and `rateOn`, and is false (C4).
   - "This entry uses L£X" was rejected as label wording: a backdated entry is priced at its own day's rate.
   - Caller counts at planning: `calendarDaysSince` 2, `recordRateEdit` 1, `withRate` 21 call sites in 5 files, converting component/app files 22.
3. **Units.** `ageDays` is whole local calendar days. The rate is L£ per $1. The stamp is an ISO instant. No USD or LBP amount crosses a new boundary.

## 6. What's left (open)

- **C4: entries made while the rate was stale keep that rate.** By design (F1 / Plan J), an LBP record stores the live rate at entry, and a later rate update does not re-price it. The entry-form label narrows the window in which that happens; it does not correct records already made. Nothing in this work closes it.
- **C8: the Overview alert can be hidden.** `FinancialDashboard.tsx` shows the first 3 alerts with critical ones first, so 3 critical alerts push `rate-stale` out of view. Left alone (rule 3).
- **Wording item: two rate formats.** The app writes the rate two ways. They should become one.
  - "L£ 100,000 / $1": the clash notice (`client/lib/syncService.ts`, `settingValueText` for `lbpRate`) and the Currency screen's stress-test slider (`CurrencyScreen.tsx`, the `stressRate` label).
  - "L£89,500 per $1": the Confirm button (`CurrencyScreen.tsx`) and `RateAgeChip`.
  - The choice is the owner's; changing either side is new wording.

**Noted, not open:**
- The clash notice says "Both devices changed your LBP rate" even when one device only confirmed. The sentence can't tell the two apart. The owner decided to leave it.
- In split mode the entry form shows no rate-age line (the toggle's block is hidden there, and the split legs were deliberately not touched).
- The goal, debt, asset, recurring and transfer forms have currency toggles but no line ("entry form only").

## 7. Verification

- **Baseline before any change:** 2,660 tests passed, 13 skipped, `tsc` clean.
- **After Phase 3:** client 2,703 passed, 13 skipped; `tsc` and lint clean. Server CI steps (build, `typecheck:tests`, 230 tests) green, run with CI's placeholder connection strings and no `.env` present.
- **Real browser at 375 px**, each component on a throwaway page that was never committed:
  - Confirm button: 293 × 44 px.
  - Entry-form line: one line, 295 px wide.
  - No horizontal scroll on either.
  - The full app needs a signed-in session, so a phone check on the preview is still required.

## 8. Live check on the owner's account (Phases 1 and 3 together)

1. The Currency screen shows the warning and the Confirm button with the current rate when the rate is 3 or more days old. The button is easy to tap on a phone.
2. Note one LBP transaction from last month and one from this month, with their dollar figures. Tap Confirm: both figures are unchanged.
3. The warning becomes "Rate confirmed today." The rate field is unchanged. The Overview "LBP rate hasn't been updated" alert is gone.
4. The second device shows the rate as fresh after syncing.
5. Tap into the rate field and out without typing, or retype the same rate: nothing is marked as checked.
6. Change the rate for real: "Rate confirmed today." disappears and the edit saves as before.
7. If possible, confirm on one phone and change the rate on the other before either syncs. After both sync, the changed rate is on both phones and the notice names it as kept.
8. Entry form with the rate 3 or more days old: select L£ LBP and the line appears in amber or red. Select $ USD and it's gone.
9. Add a lira entry while the line shows: it saves as before.
10. After confirming, the entry form with L£ LBP shows no line.
11. "Split across USD and LBP?" on: no line.
12. On a phone, the line fits on one line with no sideways scroll.
