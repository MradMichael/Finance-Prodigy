# ESSA — Earn · Spend · Save · Achieve

A local-first personal finance tracker: 50/30/20 (or custom) budget tracking, a Financial Health Score, an emergency fund tracker, Snowball/Avalanche debt payoff projections, and milestone goals with required-monthly-contribution math. Supports USD and LBP (Lebanese Pound) with a user-set exchange rate.

**Stack:** Next.js 14 (App Router, TypeScript) + Tailwind CSS + Recharts · Node.js/Express · SQL Server + Prisma (optional cross-device sync).

---

## How it actually works

**Your financial data lives in your browser, not in a database.** Everything — transactions, goals, debts, recurring payments — is stored in `localStorage`, encrypted at rest (AES-GCM), and all dashboard math (health score, debt payoff plans, goal projections) runs client-side in [`client/lib/computeDashboard.ts`](client/lib/computeDashboard.ts). There is no server-side session or user database backing sign-in.

**The Express + SQL Server backend is optional and does two things:**
1. **Sync** (`/api/sync/push` / `/api/sync/pull`) — lets you carry your data to a second device. Push uploads your encrypted-in-transit-by-HTTPS JSON blob keyed by email; pull downloads it. Protected by a token derived from your account password (see [Security model](#security-model)) — the server never sees your password.
2. **Analytics warehouse** — every push also fires-and-forgets a decomposition of your data into a proper star schema (`dim_date`, `dim_category`, `fact_transaction`, etc. — see [`prisma/schema.prisma`](server/prisma/schema.prisma)) so you can point Power BI / Qlik / Metabase at it later. **The app itself doesn't read this back** — it's a write-only sink today, populated by `server/src/lib/normalizeSync.ts` on every push.

If you never run the server, the app works fully offline — sign-up, sign-in, and all the screens work purely against `localStorage`.

---

## Repository layout

```
Finance-Prodigy/
├── client/                        # Next.js app — the actual product
│   ├── app/
│   │   ├── page.tsx                   # Main app shell: auth gate + all screens (Overview, Budget, Goals, Debts, Transactions)
│   │   ├── sign-in/, sign-up/         # localStorage auth
│   │   ├── recover/                   # Forgot-password flow (recovery code, see Security model)
│   │   ├── profile/                   # Account settings, theme picker, sync push/pull
│   │   └── admin/                     # Diagnostics: API health, registered users, sync status
│   ├── lib/
│   │   ├── auth.ts                    # Sign-up/in/out, password hashing, recovery
│   │   ├── crypto.ts                  # AES-GCM encryption + the DEK-wrapping scheme behind recovery codes
│   │   ├── localData.ts               # Data types + encrypted localStorage load/save
│   │   ├── computeDashboard.ts        # Pure function: your data → everything the dashboard shows
│   │   └── syncService.ts             # Push/pull to the Express API (relative /api/* paths)
│   ├── components/                    # FinancialDashboard, InputPanel, EssaBrand, ThemeContext
│   └── next.config.js                 # Proxies /api/* to the Express server (see API_URL below)
├── server/                        # Express API — sync + analytics warehouse only
│   ├── prisma/
│   │   ├── schema.prisma              # SQL Server star schema
│   │   ├── analytics_views.sql        # BI-facing views (vw_fact_ledger, vw_monthly_bucket, vw_category_variance)
│   │   └── seed.ts                    # Master calendar, category tree, demo user
│   ├── src/
│   │   ├── index.ts                   # Bootstrap, CORS, error handling
│   │   ├── routes/sync.ts             # Push/pull — the only routes that exist
│   │   └── lib/normalizeSync.ts       # Decomposes each push into the star schema
│   └── .env.example
└── demo/
    └── momentum-planner.jsx           # Standalone interactive planner, no backend — a design reference, not part of the app
```

---

## Quickstart

### Client only (no server, fully functional)

```bash
cd client
npm install
npm run dev
```

Open http://localhost:3000, sign up, and start using it. That's it — sync is opt-in from the Profile page.

### With sync (optional)

You'll need a SQL Server instance (a local named instance works fine for development).

```bash
cd server
npm install
cp .env.example .env        # fill in DATABASE_URL — see below
npx prisma migrate deploy   # applies the existing migrations
npx prisma generate
npx prisma db seed          # master calendar + category tree (safe to re-run)
npm run dev                 # → http://localhost:4000
```

In another terminal:

```bash
cd client
npm install
npm run dev                 # → http://localhost:3000
```

Then in the app: Profile → Push (uploads your local data) or Pull (restores from server, e.g. on a second device).

---

## Environment variables

| Variable | Where | Example | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `server/.env` | `sqlserver://HOST:PORT;database=essa;integratedSecurity=true;trustServerCertificate=true` | SQL Server connection (Prisma) |
| `PORT` | `server/.env` | `4000` | Express listen port |
| `CLIENT_ORIGIN` | `server/.env` | `http://localhost:3000` | CORS allow-origin |
| `API_URL` | `client/.env` | `http://localhost:4000` | Where `next.config.js` proxies `/api/*` to — the browser only ever calls relative `/api/*` paths, so this is the one place that needs to change for a deployed setup (e.g. your Railway API URL) |

SQL Server's default instance port is dynamic and can change on restart — set a static port in SQL Server Configuration Manager if you're running the server long-term.

---

## Deployment

**Verified locally, not yet deployed to a real host:**
- `cd server && npm install && npm run build` (`prisma generate && tsc`) builds clean standalone.
- `npx prisma migrate deploy` + `npx prisma db seed` against a real SQL Server, run twice — the seed is genuinely idempotent (second run: 0 rows inserted, all already existed).
- `cd client && npm run build && API_URL=http://localhost:4000 npm start` — the **production** build (not `next dev`) serves correctly and `next.config.js`'s `/api/*` rewrite honors `API_URL` as documented.
- A real `/api/sync/push` + `/api/sync/pull` round trip against the running production build.
- CORS: the server always responds with the configured `CLIENT_ORIGIN` value in `Access-Control-Allow-Origin`, regardless of the request's actual `Origin` header — this is what makes a browser reject responses to any page that isn't running at `CLIENT_ORIGIN`, even though a non-browser client like `curl` won't visibly enforce that itself.

**Not yet verified — requires an actual account/host, so this is deliberately scoped out until you want to commit to one:** deploying the client to Vercel (or similar) and the server to Railway/Render (or similar), and provisioning a real cloud SQL Server instance. The schema is SQL-Server-specific (`server/prisma/schema.prisma`'s `provider = "sqlserver"`, with cascade-rule workarounds for SQL Server's `NoAction` requirements) — a self-hosted or cloud SQL Server (e.g. Azure SQL) works as-is; a Postgres-as-a-service host (Neon, Supabase, etc.) would need the schema ported first, which is a separate, larger task.

---

## Security model

- **Encryption key:** a random 256-bit key (DEK) generated per account, never derived directly from your password. It's wrapped (encrypted) once under a key derived from your password, and once under a key derived from a one-time **recovery code** shown at sign-up. Either one unlocks the same DEK.
- **Forgot your password?** Use the recovery code shown at sign-up (`/recover`). There is no email-based reset — if you lose both the password and the recovery code, that account's data is unrecoverable by design (that's what "encrypted" means).
- **Passwords** are hashed with PBKDF2-SHA256 (120,000 iterations, random per-account salt) before ever touching `localStorage`.
- **Sync auth:** push/pull require a bearer token derived from your password (PBKDF2, independent of the encryption key). The server stores only a hash of it — never the token, never your password. The first push for an email registers the hash (trust-on-first-use); every push/pull after that must match.
- **Known limitation:** resetting your password via `/recover` changes the sync token, which the server doesn't know about yet. The next sync push after a password reset will be rejected until that account's `user_sync` row is manually cleared. Low-impact today (single-user use); worth a proper "re-link" flow if this becomes a real workflow.

---

## Roadmap

- **Server-side accounts** — the architecturally "correct" long-term fix for real password reset (email-based) and multi-device sync without the recovery-code workaround. Requires real user records + sessions on the server, migrating sign-up/sign-in off `localStorage`, and deciding whether to cut over to the normalized SQL tables as the source of truth. Sizable, deliberately scoped as its own future project — not a quick add-on.
- Re-link the sync token automatically after a password reset (see Known limitation above).

---

## Testing

```bash
cd client
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

Vitest, covering the money-math engines and security-critical code: `computeDashboard.ts` (health score, budget pace/rollover, debt plan, net worth, balance reconciliation), `debtEngine.ts` (Snowball/Avalanche simulation), `localData.ts`'s date-math helpers, and `crypto.ts`/`auth.ts` (envelope encryption, password hashing, sign-up/in/recovery flows). No tests on the server side — see [`server/src/lib/normalizeSync.ts`](server/src/lib/normalizeSync.ts)'s fire-and-forget, DB-coupled nature for why that's a deliberate choice, not an oversight.

`tsc --noEmit` and `npm run build` remain the other correctness checks.

---

## Demo

`demo/momentum-planner.jsx` is a standalone interactive planner — the debt payoff simulation and rollover waterfall running on sample data, no backend required. A design reference, not part of the running app.
