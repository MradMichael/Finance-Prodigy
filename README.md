# Momentum — Expense Tracking & Financial Motivation Platform

A full-stack personal finance app built to make progress visible: a Financial Health Score, 50/30/20 budget tracking, an emergency fund tracker, Snowball/Avalanche debt payoff projections with an exact debt-free date, and milestone goals (like a $12,000 "30 Before 30 Travel Fund") with required-monthly-contribution math.

**Stack:** Next.js (TypeScript) + Tailwind CSS + Recharts · Node.js/Express · PostgreSQL + Prisma (star schema, BI-ready).

---

## Repository layout

```
Finance-Prodigy/
├── server/                    # Express API (port 4000) — deploy root for Railway
│   ├── prisma/
│   │   ├── schema.prisma          # Star schema: dim_* / fact_* / planning tables
│   │   ├── analytics_views.sql    # vw_fact_ledger, vw_monthly_bucket, vw_category_variance
│   │   └── seed.ts                # Master calendar 2024–2032, category tree, demo user
│   ├── src/
│   │   ├── index.ts               # Bootstrap, CORS, error handling
│   │   ├── lib/core.ts            # Prisma singleton, date-key helpers, auth stub
│   │   ├── services/
│   │   │   └── financialEngine.ts # Pure functions: payoff sim, health score, projections
│   │   └── routes/
│   │       ├── transactions.ts    # Logging, monthly summary, variance, trend
│   │       ├── goals.ts           # Goals, contributions, emergency fund
│   │       ├── debts.ts           # Debts, payments, payoff plan
│   │       └── dashboard.ts       # Single aggregated dashboard payload
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── client/                    # Next.js app (port 3000) — deploy to Vercel
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx               # Renders <FinancialDashboard />
│   │   └── globals.css
│   ├── components/
│   │   └── FinancialDashboard.tsx # The Motivation Engine screen
│   ├── next.config.js             # /api/* → Express rewrite
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── .env.example
└── demo/
    └── momentum-planner.jsx       # Standalone interactive planner (no backend)
```

---

## 1. Project setup commands

Both apps are pre-scaffolded — just install dependencies.

### Server (Express + Prisma)

```bash
cd server
npm install
cp .env.example .env   # fill in DATABASE_URL
```

### Client (Next.js + TypeScript + Tailwind)

```bash
cd client
npm install
cp .env.example .env   # set API_URL if not using default localhost:4000
```

Optional — register the "ledger ink & brass" palette as Tailwind tokens in `client/tailwind.config.ts` (the shipped component uses inline tokens, so this is for the screens you build next):

```ts
extend: {
  colors: {
    ink: "#0B1F1E",
    panel: "#11302C",
    panelSoft: "#16403A",
    line: "#1E4A43",
    foam: "#EAF2EF",
    mute: "#8FAFA7",
    brass: "#E3B341",
    jade: "#4FD1A5",
    coral: "#F08A7E",
    sky: "#7FB8D8",
  },
},
```

### Database (PostgreSQL)

Run these from the `server/` directory:

```bash
cd server

# 1. Create the database (local example)
createdb momentum

# 2. Environment
cp .env.example .env   # set DATABASE_URL

# 3. Generate client + run the migration
npx prisma migrate dev --name init_star_schema

# 4. Create the analytics views (the API reads these — do not skip)
npx prisma db execute --file ./prisma/analytics_views.sql --schema ./prisma/schema.prisma

# 5. Seed master calendar, categories, demo user
npx prisma db seed
```

### Run

```bash
# Terminal 1 — API on :4000
cd server && npm run dev

# Terminal 2 — Next.js on :3000
cd client && npm run dev
```

Open http://localhost:3000. If the API is down, the dashboard renders with a clearly-badged demo payload so the UI is never blank.

---

## 2. Environment variables

| Variable        | Where  | Default                  | Purpose                                  |
|-----------------|--------|--------------------------|------------------------------------------|
| `DATABASE_URL`  | server | —                        | Postgres connection string (Prisma)      |
| `PORT`          | server | `4000`                   | Express listen port                      |
| `CLIENT_ORIGIN` | server | `http://localhost:3000`  | CORS allow-origin                        |
| `API_URL`       | client | `http://localhost:4000`  | Rewrite target for `/api/*`              |

Auth is intentionally stubbed: every request resolves the user from the `x-user-id` header (default `1`, the seeded demo user). Swap `userIdOf()` in `server/src/lib/core.ts` for your session middleware (NextAuth, Clerk, custom JWT) when you wire real auth — it is the single seam.

---

## 3. Architecture notes (the "why")

**Star schema, not a transaction dump.** Every fact table carries `date_key` (YYYYMMDD integer) joining to `dim_date`, the master calendar. Physical names are snake_case via `@map`/`@@map`. This is deliberate: Qlik Sense, Power BI, or Metabase can connect straight to Postgres and load the star with zero reshaping — no quoted identifiers, no date parsing, one conformed calendar.

**Aggregation lives in the database.** The three views in `analytics_views.sql` are the analytical contract:

- `vw_fact_ledger` — the canonical signed ledger. Point any BI tool here first; `signed_amount` sums to net cash flow at every grain.
- `vw_monthly_bucket` — user × month × bucket with `pct_of_income`. Powers 50/30/20 tracking, the trend chart, and the health score. Uses `date_key / 100` integer division for index-friendly month math.
- `vw_category_variance` — planned vs. actual per category ("How Much" engine). Positive variance = money kept.

The Express layer reads these views rather than re-aggregating in JavaScript, so the app and your BI dashboards always agree on the numbers. When `fact_transaction` passes a few million rows, promote `vw_monthly_bucket` to a materialized view (script included in the SQL file).

**Simulation lives in a pure engine.** `financialEngine.ts` has no I/O — `simulateDebtPayoff`, `projectGoal`, `emergencyFundStatus`, and `calculateHealthScore` are deterministic functions, trivially unit-testable, and reused by every route.

**Health Score (0–100)** — five weighted components: savings rate vs. the 20% target (25), needs discipline under 50% of income (20), emergency fund % funded (25), debt pressure as payments-to-income (20), and goal pace (10). Grades are worded to encourage: *Thriving · Building momentum · Finding footing · Laying foundations*. There is no "Poor."

**Debt payoff** holds the monthly commitment constant (sum of original minimums + extra), so when a debt dies its payment automatically rolls into the next target — the snowball effect, modeled honestly. `GET /api/debts/payoff-plan?extra=250` runs *both* strategies plus a minimums-only baseline and returns the head-to-head (months sooner, interest saved) ready for the UI.

---

## 4. API surface

| Method & path | Purpose |
|---|---|
| `POST /api/transactions` | Log income/expense (zod-validated, auto-extends calendar) |
| `GET /api/transactions` | Filterable, cursor-paginated ledger |
| `GET /api/transactions/summary/:year/:month` | Income, 50/30/20 split with headroom, savings rate, top categories |
| `GET /api/transactions/variance/:year/:month` | Budget vs. actual per category |
| `GET /api/transactions/trend?months=6` | Monthly bucket trend (from view) |
| `GET /api/goals` · `POST /api/goals` · `PATCH /api/goals/:id` | Goal CRUD with projections |
| `POST /api/goals/:id/contributions` | Transactional contribution + auto-ACHIEVED celebration |
| `GET /api/goals/emergency-fund` | EF target (months × trailing-avg essentials) and funding progress |
| `GET /api/debts` · `POST /api/debts` | Debt CRUD with paid-% framing |
| `GET /api/debts/payoff-plan?extra=N` | Snowball vs. Avalanche vs. minimums-only comparison |
| `POST /api/debts/:id/payments` | Payment with interest/principal split at write time |
| `GET /api/dashboard?extra=N` | One payload powering the whole Motivation Engine screen |

---

## 5. BI tool integration (Qlik / Power BI)

1. Connect to Postgres directly (read-only role recommended: `GRANT SELECT ON ALL TABLES IN SCHEMA public TO bi_reader;`).
2. Load `vw_fact_ledger` as the fact, `dim_date` as the master calendar, `dim_category` and `dim_account` as dimensions — the keys are already conformed (`date_key`, `category_id`, `account_id`).
3. Dates render naturally in `DD-MM-YYYY` from `dim_date.date`; `year_month` gives the monthly grain without expressions.
4. `fact_monthly_snapshot` is designed for trend lines (health score, debt balance, EF balance over time) without scanning the transaction fact — populate it from a month-end job.

---

## 6. Deployment

- **Database:** Neon or Supabase (managed Postgres). Run the same three steps: `migrate deploy`, `db execute` the views, `db seed`.
- **API:** Railway or Render. Build with `npm run build`, start `npm start`, set `DATABASE_URL`, `CLIENT_ORIGIN` (your Vercel URL), `PORT` (platform-injected).
- **Client:** Vercel. Set `API_URL` to the deployed API base; the rewrite handles the rest.
- Order matters on first deploy: database → views → seed → API → client.

---

## 7. What to build next

- Transaction entry form posting to `POST /api/transactions` (the API and category tree are ready).
- Strategy toggle on the dashboard calling `payoff-plan` with `SNOWBALL`/`AVALANCHE` — the comparison payload is already returned.
- Month-end job writing `fact_monthly_snapshot` for long-run trend charts.
- Real authentication at the `userIdOf()` seam.

---

## Demo

`demo/momentum-planner.jsx` is the standalone interactive planner — the same payoff simulation and rollover waterfall running on sample data, no backend required. Drop it into any React + Recharts project to demo the engine.
