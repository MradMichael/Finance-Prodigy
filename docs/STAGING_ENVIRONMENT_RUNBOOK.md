# Staging Environment Setup Runbook

**Status: not executed. Nothing described here exists yet — no Neon branch, no Railway environment, no Vercel project.** Written 2026-08-18 as a ready-to-run guide for after the friends-and-family cohort is live, not before.

## Why

Every live-verification test run against this app so far — all of Amendments 2 and 3 in `docs/AUDIT_2026-08.md` — has hit the real production Neon database, using disposable accounts that then had to be found and purged by hand. That's fine for a pre-launch audit; it stops being fine once real users' money is in the same table. This sets up a second, fully separate database so testing never touches production data again, with the smallest workflow change that actually solves that (**Option B**, decided 2026-08-18): same `main` branch, a second running environment with its own database, no new git branching discipline.

**What this does NOT do:** gate deploys behind a review/promotion step. `main` still deploys straight to production exactly as it does today. This only gives test scripts and manual QA a database to point at that isn't the real one. If a pre-production approval gate is wanted later, that's Option A (dedicated `staging` branch) — a bigger workflow change, deliberately not this one.

## What you'll need

- Access to the Neon console for the existing project (the one `server/.env`'s `DATABASE_URL` currently points at).
- Access to the Railway dashboard for the `finance-prodigy-api` project (currently one environment: `production`).
- Access to the Vercel dashboard for the `atomic-os` team.
- **Check current pricing on both Railway and Neon before starting** (railway.app/pricing, neon.tech/pricing, and each platform's own usage/billing page for the account already in use) — this runbook doesn't quote dollar figures because plan tiers and pricing structures change; verify against the live dashboards, not this document.

---

## Step 1 — Neon: create a branch for staging

This is the piece that actually isolates data. Neon branches are copy-on-write, not a full duplicate — cheap by design.

1. Open the Neon console for the existing project.
2. Create a new branch (suggested name: `staging`).
3. **Do not carry real user data into it.** Depending on what Neon's branch-creation dialog currently offers:
   - If there's an option to create an empty/schema-only branch, use that.
   - If branching always copies the parent's data, branch normally and then immediately connect to the new branch and run `TRUNCATE` (or drop and let migrations rebuild) on every table before anything else touches it. Do this before the branch's connection string is used anywhere.
4. From the new branch's "Connect" panel, copy both connection strings — pooled (for `DATABASE_URL`) and direct (for `DIRECT_URL`) — matching the exact shape already in `server/.env`:
   ```
   DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler/DBNAME?sslmode=require&pgbouncer=true"
   DIRECT_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
   ```
5. Save these somewhere secure temporarily — they're needed in Step 2. Do not commit them anywhere.

## Step 2 — Railway: add a staging environment

1. In the `finance-prodigy-api` project, add a new **Environment** (Railway's own term for this — the project currently has just `production`). Suggested name: `staging`.
2. Add the `finance-prodigy-api` service to the new environment, connected to the same GitHub repo (`MradMichael/Finance-Prodigy`), same `main` branch — this is what makes it Option B: it deploys from the same branch production does, not a different one.
3. Set this environment's variables (do **not** copy production's — these are the new Neon branch's values from Step 1):
   ```
   DATABASE_URL=<staging branch pooled connection string>
   DIRECT_URL=<staging branch direct connection string>
   PORT=4000
   CLIENT_ORIGIN=<comes from Step 3 — placeholder for now, circle back>
   ```
4. Deploy the environment once, then run migrations against the new database (it starts with no schema at all if you branched empty in Step 1):
   ```
   npx prisma migrate deploy
   ```
   run with `DATABASE_URL`/`DIRECT_URL` pointed at the staging branch — either via Railway's own shell/run command against this environment, or locally with those two vars set temporarily in the shell (not written into any committed `.env` file).
5. Note the staging service's public URL (Railway assigns one automatically, distinct from production's `finance-prodigy-api-production.up.railway.app`) — needed in Step 3.

## Step 3 — Vercel: point a client build at the staging API

Vercel's Production/Preview split is tied to branch (production branch = Production environment, everything else = Preview) — that doesn't cleanly give a *stable*, bookmarkable staging URL when both production and staging deploy from the same `main` branch. The straightforward way around that: a second Vercel project, same repo, same branch, independent env vars — the same pattern the real client project already uses, just once more.

1. Create a new Vercel project (suggested name: `finance-prodigy-client-staging`), importing the same GitHub repo.
2. **Root Directory: `client`** — set this explicitly during creation. (This exact setting silently defaulted to `.` on the real project when it was first created via CLI from inside `client/`, and would have broken the first git-triggered build — see `docs/AUDIT_2026-08.md`, 2.6.27. Don't repeat that here.)
3. Set the new project's `API_URL` environment variable (Production scope) to the staging Railway service's URL from Step 2.
4. Deploy. Note the resulting URL — go back to Step 2 and set the staging Railway environment's `CLIENT_ORIGIN` to this URL (needed for the server's CORS config to accept requests from it).
5. Redeploy the Railway staging environment after setting `CLIENT_ORIGIN` so the new value takes effect.

## Step 4 — Verify the whole chain before trusting it

1. Hit the staging API's health check directly: `curl https://<staging-railway-url>/api/health` → expect `{"ok":true,"service":"essa-api"}` — same response shape as production, which is exactly the problem (see the recommended enhancement below).
2. Open the staging Vercel URL, sign up a disposable test account, push, confirm it lands in the **staging** Neon branch (check the Neon console directly, or query staging's `UserSync` table) — and confirm nothing shows up in the **production** database for that same account.
3. Confirm production is completely unaffected: production's `/api/health` and a real (non-destructive) check against `mradmichael@hotmail.com`'s row should show no change.

**Recommended small addition, worth doing as part of this setup rather than after:** `/api/health`'s response is identical in every environment today (`{"ok":true,"service":"essa-api"}`), which makes it easy to misidentify which database a given deployed instance is actually pointed at — exactly the kind of mistake this whole runbook exists to prevent. Consider having the health check also report which environment it's running in (e.g., read from a `RAILWAY_ENVIRONMENT_NAME` var Railway already exposes, or a manually-set `NODE_ENV`-adjacent var), so `curl .../api/health` unambiguously tells you which database you're talking to before you run anything against it.

---

## Ongoing workflow once this exists

- **Every future live-verification script** (the pattern used throughout `docs/AUDIT_2026-08.md`'s Amendment 2/3 testing) should target the staging Vercel/Railway URLs, never the production ones.
- **Schema changes need `prisma migrate deploy` run twice** — once against production (as today), once against staging. Easy to forget since it's a new second step; worth a checklist line in whatever process handles schema changes.
- **Staging data can be wiped freely, whenever, without the ceremony the production purge needed** (see `docs/AUDIT_2026-08.md`, "Production test-data purge") — no exact-list-only requirement, no protected-email check, no pre/post count verification — because nothing real is ever there. A simple `TRUNCATE` of `user_sync` (and the normalized tables) is safe to run on a schedule or before each test session.
- **`main` still deploys straight to production** exactly as today — this setup adds a place to test *before* pushing, it doesn't change what pushing to `main` does.

## What this deliberately does not include

- No dedicated `staging` git branch, no PR-gated promotion flow (that's Option A — a real decision to make later if a pre-production approval step turns out to be wanted, not assumed here).
- No automation for keeping the staging schema in sync with production automatically — the two-migration-runs step above is manual by design until this proves out.
- No changes to the actual application code, beyond the optional health-check enhancement noted in Step 4, which is a suggestion for whoever executes this, not something bundled into this doc.
