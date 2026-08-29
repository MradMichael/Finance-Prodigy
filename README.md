# ESSA — Earn · Spend · Save · Achieve

A local-first personal finance tracker: 50/30/20 (or custom) budget tracking, a Financial Health Score, an emergency fund tracker, Snowball/Avalanche debt payoff projections, and milestone goals with required-monthly-contribution math. Supports USD and LBP (Lebanese Pound) with a user-set exchange rate.

**Stack:** Next.js 14 (App Router, TypeScript) + Tailwind CSS + Recharts · Node.js/Express · Postgres (Neon) + Prisma (optional cross-device sync).

---

## How it actually works

**Your financial data lives in your browser, not in a database.** Everything — transactions, goals, debts, recurring payments — is stored in `localStorage`, encrypted at rest (AES-GCM), and all dashboard math (health score, debt payoff plans, goal projections) runs client-side in [`client/lib/computeDashboard.ts`](client/lib/computeDashboard.ts). There is no server-side session or user database backing sign-in.

**The Express + Postgres backend is optional and does two things:**
1. **Sync** (`/api/sync/push` / `/api/sync/pull`) — lets you carry your data to a second device. Push uploads a JSON blob keyed by email; pull downloads it. Protected by a token derived from your account password (see [Security model](#security-model)) — the server never sees your password. **The uploaded blob itself is not client-side-encrypted** the way `localStorage` is — it's stored as plain, readable data (protected by DB access controls + TLS in transit + the sync token instead), because the analytics decomposition below needs to read actual field values. See [`client/app/security/page.tsx`](client/app/security/page.tsx) for the full explanation.
2. **Analytics warehouse** — every push also fires-and-forgets a decomposition of your data into a proper star schema (`dim_date`, `dim_category`, `fact_transaction`, etc. — see [`prisma/schema.prisma`](server/prisma/schema.prisma)) so you can point Power BI / Qlik / Metabase at it later. **The app itself doesn't read this back** — it's a write-only sink today, populated by `server/src/lib/normalizeSync.ts` on every push.

If you never run the server, the app works fully offline — sign-up, sign-in, and all the screens work purely against `localStorage`.

---

## Repository layout

```
Finance-Prodigy/
├── client/                        # Next.js app — the actual product
│   ├── app/
│   │   ├── page.tsx                   # Main app shell: auth gate + all screens (Overview, Budget, Goals, Debts, Transactions)
│   │   ├── error.tsx, global-error.tsx  # Client-side error boundaries (friendly screen, not Next's default crash page)
│   │   ├── sign-in/, sign-up/         # localStorage auth
│   │   ├── recover/                   # Forgot-password flow (recovery code, see Security model)
│   │   ├── profile/                   # Account settings, theme picker, sync push/pull, data export, analytics opt-in
│   │   ├── about/, terms/, privacy/, security/  # FAQ, Terms of Service, Privacy Policy, Trust & Security
│   │   └── admin/                     # Diagnostics: API health, registered users, sync status — gated out of production builds
│   ├── lib/
│   │   ├── auth.ts                    # Sign-up/in/out, password hashing, recovery, sync-relink token
│   │   ├── crypto.ts                  # AES-GCM encryption + the DEK-wrapping scheme behind recovery codes
│   │   ├── localData.ts               # Data types + encrypted localStorage load/save
│   │   ├── computeDashboard.ts        # Pure function: your data → everything the dashboard shows
│   │   ├── syncService.ts             # Push/pull/relink to the Express API (relative /api/* paths)
│   │   └── analytics.ts               # Opt-in, first-party-only product analytics (off by default)
│   ├── components/                    # FinancialDashboard, InputPanel, OnboardingChecklist, EssaBrand, ThemeContext
│   ├── public/                        # manifest.webmanifest, sw.js, icons — PWA/installable support
│   └── next.config.js                 # Proxies /api/* to the Express server (see API_URL below)
├── server/                        # Express API — sync + analytics warehouse only
│   ├── prisma/
│   │   ├── schema.prisma              # Postgres star schema (Neon or any Postgres host)
│   │   ├── analytics_views.sql        # BI-facing views (vw_fact_ledger, vw_monthly_bucket, vw_category_variance)
│   │   └── seed.ts                    # Master calendar, category tree, demo user
│   ├── src/
│   │   ├── index.ts                   # Bootstrap, CORS, helmet, rate limiting, error handling
│   │   ├── routes/sync.ts             # push / pull / relink / delete
│   │   ├── routes/auth.ts             # check-email (interim cross-device duplicate-email warning)
│   │   ├── routes/events.ts           # Analytics event sink — allow-listed event names only
│   │   └── lib/{normalizeSync,logger}.ts  # Star-schema decomposition + structured JSON logging
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

You'll need a Postgres database — [Neon](https://neon.tech) (free tier) works well and is what this is verified against; any Postgres 14+ host works the same way.

```bash
cd server
npm install
cp .env.example .env        # fill in DATABASE_URL + DIRECT_URL — see below
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
| `DATABASE_URL` | `server/.env` | `postgresql://USER:PASSWORD@HOST-pooler/DBNAME?sslmode=require&pgbouncer=true` | Pooled Postgres connection (Prisma) — what the running app uses |
| `DIRECT_URL` | `server/.env` | `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require` | Non-pooled connection — Prisma Migrate needs this because PgBouncer's transaction pooling mode doesn't support the prepared statements migrations use |
| `PORT` | `server/.env` | `4000` | Express listen port |
| `CLIENT_ORIGIN` | `server/.env` | `http://localhost:3000` | CORS allow-origin |
| `API_URL` | `client/.env` | `http://localhost:4000` | Where `next.config.js` proxies `/api/*` to — the browser only ever calls relative `/api/*` paths, so this is the one place that needs to change for a deployed setup (e.g. your Railway API URL) |

On Neon specifically: both URLs come from the same project's Connect panel — `DATABASE_URL` is the default pooled one it shows you, `DIRECT_URL` is the same string with `-pooler` dropped from the hostname and `pgbouncer=true` removed.

---

## Deployment

**Code-side readiness (everything that doesn't require an external account) is done:** input validation, rate limiting, security headers, structured logging, client-side error boundaries, an admin diagnostics page gated to admin accounts only, Terms of Service + Privacy Policy + a Trust & Security page, PWA installability, and a full green run of `tsc --noEmit` + the test suite + production builds for both client and server (Postgres migrations included) against a live Neon database. See [`client/app/security/page.tsx`](client/app/security/page.tsx) for the plain-language version of what is and isn't protected.

**Verified against a real cloud database (Neon):**
- `cd server && npm install && npm run build` (`prisma generate && tsc`) builds clean standalone.
- `npx prisma migrate dev` + `npx prisma db seed` against a live Neon Postgres project, run twice — the seed is genuinely idempotent (second run: 0 rows inserted, all already existed).
- `npm run dev` against Neon's pooled connection, then real `/api/sync/push`, `/pull`, `/relink`, and `DELETE` round trips against it (verified with throwaway test records, cleaned up after).
- `cd client && npm run build && API_URL=http://localhost:4000 npm start` — the **production** build (not `next dev`) serves correctly and `next.config.js`'s `/api/*` rewrite honors `API_URL` as documented.
- CORS: the server always responds with the configured `CLIENT_ORIGIN` value in `Access-Control-Allow-Origin`, regardless of the request's actual `Origin` header — this is what makes a browser reject responses to any page that isn't running at `CLIENT_ORIGIN`, even though a non-browser client like `curl` won't visibly enforce that itself.
- `/admin` redirects any signed-in user whose account isn't marked `isAdmin` (and any signed-out visitor) back to `/`, confirmed against a real production build (`next build && next start`) with a non-admin session.

**Not yet verified — requires an actual account/host, so this is deliberately scoped out until you want to commit to one:**
- Deploying the client to Vercel (or similar) and the server to Railway/Render (or similar) so the API itself is reachable from another device, not just `localhost`. The database side of that is already solved by Neon (or any Postgres host) being reachable over the internet — this remaining gap is purely about hosting the Express process itself.
- A real domain name + SSL certificate.
- Safari/iOS testing on an actual device — the calendar-picker button (`DateFieldDMY` in `client/components/form/Primitives.tsx`) uses `HTMLInputElement.showPicker()`, which has a `.focus()` fallback if unsupported but hasn't been confirmed to feel right on real iOS Safari.
- A rollout decision on whether to open signup to strangers immediately or run a private beta first — recommended, since no amount of code review substitutes for real usage surfacing what it can't predict.

---

## Security model

- **Encryption key:** a random 256-bit key (DEK) generated per account, never derived directly from your password. It's wrapped (encrypted) once under a key derived from your password, and once under a key derived from a one-time **recovery code** shown at sign-up. Either one unlocks the same DEK.
- **Forgot your password?** Use the recovery code shown at sign-up (`/recover`). There is no email-based reset — if you lose both the password and the recovery code, that account's data is unrecoverable by design (that's what "encrypted" means).
- **Passwords** are hashed with PBKDF2-SHA256 (120,000 iterations, random per-account salt) before ever touching `localStorage`.
- **Sync auth:** push/pull require a bearer token derived from your password (PBKDF2, independent of the encryption key). The server stores only a hash of it — never the token, never your password. The first push for an email registers the hash (trust-on-first-use); every push/pull after that must match.
- **Password reset re-links sync automatically.** Resetting your password (`/recover`) changes the sync token, which used to leave the server stuck expecting the old one until the `user_sync` row was cleared by hand. A second, independent token derived from your recovery code (`POST /api/sync/relink`) now proves ownership across the reset instead — the old recovery code is exactly what `/recover` already required you to type in. This only works if the account had synced (pushed) at least once before the reset, since that's the only point a recovery token gets registered server-side in the first place; accounts that had never synced simply register fresh on their next push, same as a brand-new account.
- **Deleting your account also purges the server-side copy.** `DELETE /api/sync` (called automatically from Profile → Delete account) removes the `user_sync` backup row and everything derived from it in the analytics warehouse, not just your local browser data.
- **API hardening:** every request body is validated with zod (malformed requests get a 422, not a crash); `/api/sync/*` and `/api/auth/*` are rate-limited; security headers are set via `helmet`; the admin diagnostics page redirects any signed-in user whose own account isn't marked `isAdmin` (and any signed-out visitor) rather than just being link-hidden.
- **Cross-device signup collisions:** there's no real server-side user registry (see Roadmap below), so `GET /api/auth/check-email` is an interim, narrower check — it can only tell you "this email has synced before," which is enough to warn someone signing up with an email that already has data elsewhere before they invest in an account that'll conflict with it.

---

## Roadmap

- **Server-side accounts** — the architecturally "correct" long-term fix for real password reset (email-based) and multi-device sync without the recovery-code workaround. Requires real user records + sessions on the server, migrating sign-up/sign-in off `localStorage`, and deciding whether to cut over to the normalized SQL tables as the source of truth. Sizable, deliberately scoped as its own future project — not a quick add-on.

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
