# ESSA as an installable app (PWA): plan, decisions, status

**Branch:** `claude/ecstatic-pascal-9307tx`, pushed, **not merged**. `main` is untouched by this work.
**Written:** 2026-11-05, at the close of the build session, for whoever picks this up next.
**Authority:** `docs/CLAUDE_CODE_BRIEF.md` (rules 1–18, §6.5) and `docs/ROADMAP.md` (Phase 7, F6) still govern.
This file records one feature's plan and the owner's decisions; it does not replace either.

## SAFE STOP state

The branch is consistent and shippable as it stands: P1, P2, P3 and P5 are built and pushed. P4 is not started.
Each commit passes its touched tests and `tsc` on its own, except `96903fd` (fails `tsc` with two unused test
declarations; fixed by the very next commit, `d9e875f`). Full suite at `d4c0f99`: 2,729 passed, 13 skipped
(330 files); lint and `tsc` clean.

**Rule 6:** no phase here is complete until the owner confirms it on a real phone. The phone checklist below
has not been reported back yet.

## What already existed before this work (verified in code, 2026-11-04)

- `client/public/manifest.webmanifest`: name, short_name, start_url, standalone, Ledger-ink colours, icons.
- Service worker (session 34, decision 26): `client/sw/build-sw.mjs` writes `public/sw.js` per build; it
  precaches the pages and every build file, never `/api`, and new builds wait for UpdateNotice's Reload.
  The kill switch is `ESSA_SW_KILL=1` (`client/sw/sw-kill.js`).
- `client/components/UpdateNotice.tsx`: "A new version of ESSA is ready. Reload to use it."
- Lazy screens (`client/app/screens.lazy.tsx`), and a content security policy that already allows the
  worker and the manifest (`client/securityHeaders.js`).
- Missing: safe areas (`viewport-fit`, `env()`), any install entry point, maskable-safe icons, iPhone
  page settings, offline wording.

## Phases

| Phase | What | Status |
|---|---|---|
| P1 | Manifest, icons, iPhone page settings | Built and pushed. Awaiting phone check |
| P2 | Standalone display, safe areas, status bar colour follows theme | Built and pushed. Awaiting phone check |
| P3 | Honest offline wording, storage persistence in Profile | Built and pushed, **except the sign-in note** (see below). Awaiting phone check |
| P4 | "Install ESSA" in Profile | **Not started.** Gated (see below) |
| P5 | Version and "Check for updates" in Profile | Built and pushed. Awaiting phone check |

### Commits (from `git log origin/main..HEAD`)

| Commit | Phase | Change |
|---|---|---|
| `334469d` | P1 | Maskable icons inside Android's 80% safe circle (`scripts/build-icons.mjs`) |
| `88f37e9` | P1 | Manifest: `id "/"` (the identity Chrome already used), `scope`, `lang`, `dir`, separate maskable icons |
| `4d3914f` | P1 | `appleWebApp`: title "ESSA", status bar style `default` |
| `53431bb` | P2 | InputPanel.tsx:2159, one class only (owner's exemption): the toast clears the home indicator |
| `c7db6a8` | P2 | The other 8 pinned notices clear the notch and home indicator; `safe-area.test.ts` guards all |
| `71b8f95` | P2 | `viewport-fit=cover`, with the top bar, bottom nav and page sides padded by the insets |
| `5c2f933` | P2 | `<meta name="theme-color">` and the page background follow the active theme |
| `2448033` | P2 | Fix found in the browser: Next reset theme-color on page changes; now put back |
| `96903fd` | P3 | Test-only gate: an edit made offline is uploaded when the connection returns |
| `d9e875f` | P3 | Fix: `96903fd` failed `tsc` (unused copied lines) |
| `8ca3006` | P3 | `lib/useOnline.ts` |
| `7a00cc2` | P3 | OfflineNotice on the home screen (variants A/B) |
| `aea09c1` | P3 | Statement import offline: says it needs a connection instead of blaming the file |
| `15f8216` | P3 | Profile → Your data: "Storage on this device", `persist()` from a button |
| `ef3c211` | P5 | Service worker answers `VERSION` with its build and short commit (`VERCEL_GIT_COMMIT_SHA`) |
| `d4c0f99` | P5 | Profile → App info: version line and "Check for updates" |

## Owner's decisions (2026-11-04 and 2026-11-05)

- **Q1:** InputPanel.tsx:2159 may change one className, layout only, in its own commit. Done (`53431bb`).
- **Q2:** Splash and manifest theme are **Ledger ink** `#0B1F1E`, matching the icon. At runtime the status bar
  follows the user's theme.
- **Q3:** **No iPhone startup images** for now.
- **Q4:** Live checks on the **branch preview with a throwaway account** (deleted afterwards, rule 9). If
  deployment protection blocks installing there, check on production after merge.
- **Q5:** P4's install card is **gated on LB3** (two devices double a goal/EF/debt correction) **and LB6**
  (account deletion misses ~15 server rows), from another audit, and on the owner's iPhone storage check.
- **Q6:** P5 approved: it lets the owner confirm versions on the phone.
- `persist()` runs **only from a button**, never on its own (Firefox answers it with a permission prompt).
- The version line shows the **commit hash** (`VERCEL_GIT_COMMIT_SHA`, documented in `client/.env.example`
  and the README's variable table).
- **Coordination:** another session owns the ROADMAP truth pass (including the Phase 7 status lines) and
  `client/app/sign-in/page.tsx`. Neither was touched here.

### Approved wording (verbatim; each is pinned by a test)

- OfflineNotice A, shown only with backup on and not stopped: "You're offline. Changes are saved on this device and back up when you reconnect."
- OfflineNotice B, every other case: "You're offline. Changes are saved on this device."
- Import offline: "Reading a statement needs an internet connection right now. Connect, then try again. Nothing was imported."
- Storage heading "Storage on this device"; button "Ask this browser to keep it"; lines:
  - kept: "Your browser has agreed to keep ESSA's data on this device even when space runs low. Clearing site data or uninstalling still removes it."
  - not yet: "This browser may clear ESSA's data from this device if it runs low on space. Keeping backup on, or downloading your data, is what protects it."
  - declined: "This browser said no. It may still clear ESSA's data if it runs low on space. Keeping backup on, or downloading your data, is what protects it."
  - unsupported: "This browser doesn't say whether it keeps ESSA's data. Keeping backup on, or downloading your data, is what protects it."
- Version: "Version 2448033 (build KfybncMp)", "Version: build KfybncMp" (no commit), "Version not available in this browser."
- Check: "Check for updates", "Checking…", "You have the latest version.", "A new version is downloading. You'll see a Reload prompt when it's ready.", "A new version is ready. Use Reload at the bottom of the screen.", "Couldn't check for updates: you're offline.", "Couldn't check for updates. Try again in a minute."

## What's left

1. **The owner's phone checklist** (below), on the branch preview. Not reported back yet.
2. **The iPhone storage result.** With backup off, does the home-screen app see the account created in
   Safari? This decides P4's warning wording. Widely reported, not verified here: iPhone home-screen apps keep
   storage separate from Safari.
3. **P4: "Install ESSA" in Profile.** Not started. Gated on LB3, LB6 and item 2. Plan as approved in outline:
   - A `beforeinstallprompt` listener in the layout (cancels the browser's own mini-bar, keeps the event).
   - A pure `installMode()` returning `prompt` | `ios-instructions` | `installed` | `unsupported`.
   - A card in App info:
     - Android: an Install button.
     - iPhone: Share → Add to Home Screen steps, plus the storage warning if item 2 confirms it.
     - Already installed: says so.
     - Otherwise: nothing.
   - Never a popup. Wording goes to the owner before any commit.
4. **The sign-in offline note.** Drafted, not built, waiting for the other session's sign-in branch to merge:
   "You're offline. On a device you've signed in on before, your password works without a connection.
   Signing in on a new device needs one." Not yet approved as final.
5. **ROADMAP Phase 7 status (rule 8).** Not updated, because the other session owns those lines. Once that
   branch merges, Phase 7 should name this branch and its state. Until then the ROADMAP doesn't mention it.

## Known limits, not fixed (rule 16)

- **Weak connections that claim to be online.** On a connection the browser reports as online that doesn't
  work, a failed statement import still blames the file. The offline notice also follows only the browser's
  online flag.
- **iOS older than 16.4.** Next 15 emits `mobile-web-app-capable`, not `apple-mobile-web-app-capable`; iOS
  16.4+ goes standalone from the manifest, so older iOS may open ESSA as a Safari page.
- **The statement reader after updates.** The PDF reader is saved on first use and dropped at every update
  (each build has its own runtime cache), so an offline import after an update needs one online use first.
  The wording doesn't claim otherwise.
- **Password on every launch.** The installed app asks for the password on every launch: the key is in
  sessionStorage. This is an existing security design, not changed here. It works offline on a device that
  already has the account.
- **Variant A not seen in a real browser.** Seeing it needs backup on, which needs the API server; it isn't
  covered by the browser runs here, only by tests (`app/page.offline-notice.test.tsx`,
  `app/page.offline-edit-retry.test.tsx`).
- **Real iPhone insets** can't be simulated in Chromium; only a phone confirms P2.
- **About 110 KB more to download at install** (the two maskable icons).

## Reversing it (§6.5)

- Manifest, icons, CSS and UI: reverting the commits removes them. Icons already installed stay: Android
  refreshes its copy; iPhone never does.
- Service worker: the existing kill switch (`ESSA_SW_KILL=1`).
- `persist()`: a browser's "yes" can't be withdrawn by the app; only clearing site data takes it back.
  Deliberately left standing.
- No phase writes or changes financial data.

## Own-work slips, recorded (rule 17)

1. **Plan's count.** The plan counted 7 pinned notices; there were 9 (`app/page.tsx:845`, `:865` missed).
   Corrected in `c7db6a8`.
2. **Unrun test before a commit.** A P2 commit was made before running `components/phone-layout.test.tsx`,
   which pinned the old positions. Both affected commits were rewritten before they were pushed.
3. **Theme-colour test too weak.** `5c2f933` set theme-color once and its tests couldn't see Next resetting
   it on page changes. Found in a production-build browser check; fixed in `2448033`.
4. **No `tsc` before a pushed commit.** `96903fd` was committed and pushed without running `tsc`, which checks
   test files. Fixed in `d9e875f`; `96903fd` is the one commit on the branch that fails `tsc` alone.
5. **Leak test that couldn't fail.** `useOnline`'s first unmount test would have passed with a leaking
   listener. Replaced before commit with one confirmed to fail.

## Phone checklist (branch preview, throwaway account; delete it afterwards, rule 9)

If installing doesn't appear on the preview, deployment protection is probably blocking the manifest. Check on
production after merge instead (Q4).

**P1:**
- The icon isn't clipped in the Android launcher shape.
- The name is "ESSA" on both phones.
- The Android splash is ink with the brass E.
- Both phones open with no browser bar.
- iPhone storage check (item 2 above).

**P2:**
- At 375 px, nothing is under the notch, status bar or home indicator.
- The bottom nav and toasts clear the home indicator.
- The Android status bar follows a theme change, and keeps it after visiting Profile.
- The iPhone status bar is readable on Ivory and Ledger.
- In landscape, content clears the notch and the side strip is the theme colour.

**P3:**
- Airplane mode, fully close the app, reopen: sign-in works with the password, and the data shows.
- The offline strip appears, with wording A when backup is on and B when it's off.
- Add a transaction offline, reconnect: the sync dot shows "Synced".
- An offline statement import (on a fresh install or after an update) shows the connection message.
- Profile → Your data shows a storage line; pressing the button gives a "kept" or "said no" line.

**P5:**
- Profile → App info shows "Version <commit> (build …)" matching the branch head on GitHub.
- After a new deploy, "Check for updates" says a new version is ready; Reload switches to it and the version
  changes.
- Offline, it says "Couldn't check for updates: you're offline."
