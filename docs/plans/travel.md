# Travel map: plan and status

An extension of the existing Trips screen (`client/lib/trips.ts`, `client/components/screens/TripsScreen.tsx`): a world map of the countries visited, a sheet of the trips in a country, city markers, and the trip list grouped by year. Read with `docs/CLAUDE_CODE_BRIEF.md`, which stays the authority on standards and standing rules.

**Status (2026-11-05):** Phase 0 and Phase 1a are built, merged and verified live by the owner. **Phase 1b is merged at `2077aa4`** (owner-approved). **Phase 1c is merged at `06b4bec`** (owner: preview checked, CI green). **Phase 1, the travel map, is complete.** A **map design pass** (owner, 2026-11-05) is **merged at `bbfbc42`** (owner: preview and screenshots checked). Phase 2 has no plan yet.

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
| D15 | **Trips opens on Map once any trip has a country; otherwise on List**, as Trips always has (owner, 2026-11-05): an account whose trips have no countries isn't shown an empty map over its trip cards. |
| D16 | **Under the map:** "Countries visited (N)", N counting visited countries only; below it "Planned (N)", the countries with only planned trips, by name (owner, 2026-11-05). A country with both is under "Countries visited" only. The map picture is hidden from screen readers; these lists are their route. |
| D17 | **The map opens fitted to the visited countries** (the "Show my countries" view), on what lights of them (D20); the whole world only when nothing is visited (owner, design pass). Planned-only countries aren't part of the opening view; "Show my countries" still fits visited and planned. |
| D18 | **Visited countries stand out:** a strong brass fill (`brass70`, brass at 0xB0), 3:1 on unvisited land in every theme, with a thin ink outline so neighbouring visited countries stay apart. Planned keeps its dashed brass outline on plain land (owner, design pass). |
| D19 | **Small-country dots only for visited or planned countries,** drawn larger than a city marker so their brass shows round a city in them (owner, design pass). |
| D20 | **Overseas pieces: rule B at 650 km** (owner, design pass). A country's largest piece is its mainland; pieces within 650 km of the mainland, or of another home piece, are home; the rest are overseas, and overseas pieces within 650 km of each other form a group (Hawaii; Alaska; Svalbard). Per trip and country, the groups holding its cities' points light (50 km of slack for coarse coasts); if none of its stops there has a point, the home group lights. Groups add up across trips. A territory with no shape of its own (French Guiana GF, Svalbard SJ, and the other TERRITORIES) lights its parent's group that holds its point, and tapping that piece opens the territory. 650 km, not the 500 first proposed: measured, 500 made Peninsular Malaysia (603 km from Borneo) overseas. |
| D21 | **Desktop:** in Map view the map, and (5b, owner after the screenshots) the page header and the Map | List toggle, break out of Trips' 768 px column to the main area's width, capped at 1,152 px (`max-w-6xl`); the New trip form keeps the column, and List view is unchanged; a country's sheet opens below the map at its width, its trips in two columns; phones keep the bottom sheet (owner, design pass). |
| D22 | **"Countries visited (N)" is hidden when N is 0** (owner, design pass; replaces 1c's "(0)" heading). |

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

### Phase 1c: the map. Merged at `06b4bec`.

Cut from `main` at `a476736`. Every new string is APPROVED wording (§5). Pushed after every commit (owner, mid-phase). First commit: `c90656a`, the status line (rule 8).

**Visited or planned, D12** (`76a4025` RED, `428190e` GREEN)
- `lib/travel.ts` takes `today`, the device's local calendar day (`todayCalendarDay`). `isPlanned` is true when a trip starts after today.
- `visitedCountries` returns `{ visited, planned }`; a country with any trip that has started is visited only.
- `tripsInCountry` marks each trip. A city marker is planned only when every trip there is.
- A Beirut-leg test pins that the local day decides: 00:30 on 6 November in Beirut is the 6th.

**The country shapes** (`1c7955a` RED, `7c9ef95` GREEN)
- `public/geo/countries-110m.json` is world-atlas 2.0.2's file, copied as is by `scripts/build-geo.mjs`: **107,761 B raw, 38,495 B gzipped**.
- It's precached; the production build's worker lists it.

**The geometry** (`c85ef99` RED, `6fc2fbd` GREEN)
- `lib/worldMap.ts`:
  - shapes keyed to ISO codes through the country list's numeric column, with Kosovo matched by name;
  - dots for the 75 listed countries without a shape;
  - Equal Earth, 960 × 468 SVG units, with `invert` for a tap;
  - `bounds()` fitted on each country's largest land, so France's view leaves out French Guiana;
  - `loadWorld` fetches both files once, by their paths alone.
- Dependencies, at the exact versions measured: `d3-geo` 3.1.1 and `topojson-client` 3.1.0, plus their types as dev dependencies. `d3-geo`'s `d3-array` is the one recharts already brings.
- **The lockfile was edited by hand, deliberately:** it's the old lockfile plus the 7 new entries. npm 10.9.9 and 11.6.2 would both also have dropped the `libc` fields of 35 native packages, which is unrelated to this change. `npm ci` installs from it cleanly.

**The map and its panel** (`054d7b5` RED, `86c46c1` GREEN)
- `components/travel/TravelMap.tsx` draws the map:
  - visited countries: a soft brass fill (decoration) and a **solid brass border**;
  - planned-only: a **dashed brass border** on plain land;
  - small countries as dots, with a 44 px tap area sized from the measured drawn width;
  - jade city markers with an ink halo; planned ones hollow and dashed;
  - "+"/"−" zoom (read "Zoom in"/"Zoom out"), drag (never taken for a tap), and "Show my countries";
  - hidden from screen readers.
- `components/travel/MapPanel.tsx`: the empty state (nothing fetched), a placeholder, the past-10-seconds line, and the failure line with "Try again".
- **Contrast (WCAG 1.4.11, 3:1), all 6 themes**, measured from the tokens:
  - brass border on land 6.2–11.2:1; on the sea 7.4:1 and up; on its own fill 4.6–7.0:1;
  - jade markers on land 6.0:1 and up; on the brass fill 4.0:1 and up;
  - the fill itself is 1.3–1.6:1 against land, so it is decoration and nothing relies on it.

**The country lists and sheet** (`b9e9d6a` RED, `4ab37f1` GREEN, then `49d2c1a`)
- Under the map: "Countries visited (N)" and "Planned (N)" (D16).
- `components/travel/CountrySheet.tsx`:
  - a bottom sheet on a phone, beside the map from `sm` up;
  - the country's trips newest first, with dates as DD/MM/YYYY, "Planned" in brass on a planned trip, and its cities there;
  - a trip's name shows its card;
  - "✕" (read "Close") or Escape closes it, and its heading takes focus.
- `49d2c1a` puts the sheet's bottom pin and its home-indicator inset on one line, for PWA P2's line-by-line `safe-area.test.ts`. The sheet already cleared the home indicator; only the source's layout changed.

**Map | List** (`007aaf9` RED, `6da4599` GREEN)
- `TripsScreen` gets the toggle (D15).
- The panel is loaded by `import("../travel/MapPanel")` only; its props type is declared in the screen, so not even a type import names it.
- "Add a trip" focuses the New trip form's Name. A trip's name in a sheet switches to List and focuses its card.
- The 1b list and edit tests, whose trips have countries, now tap "List" first. What they check is unchanged.

**Place on map, D14** (`b302344` RED, `e5552cd` GREEN)
- A typed city with no point from the list (it isn't there, or the list didn't load) gets "Place on map" and item 8's 1c line.
- The button shows "Tap the map where <city> is." and "Cancel" straight away, then `components/travel/PlacePicker.tsx` (a dynamic import) opens the map fitted to the row's country.
- A tap is the city's point, WGS84 to 2 decimals, and survives correcting the name.
- If the map can't load, the picker shows item 12's line and "Try again".
- 1b's test of the old not-in-the-list line now expects the approved 1c wording.

**375 px** (`45f8c7a`, a pin): the map's container, lists and sheet keep inside a phone's width (classes only; jsdom has no layout).

**Results on `claude/travel-1c`**
- Client: **2,988 passed**, 14 skipped (one more than before: the Beirut-only test skips in UTC, as the repo's Beirut tests do).
- Under `TZ=Asia/Beirut`: **3,001 passed**, 2 skipped.
- `tsc` and lint 0. Server unchanged by 1c.
- **Production build passes:**
  - the map's code is **14,769 B gzipped** in four chunks: d3-geo 8,845; geometry and topojson 3,262; panel 1,944; picker 718. That's below the plan's 22 KB estimate;
  - the Trips chunk loads them only through webpack's on-demand loader, when Map or the picker opens;
  - the Overview (`/`) first load is 289 kB here against 290 kB on `main` built the same way: no growth.

**Merged** at `06b4bec`, a merge commit (no squash), approved by the owner after checking the preview with CI green, onto `main` at `e0b3c15`. `main` had moved 3 commits since 1c was cut (a sync-service fix, session 41 item 2), none in 1c's files; no conflicts. On the merged result: client **3,005 passed**, 14 skipped; under `TZ=Asia/Beirut` **3,017 passed**, 2 skipped; `tsc` and lint 0.

**Owner's live check (for 1c on `main`)**
- **Map:** France, Italy and Malta highlighted, Malta as a dot; city dots in the right places. Tap France: the trip, its dates, Paris and Lyon.
- **Show my countries:** zooms to Europe; "+"/"−" and dragging work on the phone.
- **Planned:** a trip starting next month shows its country dashed, listed under "Planned (1)", with "Planned" in its sheet. After its start date it shows filled under "Countries visited", with no change on your part.
- **Place on map:** a typed city ("Batroun") shows "Place on map". Tap it, then tap the map: after saving, its dot appears there.
- **Opening view:** an account whose trips have no countries opens Trips on List.
- **Themes:** all 6 readable, the dashed outline included.
- **Offline:** in airplane mode after one visit, the map still draws.
- **Network (DevTools):** Overview loads no map files; opening Trips loads no map code until Map opens; no request leaves the app's own site.
- **Phone sheet:** the bottom sheet clears the home indicator on an installed iPhone.

---

### Map design pass. Merged at `bbfbc42`.

Owner's brief (2026-11-05), six problems, plus one found in the screenshots. Cut from `main` at `45ee52e`; pushed after every commit; failing test before each change. Decisions D17-D22.

| # | What | Commits (RED, GREEN) |
|---|---|---|
| 0 | Status line (rule 8) | `2db0ee5` |
| 1 | Opens fitted to the visited countries (D17) | `2fa225e`, `74cc78a` |
| 2 | Strong visited fill, `brass70` token, ink outline (D18) | `e0827ca`, `b78c9f7` |
| 3 | Dots only for visited or planned small countries (D19) | `f735410`, `1e6030d` |
| 3b | A dot shows round a city marker in it (found in the screenshots: Valletta's marker hid Malta's dot) | `a550aa8`, `bdd1ad1` |
| 4a | Pieces, roles, groups, locate, territory in `lib/worldMap.ts` (D20) | `3c8f598`, `4cab47a` |
| 4b | `litPieces` in `lib/travel.ts`; one path per piece (D20) | `94f65b0`, `34e01c5` |
| 4c | The opening view and "Show my countries" fit what lights (a Cayenne-only France trip opens on French Guiana) | `30b6581`, `1c36bb5` |
| 5 | Desktop: map wide, sheet below (D21) | `02eaf36`, `810f731` |
| 6 | No "Countries visited (0)" (D22) | `eeaf8ca`, `78f61af` |
| 5b | In Map view the header and the Map \| List toggle line up with the wide map (owner, after the screenshots); the New trip form keeps the 768 px column; List view unchanged | `73a54b0`, `7bd2a44` |
| — | `World.shapes` removed, unused since 4b (owner); the one test that only read it removed | `a0edafc` |

**Measured, not assumed:**
- Contrast, from the theme tokens, all 6 themes: the visited fill on unvisited land 3.2-6.0:1 (was 1.3-1.6); the ink outline on the fill 3.9-6.9:1; the city markers' ink halo on the fill 3.9:1 and up; planned brass on land 6.2:1 and up.
- Rule B on the 110m data: France's French Guiana (6,517 km), the US's Alaska (824 km) and Hawaii, Norway's Svalbard (681 km) are overseas; Corsica, Japan's, Canada's and Indonesia's islands, Russia's Franz Josef Land (517 km) and Peninsular Malaysia (603 km) are home. Indonesia's Papua is home (the islands chain within 650 km), contrary to an edge case first guessed before measuring. Countries with an overseas piece: FR, US, NO.
- Classifying every country at once took 406 ms here, so pieces are classified per country on first use and kept.

**Tests changed on purpose:** 1c's visited-border, dot, path-count and "(0)" tests now describe the new design; the old contrast block now checks what is drawn. Each change is named in its GREEN commit.

**Results:** client **3,039 passed** (UTC), **3,051 passed** under `TZ=Asia/Beirut`; `tsc` and lint 0. Production build passes; the Overview's first load is 291 kB before and after (no growth).

**Merged** at `bbfbc42`, a merge commit (no squash), onto `main` at `45ee52e` (no commits since the branch was cut). On the merged result: the same counts, UTC 3,039 and Asia/Beirut 3,051 passed; `tsc` and lint 0.

**Screenshots** (before = `main` at `45ee52e`, after = this branch; a temporary harness page rendering the real `TripsScreen` with demo trips in a 220 px-sidebar shell, never committed): 375 px, 375 px with France's sheet, 1440 px with France's sheet in Ivory and in Ledger.

**Owner's review before merging:**
- The map opens on your visited countries; with only planned trips, on the whole world.
- Visited countries are clearly brass; planned ones dashed; no dots scattered over the oceans; Malta a brass ring round Valletta.
- A Paris trip doesn't light French Guiana; a Honolulu trip lights Hawaii only.
- Desktop: the map spans the main area; France's sheet opens below it.
- Only planned trips: no "Countries visited" heading.

---

## 4. Planned

Nothing more is planned for Phase 1, which is complete (1c merged at `06b4bec`). Phase 2 and the open items are in §7.

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

**For Phase 1c (in use since 1c):**

| # | Where | APPROVED wording |
|---|---|---|
| 10 | Map empty state | "Your travel map. Add a trip with the countries and cities you visited and they'll appear here. The map is drawn on your device; your places aren't sent to any map service." *("phone" changed to "device")* Button: "Add a trip" |
| 11 | Map loading, past 10 seconds | "Still loading the map…" |
| 12 | Map failed to load | "Couldn't load the map. Your trips are safe. They're all in the list." Button: "Try again" |
| 13 | Country sheet, a future trip (D12) | "Planned" |
| 14 | Map controls and list | "Map", "List", "Show my countries", "Countries visited (N)" |
| 15 | Placing a typed city (D14) | "Place on map" |

**Added during 1c (approved 2026-11-05):**

| # | Where | APPROVED wording |
|---|---|---|
| 16 | Zoom buttons | Visible "+" and "−", read aloud "Zoom in" and "Zoom out" |
| 17 | Country sheet's close button | "✕", read aloud "Close" (as the Edit Recurring and Pay Debt sheets) |
| 18 | Place on map, while picking | "Tap the map where <city> is." (the typed name), and "Cancel" (the app's existing word) |
| 19 | Under the map (D16) | "Countries visited (N)" (visited only), then "Planned (N)" listing planned-only countries by name *(owner's wording; replaced a "· Planned" suffix)* |

All of 10–15 and 8's 1c line are now in use. Item 12's line also serves the Place on map picker if its map can't load.

**Decided earlier, so never held:** the budget line at 0 ("Spent $X", D9) and the default trip name format ("France, Italy, Malta", D8).

**Year headings** in the list are the bare year ("2025"), with no wording.

---

## 6. Brief §6.5 checks, for the remaining phases

1. **What reverses it.**
   - Deleting a trip: its stops are removed with it, and a deletion record syncs the deletion. Tagged rows keep their tags (deliberately left standing, an existing decision).
   - Editing stops or notes overwrites them, with no captured earlier state (deliberately, as trip edits are today).
   - A filled-in default name is an ordinary stored name.
   - The map changes nothing; it only reads. Place on map writes only the row's point in the form, kept or discarded with the form; "Cancel" leaves none.
2. **Which claims are inherited.** Re-derived at the end of 1c (2026-11-05):
   - the readers of a trip's name: now **7**, re-counted by grep. These are the trip pickers in `ImportStatement`, `ForeignCashForms`, `InputPanel` and `EditTransactionSheet`; `TripsScreen`; the sync notice via `syncMerge`; and 1c's `CountrySheet`. All read the stored name, so a default name needs nothing more;
   - the city file's size (1b) and the shapes file's size (1c): measured from the committed files (§3);
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
- **Left after 1c (none blocks the merge):**
  - **Pinch to zoom isn't built:** zoom is "+"/"−" and drag. Two-finger pinch is a possible later addition, with no new wording.
  - ~~"Countries visited (0)"~~: resolved by the design pass (D22).
  - **The picker's failure line:** if the map can't load while placing a city, the picker shows item 12, "…They're all in the list.". The words were approved for the Map view; they're true here too, but read a little oddly in a form.
- **Left after the design pass (none blocks a merge):**
  - ~~Two left edges on desktop~~: resolved (5b): in Map view the header and toggle line up with the map. Side effect: on desktop the header shifts when switching between Map and List, which use different widths.
  - ~~`World.shapes` unused~~: removed (`a0edafc`).
  - **A small country's ring can sit off-centre** round its city (Valletta is not Malta's centroid): true geography, not a bug.
- **Risks carried from 1b and 1c:**
  - 368 KB over Lebanese mobile data the first time a form needs the city list, and again after each deploy (above);
  - small countries hard to tap at 375 px (hence the dots and the list);
  - a typed city has no marker until it's placed ("Place on map");
  - tapping country shapes on iOS Safari needs checking on a real phone;
  - a stored stop with a code a future country list drops would make that trip's edit refuse until the stop is fixed.
