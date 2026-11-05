# Travel map: plan and status

An extension of the existing Trips screen (`client/lib/trips.ts`, `client/components/screens/TripsScreen.tsx`): a world map of the countries visited, a sheet of the trips in a country, city markers, and the trip list grouped by year. Read with `docs/CLAUDE_CODE_BRIEF.md`, which stays the authority on standards and standing rules.

**Status (2026-11-05):** Phase 0 and Phase 1a are built, merged and verified live by the owner. **Phase 1b is merged at `2077aa4`** (owner-approved). **Phase 1c is approved and in progress** on `claude/travel-1c` (not merged). Phase 2 has no plan yet.

**Rule 8:** the status line above and the phase status lines below change in the same commit as the work that changes them.

---

## 1. Scope

**Who it's for:** the owner first, then cohort users who travel. The Lebanese diaspora travels often.

**Which question it serves, plainly:** only **Spend**, through the existing trip budget. The map itself serves none of Earn, Spend, Save or Achieve. Brief §1 says *"Features that do not serve one of these four questions are out of scope."* The owner treats this as a **known tension, not a blocker**, and chose to plan it anyway. It stays an open item (§7).

---

## 2. Decisions (owner; not to be reopened)

| # | Decision |
|---|---|
| D1 | Extend the existing trips and trip budgets; don't rebuild them. |
| D2 | **No Prisma changes, no SQL views.** Data lives in the sync JSON blob (`user_sync.dataJson`). The server tables have not been written since 2.4.132 (`server/src/routes/sync.ts`), and no outside tool reads the Neon tables (owner). |
| D3 | Dates are stored as `YYYY-MM-DD` strings and shown as **DD/MM/YYYY, with slashes**, matching the app (`fmtDate`, `dayLabel`). |
| D4 | Trips use **deletion records** (`recordDeletion`, `deletedKeys.trips`), not the 30-day soft delete, which is for transactions only. A trip's cities live inside it and are deleted with it. |
| D5 | **Bundled map only:** world-atlas `countries-110m` + `d3-geo` + `topojson-client`, lazy-loaded. Small countries the 110m shapes leave out are drawn as dots. No tile servers and no geocoding; the content policy (`img-src 'self'`, `connect-src 'self'`) blocks them anyway. |
| D6 | City data: **one** bundled GeoNames `cities15000` file, loaded the first time a trip form opens. Not one file per country. The GeoNames CC BY credit goes on the About page. The city field always accepts free text. *As built (1b):* the New trip form is always on the Trips screen, so "opens" is read as the first time a form needs the list: tapping "Add a country" or "Add a city", or focusing a city box. Opening the screen fetches nothing. |
| D7 | **Trip dates only;** stops have no dates of their own. |
| D8 | A **blank trip name defaults to the country names**, in English, in route order, each once ("France, Italy, Malta"). A name left blank when editing re-fills from the countries the trip has after the edit. A blank name with no countries is still refused. |
| D9 | **Budget line at 0:** budget 0 with spending shows "Spent $X" in plain text (no "over", no coral); no line at all when spending is also 0. A budget above 0 keeps today's line unchanged. |
| D10 | **Exchange rows stay counted as Wants** in their month (`lib/foreignCash.ts`). Out of scope. |
| D11 | A bad stop is **refused** (reason `"stops"`), with one message line in `TripsScreen`. Its wording is APPROVED (§5). |
| D12 | **Visited vs planned:** a trip counts as visited only if its start date is today or earlier (the device's local calendar day). Later trips are **planned**: a distinct style on the map (dashed brass outline) and labeled "Planned" in the country sheet. Detail in Phase 1c. |
| D13 | Each phase gets its own branch: RED tests first, then GREEN, one concern per commit, merged with a merge commit (no squash) after the owner's live check. |
| D14 | **"Place on map" is in Phase 1c,** not 1b (owner, 2026-11-05): placing a typed city needs the map. In 1b, a city picked from the list (or typed exactly as the list writes it, accents aside) gets its point; any other typed city gets none until 1c. |

---

## 3. Built

### Phase 0: `editTrip` keeps fields it doesn't set. Merged at `464d376`, verified live.

- **Before:** `editTrip` rebuilt a trip from the form's fields only, so a field newer code wrote (a trip's cities, its notes) was dropped on edit.
- **Now:** it starts from the stored trip, takes out the fields the form sets (name, dates, budget, category budgets, edit time), then applies the form's values. Clearing every category budget still removes them.
- **Commits:** `4715b6a` (RED), `76319d3` (GREEN).
- **What it doesn't fix:** it protects only devices running it. That's why it merged first, and every device was reloaded before 1a.

### Phase 1a: model and helpers, no UI. Merged at `4cecaba`, verified live.

**The country list** (`b3f935b` RED, `b537bc3` GREEN)
- `client/public/geo/countries.json`: 250 rows `[code, numeric, lat, lon]` (ISO 3166-1 plus Kosovo `XK`, which has no numeric code). **6,607 bytes raw, 2,992 gzipped**, and precached.
- Centroids sit on each country's largest piece of land.
- 11 territories have no shape of their own in Natural Earth (BQ BV CC CX GF GP MQ RE SJ TK YT). They take GeoNames' own point for the territory; the ids are listed in the script.
- `client/lib/countryCodes.ts` (1,768 bytes) holds the same codes, for validating a trip without loading the file. `lib/countries.test.ts` keeps the two in step.
- Both are generated by `client/scripts/build-geo.mjs`, run by hand against packages installed into a separate folder. It adds no dependency to the app.

**The trip model** (`8d77758` RED, `cf4f771` GREEN)
- `StoredTrip` gains optional `stops: TripStop[]`, in route order. A stop has a `countryCode` (ISO alpha-2), an optional `city`, and `lat`/`lon` in WGS84 degrees, both or neither.
- It also gains optional `notes`.
- `buildTrip` checks and tidies stops:
  - an unknown country, or coordinates that are unpaired, not numbers or out of range, are refused with reason `"stops"`;
  - city names are trimmed;
  - a country named again without a city is dropped.
- `defaultTripName` implements D8.
- `editTrip` keeps the trip's own stops and notes when an edit doesn't send them, so today's form behaves exactly as before.
- The sync engine is unchanged; stops ride inside the trip:
  - a change on one device is taken;
  - changes on both devices: the later edit wins the **whole trip**, and the notice names "the trip";
  - deletion, reset and restore behave as for trips today.
- **Size check:** 300 trips × 10 stops with notes is under 1 MB, against the backup's 2 MB limit.

**Map helpers** (`653019a` RED, `f4a58d4` GREEN)
- `client/lib/travel.ts`: `visitedCountries`, `tripsInCountry` (newest first, with a stable tie-break), `cityMarkers` (one per place with coordinates).
- They're read-only, and nothing calls them yet.
- They currently count every trip, whatever its dates. D12 changes this in 1c.

**Readers of a trip's name:** 6 files, re-counted at the start of 1a: the trip pickers in `ImportStatement`, `ForeignCashForms`, `InputPanel` and `EditTransactionSheet`; `TripsScreen`; and the sync notice via `syncMerge`. A default name is stored as an ordinary name, so all six read it unchanged.

**Test results on merged `main` (`4cecaba`):**
- client: 2,696 passed, 13 skipped (the skips predate this work); `tsc` and lint 0;
- server: 230 passed, 13 skipped; its test typecheck 0.

### Phase 1b: the form, the list, the city file, the budget line, the credit. Merged at `2077aa4`.

Cut fresh from `main` at `46c9a0b`. Every new string is the owner's APPROVED wording (§5). First commit: `c95f0a8`, this doc's status line (rule 8).

**The city file** (`6ce2317` RED, `2d22b46` GREEN)
- `client/public/geo/cities15000.json`: 34,197 rows `[name, country, lat, lon]` from GeoNames' dump dated **2026-11-04**. The source and date are written in the file.
  - Names are kept as GeoNames writes them, accents included; coordinates are rounded to 2 decimals; rows are sorted by country, then name.
  - **1,113,819 bytes raw, 367,963 gzipped.** One row per line, for readable diffs, costs about 33 KB raw over the plan's compact measure; sorting saves about 3 KB gzipped.
- `scripts/build-geo.mjs`, given the unzipped `cities15000.txt` and its date, writes it; `countries.json` regenerates byte-for-byte.
- Every row's country is in `countryCodes.ts` (checked). Lebanon has 18 rows, Zahlé among them; Batroun isn't one.

**Delivered on first use, never precached** (`82dc0b1` RED, `7903ebe` GREEN)
- `/geo/cities15000.json` joins the PDF worker on the service worker's first-use list.
- That list is written in two files, `sw/build-sw.mjs` and `sw/sw-template.js`, and a test now keeps them equal.
- Production build checked: the city file appears only in the worker's first-use set; `/geo/countries.json` is precached; no JavaScript chunk contains city data.

**Picking places** (`1e13276` RED, `8559c1e` GREEN)
- `client/lib/places.ts`:
  - `countryName` and `searchCountries`: browser names, accents and case aside;
  - `searchCities` and `findCity`: one country at a time, so "zahle" finds "Zahlé";
  - `loadCities`: fetched once from `/geo/cities15000.json`, its path alone. A failure, or an error page, is forgotten, so the next call asks again.
- A source scan fails the build if any client file puts a city, country or coordinate in a URL query.
- Own-work note (brief rule 17): one run of that scan failed in 6 ms and was never reproduced in four reruns. The likeliest cause is that run starting outside `client/`, because the scan rooted itself at `process.cwd()`. It now roots itself at its own folder.

**Budget line at 0, D9** (`39f92b9` RED, `e48ee12` GREEN)
- A budget above 0 keeps its line unchanged.
- At 0: "Spent $X" in the text colour while anything was spent (`moneyEquals`, so float dust counts as nothing); no line otherwise.
- The figure is `tripActual`'s, USD, as before.

**The form** (`a541f75` RED, `2aa3fca` GREEN)
- `client/components/travel/StopFields.tsx`: one row per country, in route order (France, Italy, then France again is three rows), each with its cities.
- Countries are picked by name. A typed, unpicked country counts **only by its exact name**: its text is never read as a code, so "it" never becomes Italy. Anything else is passed as `""`, so `buildTrip` refuses it with the approved line.
- Cities are picked from the file or typed. A typed city the file holds takes the file's spelling and point. One it doesn't hold is saved as typed, with no point, and the form says it won't be on the map.
- `TripsScreen`:
  - adds Notes;
  - holds the city file's state, and asks for the file only when a form needs it (D6);
  - the edit form loads the trip's stops and always sends them back, so an edit keeps every stop, ids included, and removing every country clears them.
- `REASONS.stops` now carries the approved line.

**The list** (`73ac874` RED, `8fa3d7e` GREEN)
- Trips are grouped under the year they start in (an `h2`), newest first; a trip's name is now an `h3` under its year.
- Each card shows its places in the approved format, with cities grouped under their country and countries in the order first visited: "France · Paris, Lyon — Italy · Rome — Malta". It also shows its notes.

**The About page credit** (`0316b49` RED, `eacbf25` GREEN)
- A "Map and place data" section in the approved words.
- "geonames.org" links to `https://www.geonames.org/` and "Creative Commons Attribution 4.0" to `https://creativecommons.org/licenses/by/4.0/`. Same tab, underlined, `rel="noopener noreferrer"`.

**Results on `claude/travel-1b`**
- Client: **2,738 passed**, 13 skipped (the skips predate this work); `tsc` and lint 0.
- Production build passes. Compared with `main` built the same way, the Overview (`/`) first load is 287 kB against 288 kB (no growth; the 1 kB difference is most likely rounding and chunk naming, not a real saving), and `/about` grows by 0.18 kB.
- Server: unchanged by 1b.

**Merged** at `2077aa4`, a merge commit (no squash), approved by the owner, onto `main` at `06ff376`. `main` had moved 65 commits since 1b was cut, among them the PWA, app-readiness A1 (44 px controls and 16 px fields on touch screens, applied by a global rule in `globals.css`, which covers 1b's controls) and Phase 2.8.5 (sync merge). No conflicts. On the merged result: client **2,932 passed**, 13 skipped; `tsc` and lint 0; server 230 passed, 13 skipped, its test typecheck 0.

**Owner's live check (for 1b on `main`)**
- On a phone at 375 px: a trip with no name and France (Paris, Lyon), Italy (Rome), Malta, and a typed "Batroun" (Lebanon), saves as "France, Italy, Malta, Lebanon". Its card reads "France · Paris, Lyon — Italy · Rome — Malta — Lebanon · Batroun", countries in route order.
- Typing "zahle" offers Zahlé.
- "Batroun" shows "Not in the list. It'll be saved as you typed it, but won't appear on the map."
- DevTools → Network: opening Trips fetches no city file; the first "Add a country" fetches `/geo/cities15000.json` once; after that it loads from the worker's cache, airplane mode included.
- A past trip with a $0 budget shows "Spent …", or no line, and never coral "over".
- Year headings, newest first.
- Edit a trip's budget only: its countries, cities and notes stay.
- The other device matches after sync.
- Edit cities on one device and notes on the other while both are offline, then sync: one edit wins, and the notice names the trip.
- The About page shows the credit, and both links open.
- **After a deploy,** the city file downloads again on its next use; that's known, and the fix is an open item (§7).

---

## 4. Planned

### Phase 1c: the map

**Status: approved, in progress** on `claude/travel-1c`, cut from `main` at `a476736`.

**Files:** `components/travel/TravelMap.tsx`, `components/travel/CountrySheet.tsx`, `components/travel/StopFields.tsx` ("Place on map", D14), the dependencies `d3-geo` and `topojson-client`, `public/geo/countries-110m.json`.

**Sizes (measured):**

| Item | Raw | Gzipped |
|---|---|---|
| `countries-110m.json` (177 shapes; precached) | 107,761 B | 38,495 B |
| `topojson-client@3.1.0` | 7,169 B | 2,628 B |
| `d3-geo@3.1.1` | 36,329 B | 13,077 B |
| `d3-array@3.2.4` (d3-geo's dependency) | 17,204 B | 5,988 B |

- The map code is about 22 KB gzipped, behind a dynamic `import()` that runs only when the Map view opens. It's kept out of `TripsScreen`'s own chunk, because `preloadScreens` fetches every screen.
- **Added to the Overview's first load: 0.**
- The 110m set has 177 shapes, 64 fewer than the 50m set's 241. The missing ones include Malta, Singapore, Bahrain, Monaco, Vatican, Andorra, Maldives and Hong Kong. Any country in `countries.json` without a 110m shape is drawn as a dot at its centroid.
- Three shapes have no id: N. Cyprus, Somaliland and Kosovo. Kosovo is matched by name as `XK`; the other two can't be picked.

**The map**
- Unvisited countries: `panelSoft` fill with a `line` border.
- **Visited:** `brass30` fill with a solid `brass` border.
- **Planned only (D12):** a dashed `brass` border and no fill. Planned dots are hollow and dashed. The dash pattern, not colour alone, tells the two apart.
- A country with both a past and a planned trip is drawn as **visited**.
- Cities are `jade` dots with an `ink` halo; planned cities use the planned style. `coral` is not used.
- All colours come from `useTheme`, so all 6 themes work.
- Controls: "Show my countries" (zooms to fit them), plus zoom buttons and drag.
- Small-country dots have a 44 px tap area.
- Below the map, a "Countries visited (N)" list of buttons is the keyboard and screen-reader route. It includes planned-only countries.

**The country sheet**
- A bottom sheet on phones, a side panel on wider screens.
- Each trip shows its name, `DD/MM/YYYY – DD/MM/YYYY`, and its cities in that country, newest first.
- Planned trips carry the **"Planned"** label. They appear at the top, because newest-first order puts later starts first.
- Tapping a trip jumps to its card in the List.

**"Place on map" (D14):** a typed city's row gets a "Place on map" button that opens the map to tap its point. The stop's `lat`/`lon` then come from the tap, in WGS84 degrees, checked as `buildTrip` already checks them. The not-in-the-list line changes to its approved 1c wording (§5).

**Helper changes (D12):** `visitedCountries`, `tripsInCountry` and `cityMarkers` take a `today` argument (local calendar day, from `todayCalendarDay`).
- `visitedCountries` returns visited countries and planned-only countries separately.
- `tripsInCountry` and `cityMarkers` mark each trip visited or planned.
- The comparison is a plain `YYYY-MM-DD` string compare.

**Tests to write first (RED before GREEN)**
- The map: one path per country, with visited ones marked; a visited small country gets a dot.
- Tapping a country opens the sheet with the right trips, dates in DD/MM/YYYY, and that country's cities.
- The keyboard list opens the same sheet.
- "Show my countries" fits the visited ones.
- Visited vs planned:
  - a trip starting today is visited, one starting tomorrow is planned, one that started yesterday and ends next week is visited;
  - a country with both shows as visited, and the sheet labels each trip;
  - the boundary near midnight in Beirut follows the existing date-boundary tests;
  - the "Planned" label renders.
- The map module isn't statically imported by `TripsScreen` (following `screens-lazy.test.tsx`).
- The content-policy test is unchanged.
- Contrast of the solid and dashed brass borders and the dots on `panelSoft`, all 6 themes (`theme.contrast.test.ts`).
- 375 px, no horizontal scroll (following `phone-layout.test.tsx`).
- Loading, over-10-seconds and error states.
- "Place on map": a typed city given a point by a tap is saved with it, and the not-in-the-list line reads its 1c wording.

**SAFE STOP.**

**Owner's live check**
- France, Italy and Malta highlighted, Malta as a dot; cities in the right places.
- Tap France: the trip, its dates, Paris and Lyon.
- "Show my countries" zooms to Europe.
- A trip starting next month shows dashed, and the sheet says "Planned". After its start date it shows filled, with no change on your part.
- All 6 themes readable.
- The map works in airplane mode after one visit.
- Overview loads no map files.
- No request leaves the app's own site.

---

## 5. Wording: APPROVED by the owner, 2026-11-05

Every item that was HELD is now APPROVED, some with changes; the text below is the final text. Nothing new may reach the UI without the same approval.

**Used in Phase 1b (built):**

| # | Where | APPROVED wording |
|---|---|---|
| 1 | Refusal for a bad stop (`TripsScreen.tsx`, `REASONS.stops`) | "One of the countries or cities couldn't be saved. Check them and try again." *(changed from the draft)* |
| 2 | City list failed to load (form) | "The city list couldn't load. You can still type a city." |
| 3 | About page section | Heading: "Map and place data". Text: "Country shapes: Natural Earth (public domain), via world-atlas. City names and locations: GeoNames (geonames.org), licensed under Creative Commons Attribution 4.0." **"geonames.org" links to the site; "Creative Commons Attribution 4.0" links to the licence page** *(owner's addition)* |
| 4 | Form section and controls | "Countries and cities", "Add a country", "Add a city", "Notes" |
| 5 | Trip card places line | Format "France · Paris, Lyon — Italy · Rome"; a country with no city is its name alone ("Malta") |
| 6 | Country field | Label "Country", placeholder "Type a country" |
| 7 | City field | Label "City", placeholder "Type a city" |
| 8 | Typed city not in the list | **1b:** "Not in the list. It'll be saved as you typed it, but won't appear on the map." *(changed)* **1c, once "Place on map" exists:** "Not in the list. It'll be saved as you typed it. Use Place on map to show it on the map." |
| 9 | Remove buttons | "Remove", with a screen-reader label naming the row ("Remove Lyon", "Remove France") |

**For Phase 1c (approved now, not yet used):**

| # | Where | APPROVED wording |
|---|---|---|
| 10 | Map empty state | "Your travel map. Add a trip with the countries and cities you visited and they'll appear here. The map is drawn on your device; your places aren't sent to any map service." *("phone" changed to "device")* Button: "Add a trip" |
| 11 | Map loading, past 10 seconds | "Still loading the map…" |
| 12 | Map failed to load | "Couldn't load the map. Your trips are safe. They're all in the list." Button: "Try again" |
| 13 | Country sheet, a future trip (D12) | "Planned" |
| 14 | Map controls and list | "Map", "List", "Show my countries", "Countries visited (N)" |
| 15 | Placing a typed city (D14) | "Place on map" |

**Decided earlier, so never held:** the budget line at 0 ("Spent $X", D9) and the default trip name format ("France, Italy, Malta", D8).

**Year headings** in the list are the bare year ("2025"), with no wording.

---

## 6. Brief §6.5 checks, for the remaining phases

1. **What reverses it.**
   - Deleting a trip: its stops are removed with it, and a deletion record syncs the deletion. Tagged rows keep their tags (deliberately left standing, an existing decision).
   - Editing stops or notes overwrites them, with no captured earlier state (deliberately, as trip edits are today).
   - A filled-in default name is an ordinary stored name.
   - The map changes nothing; it only reads.
2. **Which claims are inherited.** Re-derived at the end of 1b (2026-11-05); re-derive again before 1c is built:
   - the readers of a trip's name: still **6** (the trip pickers in `ImportStatement`, `ForeignCashForms`, `InputPanel` and `EditTransactionSheet`; `TripsScreen`; the sync notice via `syncMerge`), re-counted by grep;
   - the city file's size: re-measured from the committed file (§3);
   - the service worker's precache rule: still "every file under `.next/static` and `public/` except `ON_FIRST_USE`", read from `sw/build-sw.mjs` and checked in the production build.
3. **What units each figure carries.** Coordinates in WGS84 degrees; country codes ISO alpha-2; dates as local `YYYY-MM-DD` calendar days; the budget line in USD (`budgetUSD`, `totalUSD`); file sizes raw or gzipped as labelled.

---

## 7. Open items

- **Phase 2: a trip budget in a foreign currency.** No plan yet; it gets its own.
  - **Already built:** USD trip budgets, per-category USD budgets, foreign-cash sheets, exchange cost per currency, and euro spends shown approximately in USD.
  - **The gap:** setting a budget *in* EUR. A likely shape is `budgetNative?: { amount; code }` beside `budgetUSD`, never added to a USD figure. Money tests come first (brief rule 4).
- **Brief §1 scope tension.** The map serves none of Earn, Spend, Save or Achieve; only the trip budget serves Spend. The owner accepted this as a known tension, not a blocker. The strongest argument against building it now: about 60 KB more to download at install, plus four releases, while cohort items in `docs/ROADMAP.md` (for example the monthly disposable-capacity figure) stay open.
- **Open item (owner-approved fix, 2026-11-05): cache first-use files (city file, PDF worker) by content hash, so they re-download only when the file changes; own commit, service worker tests first.**
  - Why: the worker's runtime cache is named per build (`essa-runtime-<build>`), so today every deploy makes the next use fetch the 368 KB city file and the PDF worker again.
  - Found in 1b and deliberately not changed there; it's not part of 1c either.
- **Risks carried into 1c:**
  - 368 KB over Lebanese mobile data the first time a form needs the city list, and again after each deploy (above);
  - small countries hard to tap at 375 px (hence the dots and the list);
  - typed cities get no marker until "Place on map" (1c);
  - tapping country shapes on iOS Safari needs checking on a real phone;
  - a stored stop with a code a future country list drops would make that trip's edit refuse until the stop is fixed.
