# Travel map: plan and status

An extension of the existing Trips screen (`client/lib/trips.ts`, `client/components/screens/TripsScreen.tsx`): a world map of the countries visited, a sheet of the trips in a country, city markers, and the trip list grouped by year. Read with `docs/CLAUDE_CODE_BRIEF.md`, which stays the authority on standards and standing rules.

**Status (2026-11-05):** Phase 0 and Phase 1a are built, merged and verified live by the owner. **Phase 1b is approved and in progress** on `claude/travel-1b` (not merged). Phase 1c is planned, with its wording approved; its build is not yet approved. Phase 2 has no plan yet.

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
| D6 | City data: **one** bundled GeoNames `cities15000` file, loaded the first time a trip form opens. Not one file per country. The GeoNames CC BY credit goes on the About page. The city field always accepts free text. |
| D7 | **Trip dates only;** stops have no dates of their own. |
| D8 | A **blank trip name defaults to the country names**, in English, in route order, each once ("France, Italy, Malta"). A name left blank when editing re-fills from the countries the trip has after the edit. A blank name with no countries is still refused. |
| D9 | **Budget line at 0:** budget 0 with spending shows "Spent $X" in plain text (no "over", no coral); no line at all when spending is also 0. A budget above 0 keeps today's line unchanged. |
| D10 | **Exchange rows stay counted as Wants** in their month (`lib/foreignCash.ts`). Out of scope. |
| D11 | A bad stop is **refused** (reason `"stops"`), with one message line in `TripsScreen`. Its wording is HELD (§5). |
| D12 | **Visited vs planned:** a trip counts as visited only if its start date is today or earlier (the device's local calendar day). Later trips are **planned**: a distinct style on the map (dashed brass outline) and labeled "Planned" in the country sheet. Detail in Phase 1c. |
| D13 | Each phase gets its own branch: RED tests first, then GREEN, one concern per commit, merged with a merge commit (no squash) after the owner's live check. |

---

## 3. Built and merged

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

---

## 4. Planned

### Phase 1b: the form, the list, the city file, the budget line, the credit

**Status: approved, in progress** on `claude/travel-1b`.

Cut as a **fresh branch from `main`**, not stacked. **The first step, before any UI uses them, is showing the owner every HELD string in §5 for approval.**

**Files:** `TripsScreen.tsx`, `components/travel/StopFields.tsx`, `scripts/build-geo.mjs` (extended for cities), `public/geo/cities15000.json`, `sw/build-sw.mjs`, `app/about/page.tsx`.

**The city file**
- `public/geo/cities15000.json`: 34,197 rows `[name, country, lat, lon]`, coordinates to 2 decimals. Measured at **1,080,914 bytes raw, 370,837 gzipped**. (With the GeoNames id it would be 1.35 MB / 496 KB; the id is dropped because each stop stores its own name and coordinates.)
- It's added to the service worker's `ON_FIRST_USE`: not precached, fetched once when a trip form first opens, then cached for offline use.
- About 1.1 MB of JSON is committed to the repo.
- Lebanon has only 18 entries, and Batroun isn't one of them, so free text (D6) is essential.

**The form**
- A "Countries and cities" section:
  - a searchable country picker (names from `Intl.DisplayNames`);
  - cities picked from the file, searched without accents (typing "zahle" finds "Zahlé"), or typed in, with an optional "Place on map";
  - rows that can be removed;
  - a Notes field.
- If the city file can't load, typed cities still work, and the form says the list is unavailable.

**The list**
- The existing cards, newest first, under year headings.
- Each card gets a "Countries · cities" line and its notes.

**Budget line:** D9.

**About page:** a "Map and place data" section with the credit.

**Tests to write first (RED before GREEN)**
- The form: add a country; pick a city (fetch mocked; "zahle" finds "Zahlé"); type a city; remove a row.
- The city file is fetched once, and only when a form opens; if it fails, typing still works.
- The list: year headings, newest first; the countries line; notes.
- The budget line (USD figures, so money tests per brief rule 4):
  - budget 0 with spending shows "Spent $X" and no coral;
  - budget 0 with no spending shows no line;
  - budget above 0 is unchanged.
- Service worker manifest: the city file is not precached; the country files are.
- No city or coordinate ever appears in a URL (following `no-address-in-urls.test.ts`).
- The About page shows the credit.
- The script: every row is `[string, 2-letter code, lat, lon]` with values in range.

**SAFE STOP.**

**Owner's live check**
- On a phone at 375 px: a trip with no name and France (Paris, Lyon), Italy (Rome), Malta (Valletta), plus a typed "Batroun" with a pin, saves as "France, Italy, Malta".
- Searching "zahle" finds Zahlé.
- DevTools: the city file loads only when the form opens, and from cache in airplane mode.
- A past trip with a $0 budget shows "Spent …" or no line, never coral "over".
- Year headings, newest first.
- The other device matches after sync.
- Edit cities on one device and notes on the other while both are offline, then sync: one edit wins and the notice names the trip.
- A deleted trip stays gone on both devices.
- The About page shows the credit.

### Phase 1c: the map

**Files:** `components/travel/TravelMap.tsx`, `components/travel/CountrySheet.tsx`, the dependencies `d3-geo` and `topojson-client`, `public/geo/countries-110m.json`.

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

## 5. Held wording, for approval when 1b starts

None of these may be used in the UI until the owner approves them. The first one is already in the code, marked HELD, but no current form can show it.

| Where | HELD wording |
|---|---|
| Refusal for a bad stop (`TripsScreen.tsx`, `REASONS.stops`) | HELD: "Check the countries and cities." |
| Map empty state | HELD: "Your travel map. Add a trip with the countries and cities you visited and they'll appear here. The map is drawn on your phone; your places aren't sent to any map service." Button: HELD: "Add a trip" |
| Map loading, past 10 seconds | HELD: "Still loading the map…" |
| Map failed to load | HELD: "Couldn't load the map. Your trips are safe. They're all in the list." Button: HELD: "Try again" |
| City list failed to load (form) | HELD: "The city list couldn't load. You can still type a city." |
| About page section | Heading HELD: "Map and place data". Text HELD: "Country shapes: Natural Earth (public domain), via world-atlas. City names and locations: GeoNames (geonames.org), licensed under Creative Commons Attribution 4.0." |
| Country sheet, a future trip (D12) | HELD: "Planned" |
| Form section and controls | HELD: "Countries and cities", "Add a country", "Add a city", "Place on map", "Notes" |
| Map controls and list | HELD: "Map", "List", "Show my countries", "Countries visited (N)" |
| Trip card | HELD: the "Countries · cities" line's format, e.g. "France · Paris, Lyon — Italy · Rome" |

**Already decided, so not held:** the budget line at 0 ("Spent $X", D9) and the default trip name format ("France, Italy, Malta", D8).

---

## 6. Brief §6.5 checks, for the remaining phases

1. **What reverses it.**
   - Deleting a trip: its stops are removed with it, and a deletion record syncs the deletion. Tagged rows keep their tags (deliberately left standing, an existing decision).
   - Editing stops or notes overwrites them, with no captured earlier state (deliberately, as trip edits are today).
   - A filled-in default name is an ordinary stored name.
   - The map changes nothing; it only reads.
2. **Which claims are inherited.** Re-derive before 1b and 1c are built:
   - the readers of a trip's name (6 at 1a);
   - the city file's size (measured once, above);
   - whether the service worker's precache rule is still "every file in `public/` except `ON_FIRST_USE`".
3. **What units each figure carries.** Coordinates in WGS84 degrees; country codes ISO alpha-2; dates as local `YYYY-MM-DD` calendar days; the budget line in USD (`budgetUSD`, `totalUSD`); file sizes raw or gzipped as labelled.

---

## 7. Open items

- **Phase 2: a trip budget in a foreign currency.** No plan yet; it gets its own.
  - **Already built:** USD trip budgets, per-category USD budgets, foreign-cash sheets, exchange cost per currency, and euro spends shown approximately in USD.
  - **The gap:** setting a budget *in* EUR. A likely shape is `budgetNative?: { amount; code }` beside `budgetUSD`, never added to a USD figure. Money tests come first (brief rule 4).
- **Brief §1 scope tension.** The map serves none of Earn, Spend, Save or Achieve; only the trip budget serves Spend. The owner accepted this as a known tension, not a blocker. The strongest argument against building it now: about 60 KB more to download at install, plus four releases, while cohort items in `docs/ROADMAP.md` (for example the monthly disposable-capacity figure) stay open.
- **Risks carried into 1b and 1c:**
  - 371 KB over Lebanese mobile data the first time a trip form opens (cached after);
  - small countries hard to tap at 375 px (hence the dots and the list);
  - typed cities without a pin get no marker;
  - tapping country shapes on iOS Safari needs checking on a real phone;
  - a stored stop with a code a future country list drops would make that trip's edit refuse until the stop is fixed.
