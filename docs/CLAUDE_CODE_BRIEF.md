# ESSA — Engineering Brief for Claude Code

**Repository:** `MradMichael/Finance-Prodigy`
**Deployment:** `finance-prodigy-client-atomic-os.vercel.app`
**Product name:** ESSA — Earn, Spend, Save, Achieve
**Owner:** Michael Mrad
**Brief version:** 1.0 — August 2026

---

## 0. How to use this document

Place this file at `docs/CLAUDE_CODE_BRIEF.md` in the repository root and reference it at the start of a Claude Code session.

**Work through the phases in order. Do not skip ahead.** Phase 1 is a read-only audit and must complete before any code changes. Phases 2 and 3 depend on findings from Phase 1 — several planned features may be invalidated by what the audit reveals about the current architecture.

### Standing rules for this codebase

1. **Report before fixing.** In Phase 1, change nothing. Produce findings only.
2. **One concern per commit.** Do not bundle a security fix with a refactor with a UI change.
3. **Do not refactor unrequested.** If you see code you would have written differently but which works and is not implicated in a finding, leave it.
4. **Money math gets tests.** Any function that adds, subtracts, converts, allocates or forecasts a currency amount must have unit tests before it is modified.
5. **Never invent a status.** If you cannot determine whether something is implemented, record it as UNKNOWN with the reason. Do not infer from file names, comments or README claims.
6. **This app holds real financial data belonging to a real person, and is about to hold data belonging to their friends and family.** Treat every data-isolation question as production-critical.

---

## 1. Product context

ESSA is a personal finance application, currently in single-user production use by its owner, being prepared for a friends-and-family test cohort.

**Known usage patterns** (derived from the owner's actual use of the app):

- Tracking of monthly income against fixed recurring obligations
- Tracking of variable spending across categories (fuel, groceries, subscriptions, lessons, personal care)
- Multiple named savings goals with target amounts, some actively funded and some dormant
- Generation of a multi-page monthly financial report that the owner exports and reads outside the app

**Known real-world constraints of the user base:**

- Primary users are based in Lebanon. Mobile network quality is inconsistent; page weight and offline tolerance matter.
- Users transact in both USD and LBP. The Banque du Liban official rate is 89,500 LBP to 1 USD. Any historical hardcoded rate of 1,500 or 15,000 anywhere in the codebase is a defect.
- Users are not finance professionals. Terminology must be plain.
- WhatsApp is the dominant sharing channel.

**Product framing.** The four letters are the product's information architecture and should be treated as such:

| Pillar | Question it answers |
|---|---|
| **E**arn | What comes in, and when? |
| **S**pend | Where does it go, and is that normal for me? |
| **S**ave | What is set aside, and is it protected? |
| **A**chieve | What am I working toward, and will I get there? |

Features that do not serve one of these four questions are out of scope.

---

## 2. Phase 1 — Verification audit (read-only)

**Objective:** establish ground truth about what is actually implemented, as opposed to what was intended or believed to be implemented.

Produce a written report. Change no code. For every item, record one of: **CONFIRMED** (verified in code, with file path and line reference), **ABSENT** (verified not to exist), or **UNKNOWN** (could not determine, with the reason).

### 2.1 Data architecture — highest priority

The owner does not currently know where user data is stored. This is the first question to answer and it governs everything else.

1. Trace the full data path for a single financial transaction, from the UI component that captures it to its final persisted destination. Name every file in the chain.
2. Identify the persistence layer definitively: Supabase, another hosted database, a custom backend service, browser `localStorage`, `IndexedDB`, or in-memory only.
3. The deployment URL contains the segment `-client-`. Determine whether a separate server or API component exists in this repository or in another. If the client expects a backend, identify the base URL used in the production build and confirm it is reachable and not a `localhost` or development address.
4. State whether data survives: a page refresh, a browser restart, clearing site data, and use on a second device with the same account.
5. If storage is browser-only, say so plainly and prominently. It changes the entire launch plan.

### 2.2 Authentication and data isolation

If, and only if, a shared backend database exists:

6. Identify the authentication mechanism and whether it is fully wired (signup, login, logout, session persistence, password reset).
7. **Determine whether user A can read or modify user B's financial records.** Check row-level security policies, server-side authorisation guards, and every query that filters by user identity. Report the specific mechanism enforcing isolation, or state that none was found.
8. Verify that user identity used in queries is derived from a verified server-side session, never from a client-supplied parameter.
9. Confirm every write path validates ownership before mutating a record.
10. Test the password reset flow end to end and report whether it is functional. This is commonly scaffolded and never completed.

### 2.3 Secrets and configuration

11. Scan the working tree for committed credentials: API keys, database connection strings, service-role keys, `.env` files.
12. Scan the **git history**, not only the current tree. A key removed in a later commit is still exposed in a public repository.
13. Confirm that any key with elevated privileges (for example a Supabase service-role key) is not present in client-side code or in any variable prefixed for browser exposure.
14. List every environment variable the code reads. Compare against `.env.example`. Report any variable the code requires that is undocumented.
15. Confirm the production deployment has every required variable set.

### 2.4 Correctness of financial logic

16. Identify how monetary amounts are stored. Report whether floating-point arithmetic is used anywhere in money calculations, and list every location.
17. Identify how currency is handled. Determine whether multi-currency is supported, whether an exchange rate is stored per transaction or applied globally, and whether any rate is hardcoded.
18. Verify that category totals, monthly aggregates and goal progress calculations are correct. Construct a small fixture dataset with a known expected answer and confirm the code produces it.
19. Identify how recurring obligations are modelled, and whether they support a defined end date.
20. Identify timezone and date-boundary handling. Determine which day a transaction entered near midnight is attributed to.

### 2.5 Resilience and first-run experience

21. Report what a new user with zero data sees on every screen. Identify screens that render blank, or as a broken layout, or as `NaN`, `undefined`, `0.00` with no explanation.
22. Identify every failure path that produces a white screen, an infinite loading state, or an unhandled promise rejection with no user-visible message.
23. The deployed HTML shell renders only a loading placeholder with no `<noscript>` fallback and no timeout handling. Confirm whether this is still the case.
24. Report the production JavaScript bundle size and the largest contributors to it.
25. Report mobile behaviour: viewport handling, touch target sizing, whether any layout breaks below 380px width, and whether forms are usable on a phone keyboard.

### 2.6 Deployment integrity

26. Confirm that a clean clone, following only the README, produces a running application.
27. Confirm that the deployed build corresponds to the current `main` branch.
28. Identify the three conflicting product names in use — repository `Finance-Prodigy`, deployment slug `atomic-os`, application title `ESSA`. List every location where each appears.

### 2.7 Deliverable for Phase 1

A single markdown report at `docs/AUDIT_2026-08.md` containing:

- A findings table: ID, area, status, severity (Critical / High / Medium / Low), file reference, one-line description.
- A **Launch Blockers** section listing only those findings that must be resolved before any third party is given access.
- An **Architecture Summary** — a plain-language description of how the application actually works, written for someone who did not build it.
- An **Open Questions** section listing anything marked UNKNOWN and what would be required to resolve it.

Severity guidance: any finding that permits one user to access another user's financial data, or that exposes a credential, is Critical regardless of exploitability.

---

## 3. Phase 2 — Launch readiness

Do not begin until the Phase 1 report is delivered and reviewed.

### 3.1 Blocker remediation

Resolve every Critical and High finding. One commit per finding, each referencing its finding ID. If a fix requires an architectural decision rather than a code change, stop and present the options with a recommendation rather than choosing unilaterally.

### 3.2 Minimum bar for a friends-and-family cohort

These are the conditions under which a third party's financial data may be entered into this application:

- [ ] Data isolation is enforced server-side and verified by test with two real accounts
- [ ] No credentials exist in the repository or its history; any previously exposed key is rotated
- [ ] Signup, login, logout, session persistence and password reset all function on a phone
- [ ] Every screen has a defined empty state that tells a new user what to do next
- [ ] Every failure path shows a human-readable message; no white screens, no infinite spinners
- [ ] A single first-run onboarding flow exists that gets a new user to their first entered transaction
- [ ] The application is usable on a 375px-wide screen on both iOS Safari and Android Chrome
- [ ] Currency display is unambiguous — every amount is labelled with its currency
- [ ] A data export exists, so a user can retrieve their data without the owner's assistance
- [ ] A visible disclaimer states the application does not provide financial advice
- [ ] A plain-language note states where user data is stored and who can access it
- [ ] A single product name is applied consistently across repository, deployment and interface

### 3.3 Naming and presentation

Adopt **ESSA** as the sole product name. Update the repository description, the application title, the manifest, and the deployment. Acquire a custom domain and point the deployment at it. Add Open Graph and Twitter card metadata with a title, description and image, so that a link shared on WhatsApp renders as a card rather than a bare URL.

---

## 4. Phase 3 — Feature roadmap

Sequenced by dependency and by value to the actual user base. Each feature includes acceptance criteria. Implement one at a time; present each for review before beginning the next.

### F1 — Dual-currency support (USD / LBP)

**Rationale:** the user base earns, spends and saves across two currencies with a volatile relationship. A single-currency model misrepresents their actual position.

- Every monetary record stores an amount, a currency code, and the exchange rate applied at the time of the transaction.
- A single configurable reference rate, defaulting to 89,500 LBP per USD, is stored as data and not in code.
- Every displayed total states which currency it is expressed in.
- A user can enter a transaction in either currency, and view any report in either.
- Historical records retain the rate at which they were entered; a change to the reference rate does not retroactively alter past reports.

### F2 — Recurring obligations with defined end dates

**Rationale:** the owner's own dominant financial fact is a fixed monthly installment with a known termination date. Modelling this as an indefinite recurring expense understates future capacity and produces a misleading picture.

- A recurring obligation has an amount, a currency, a frequency, a start date and an optional end date.
- The obligation is excluded from projections beyond its end date.
- The interface surfaces remaining installments and total remaining commitment.
- A forward view shows monthly disposable capacity, including the step change when an obligation terminates.

### F3 — Goal feasibility engine

**Rationale:** this is the question the owner currently answers by exporting a report and reasoning over it manually. It is the highest-value automation available and the strongest argument for the product's existence.

- A goal has a target amount, a target date, a currency, and an active or archived status.
- Given current balances, projected monthly capacity from F2, and existing goal allocations, the engine reports for each active goal: achievable, achievable with adjustment, or not achievable by the target date.
- Where not achievable, the engine states the specific shortfall and the required monthly contribution to close it.
- Where multiple goals compete for the same capacity, the engine states the conflict explicitly rather than silently assuming parallel funding.
- Archived goals are excluded from capacity calculations but retained.

### F4 — Monthly report, generated in-app

**Rationale:** the owner already produces and reads a monthly report. It should be a first-class output of the application rather than an export the user assembles.

- One page per month, generated on demand, covering income, obligations, category spending, savings movement and goal progress.
- Month-on-month comparison highlighting material changes.
- Shareable as an image or PDF suitable for WhatsApp.
- Contains no data belonging to any other user.

### F5 — Spending intelligence

- Category spending compared against the user's own trailing three-month average, not against generic benchmarks.
- Detection and display of recurring subscription charges, including ones the user has not explicitly declared.
- Plain-language observations. "Fuel is 40% above your usual month" rather than a variance table.

### F6 — Resilience and access

- Progressive web app installation, so the application can be added to a phone home screen.
- Offline read of previously loaded data, with a queued write that syncs on reconnection.
- Deferred loading of non-critical bundle segments to reduce initial page weight.

### F7 — Arabic and RTL support

**Rationale:** the intended cohort is Lebanese. English-only is a real adoption barrier for some family members.

- Full interface translation with right-to-left layout for Arabic.
- Locale-appropriate number and date formatting.
- Language selectable independently of currency.

### Out of scope for this phase

Bank account integration; investment portfolio tracking; shared or household accounts; any form of automated financial advice; monetisation. Each of these introduces regulatory, security or complexity burdens disproportionate to a friends-and-family test.

---

## 5. Experience standards

These apply to all work in Phases 2 and 3.

**Every screen answers three questions on arrival:** where am I, what is the state of things, and what can I do next. A screen that shows only numbers has failed the third.

**Empty states are designed, not defaulted.** An empty state names what belongs there, explains why it matters, and provides the action that fills it. A blank panel or a zero with no context is a defect.

**Errors are written for a person.** State what happened, whether their data is safe, and what to do. Never surface a stack trace, an error code alone, or the word "unexpected".

**Loading states are honest.** Show a skeleton of the content that is coming. If a load exceeds ten seconds, say something. Never spin indefinitely.

**Money is displayed unambiguously.** Every amount carries its currency. Negative amounts are visually distinct from positive. Thousands are separated. Rounding is consistent and never hides a discrepancy.

**Mobile is the primary target.** Design at 375px first. Touch targets are at least 44px. Numeric inputs invoke a numeric keyboard. No horizontal scrolling.

**Language is plain.** No financial jargon where an ordinary word exists. "Money left this month", not "net disposable liquidity".

**The tone is neutral.** This application observes a person's financial situation, including during difficult periods. It reports facts and highlights options. It does not congratulate, admonish, or moralise about spending.

---

## 6. Definition of done

A change is complete when:

1. It works on a physical phone, not only in a desktop browser at a narrow viewport.
2. Its empty, loading and error states are all implemented.
3. Any money calculation it touches has a passing unit test.
4. It introduces no new environment variable that is absent from `.env.example`.
5. It has been verified against a second user account where data isolation is relevant.
6. The README reflects any change to setup, configuration or behaviour.

---

## 7. Session kickoff

Begin the first session by reading this document in full, then produce a short plan for Phase 1 stating which files you intend to examine and in what order. Await confirmation before executing.

Do not begin Phase 2.
