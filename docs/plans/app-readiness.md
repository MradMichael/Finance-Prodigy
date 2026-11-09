# ESSA — App readiness plan

**Status:** website work for phases A0 and A1 is **merged to `main` at `63ceb95`** (2026-11-05, a merge commit; corrected 2026-11-09, session 45: this line read "not merged" after the merge). Every commit ID in section 3 is an ancestor of `main`. Nothing here is marked complete; only the owner does that (ROADMAP Rule 6). The owner's phone check (section 6) isn't recorded here: UNKNOWN.
**Written:** 2026-11-05, from a read-only assessment (2026-11-04) and the owner's decisions since.
**Companions:** `docs/ROADMAP.md` Phase 7 (status and the app gate), `docs/CLAUDE_CODE_BRIEF.md` (standards).
**Public repository:** live bugs are named here by label only. Their details stay in the audit, outside the repo.

---

## 1. Goal and recommendation

Website first, app second, and free if possible.

- **Now: a PWA only.** ESSA can already be installed. It opens offline (app shell precached since 2026-11-02), and a new version waits for the user's "Reload". Cost $0. Updates are instant on deploy.
- **Later, optional: Google Play through a Trusted Web Activity.** Chrome shows the same site, with the same storage and the same privacy model, and web updates need no store review. It needs a custom domain first and `/.well-known/assetlinks.json`. The fee is about $25 one-time (UNVERIFIED). New personal Play accounts may need a closed test before production (tester count and duration UNVERIFIED).
- **Not planned: a native wrapper (Capacitor).** It moves data to a separate container from the website and changes the same-origin privacy model. An iOS build needs a Mac and about $99/year (UNVERIFIED), and thin web wrappers risk App Store rejection.

**The strongest argument against going beyond a PWA:** a store listing doesn't make the data safer. With backup off, the browser holds the only copy. A store app adds fees, review and declarations, and reaches no one a WhatsApp link plus "Add to Home Screen" doesn't already reach.

---

## 2. Owner's decisions (2026-11-05)

| # | Decision |
|---|---|
| D1 | **The session key stays in `sessionStorage`.** An installed app asks for the password on every cold start. Deliberate, not a defect. |
| D2 | **Custom domain deferred** until the owner is ready for Google Play. The PWA stays on `vercel.app` until then. |
| D3 | **Export reminder: 14 days**, shown when backup is off and nothing has been exported. Built by the PWA session (A2). |
| D4 | **App gate:** LB3 and LB6 must be fixed before any app-store work; LB0, LB1, LB2, LB4 and LB5 should be. They're planned as Phase 2.8 in a separate session. |
| D5 | **Scope split:** this plan's session owns A0 and A1. A2, A3 and A4 belong to a separate PWA session. |
| D6 | The Projections test amount gets the whole-number keypad (its code rounds to a whole number). |
| D7 | Sign-in small-print wording, as approved (see A1 below). |
| D8 | The taller date field on touch screens is left as it is for now and logged as a later item (section 5). |
| D9 | The sign-in storage note matches the sign-up caveat: 12 px (`text-xs`) in the main text colour, not muted. |
| D10 | "How your data is stored" is a link on its own line, with a tap area at least 44 px tall. |

---

## 3. Phases

Each phase can ship on its own and ends at a **SAFE STOP**.

### A0 — Roadmap truth pass (docs only). Built.
- `284619f`: status lines corrected to match `main` (2.6.4, 2.7, Phase 7, the bundle figure, the Next.js and React backlog rows), each citing the commit that proves it.
- `072753a`: decisions D1, D2, D3 and the app gate recorded under ROADMAP Phase 7, by label only.
- `366d0e1`: own-work finding logged (Rule 17). A 375 px sweep measured one screen sixteen times because a blocking prompt covered the navigation. Sweeps now check they reached each screen before measuring it. It has no audit number yet; the owner assigns one.
- **SAFE STOP.**

### A1 — Phone correctness. Built.
- `8583cb5`: on a touch screen, fields are 16 px, so iOS doesn't zoom on focus. Desktop is unchanged.
- `0f10982`: on a touch screen, controls are at least 44 px to tap. Desktop is unchanged.
- `d32e3d3`: the password "Show" toggle is 44×44.
- `56eb358`: all 10 number fields name their keyboard: decimal for 7, whole-number for 3, chosen from how each value is parsed.
- `f0b84d3`: the sign-in small print now reads, in the owner's words: "Your data is encrypted and stored in this browser. It's copied to our server only if you turn on backup, and that copy isn't end-to-end encrypted: the server can read it." It's followed by a "How your data is stored" link to `/privacy`.
- `b7e212d`: D9 and D10. The note matches the sign-up caveat's size and colour, and the link sits on its own line, 159×44 at 375 px.
- Tests were written first for each change. Measured at 375 px with touch emulation across all 16 screens: fields under 16 px went from 30 to 0, controls under 44 px from 99 to 9, with no horizontal scroll.
- **SAFE STOP after each commit.**

### A2 — Storage durability. Owned by the PWA session.
`navigator.storage.persist()` with its result shown to the user; the 14-day export reminder (D3); a warning that on iOS the home-screen app and Safari keep separate data.

### A3 — Installability. Owned by the PWA session.
Manifest `id`, `scope`, `screenshots` and `lang`; a dedicated maskable icon; iOS web-app metadata; the favicon precached; an install button, plus "Add to Home Screen" guidance on iOS.

### A4 — Offline hardening. Owned by the PWA session.
A precache that survives one failed file; an end-to-end test of "edit offline, close, reopen online, reaches the server"; and the offline-write report ROADMAP Phase 7 requires before implementing.

### B0–B3 — Google Play (TWA). Deferred (D2).
- **B0:** custom domain, with the server's allowed origin updated.
- **B1:** `/.well-known/assetlinks.json`.
- **B2:** a wrapper built with Bubblewrap or PWABuilder, on the internal testing track.
- **B3:** closed test, Data Safety form matching `/privacy`, then production.
- Each step is a SAFE STOP. None starts before D4's must-fix items are closed.

### §6.5 readiness (applies to every phase above)
1. **What reverses it.**
   - Web changes: revert the commit and deploy; users pick it up with Reload.
   - The service worker and manifest already on phones: `ESSA_SW_KILL=1` empties ESSA's caches, returning the app to network-only.
   - A Play listing: un-publish it (the listing is removed); installed copies keep showing the website.
   - Nothing in A0 or A1 writes user data.
2. **Which claims are inherited.** iOS behaviours (zoom under 16 px, separate home-screen storage, eviction) and every store fee and rule are INFERRED or UNVERIFIED. Each is re-checked on a real device or against current store documentation before anything is built on it.
3. **What units each figure carries.** No money math. Sizes are CSS px; durations are named in days, minutes or ms.

---

## 4. Merging this branch (done)

- **Merged at `63ceb95`** (2026-11-05). The branch `claude/funny-allen-ksej82` was deleted from the remote on 2026-11-09 (session 45), after a check that it was fully in `main`.
- **Rebase: done, 2026-11-05.** `claude/compassionate-edison-f58sbc` merged into `main` (`dadd757`), and this branch was rebased onto it, then again onto `1169e8b` (no conflicts that time) before merging. One ROADMAP conflict, resolved keeping both: this branch's 2026-11-05 note, then `main`'s updated 2026-09-02 note (with its plan H 5a addition). Full suite after the first rebase: 2719 passed, 13 skipped; tsc and lint clean. The result of the second rebase is tested again before merging. The rebase changed every commit ID; the IDs above are the rebased ones.
- **Merge:** into `main` with a merge commit, at the owner's request (2026-11-05).
- **Owner's phone check:** see section 6.

---

## 5. Later items (logged, not scheduled)

- **The date field on touch screens is about 66 px tall**, next to 44 px fields: its segments get the 44 px minimum inside a padded box. Left as it is by decision (D8).
- **Leftover small targets on touch screens:** the date field's DD and MM segments (32 wide × 44 tall, inside a full-height field) and the Projections range slider (excluded by design).
- ~~**The sign-in "How your data is stored" link** is inline in 10 px text, with a tap area of about 112×12.~~ **Done (`b7e212d`, D10):** on its own line, 159×44.
- ~~**The sign-in note is muted 10 px text, while the sign-up caveat is 12 px body text.**~~ **Done (`b7e212d`, D9):** it now matches the sign-up caveat.
- **A decimal keypad may show a comma** in some phone regions. Check that an amount typed with a comma saves.

---

## 6. Live checks on the owner's phone

1. On My Finances, Setup, Trips and Balance Check, tap the amount, description and date fields: no zoom.
2. Number fields: income and amounts show a keypad with a decimal point; payday, emergency-fund months and the Projections test amount show digits only.
3. Small controls are easy to hit: ✕ on Get Started, the ↑↓ priority arrows in Projections, "Recently deleted", the High/Medium/Low buttons, "Show" on sign-in.
4. Sign-in: the storage note reads correctly at the same size as sign-up's, and "How your data is stored" is easy to tap and opens Privacy.
5. On a laptop, check nothing changed.
6. After A2–A4 (PWA session): add ESSA to the home screen, then check whether the installed app sees the account; cold-start it in airplane mode; check the update notice after a deploy.
