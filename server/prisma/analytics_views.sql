-- =====================================================================
-- MOMENTUM — Analytics layer (run once after `prisma migrate dev`):
--   npx prisma db execute --file ./prisma/analytics_views.sql --schema ./prisma/schema.prisma
--
-- Architecture rule: heavy aggregation lives HERE, not in the API.
-- The Express layer and any BI tool (Qlik / Power BI / Metabase)
-- read these views directly, so every consumer sees the same numbers.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) vw_fact_ledger — the canonical signed ledger.
--    One row per transaction, fully conformed (date + category +
--    account attributes flattened). This is THE table to point a BI
--    tool at for transaction-level detail.
--    NOTE: income is never written as a fact_transaction row (the
--    client's data model treats income as a flat monthly setting, not
--    a dated transaction) — flow_type is always EXPENSE or SAVINGS in
--    practice, so signed_amount here is always <= 0 and sums to
--    -(total spend), not net cash flow. For a number that actually
--    nets against income, use vw_monthly_bucket (below), which sources
--    income from fact_monthly_snapshot instead.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_fact_ledger AS
SELECT
    t.id,
    t.user_id,
    t.date_key,
    d.date,
    d.year,
    d.quarter,
    d.month,
    d.year_month,
    c.bucket,
    c.name                        AS category,
    a.name                        AS account,
    a.type                        AS account_type,
    t.flow_type,
    t.amount,
    CASE WHEN t.flow_type = 'INCOME' THEN t.amount ELSE -t.amount END
                                  AS signed_amount,
    t.merchant,
    t.is_recurring
FROM fact_transaction t
JOIN dim_date     d ON d.date_key = t.date_key
JOIN dim_category c ON c.id       = t.category_id
JOIN dim_account  a ON a.id       = t.account_id;

-- ---------------------------------------------------------------------
-- 2) vw_monthly_bucket — user × month × bucket rollup with share of
--    income. date_key/100 yields YYYYMM via integer division: cheap,
--    index-friendly month math with no date functions.
--    Powers: 50/30/20 tracking, the cash-flow trend, the health score.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_monthly_bucket AS
WITH inc AS (
    -- Income is never a fact_transaction row (see vw_fact_ledger's note
    -- above) — fact_monthly_snapshot.total_income is the real source of
    -- truth, written once per user × month by normalizeToTables.
    SELECT user_id,
           year * 100 + month AS ym_key,
           total_income        AS income
    FROM fact_monthly_snapshot
),
exp AS (
    -- Includes SAVINGS alongside EXPENSE: normalizeToTables writes the
    -- SAVINGS bucket's own flow_type ('SAVINGS', not 'EXPENSE'), so an
    -- EXPENSE-only filter silently dropped every savings contribution
    -- from this rollup — the bucket would never appear in the results.
    SELECT t.user_id,
           t.date_key / 100 AS ym_key,
           c.bucket,
           SUM(t.amount)    AS spend
    FROM fact_transaction t
    JOIN dim_category c ON c.id = t.category_id
    WHERE t.flow_type IN ('EXPENSE', 'SAVINGS')
    GROUP BY 1, 2, 3
)
SELECT
    e.user_id,
    e.ym_key,
    e.ym_key / 100                                    AS year,
    e.ym_key % 100                                    AS month,
    e.bucket,
    e.spend,
    COALESCE(i.income, 0)                             AS income,
    ROUND(e.spend / NULLIF(i.income, 0) * 100, 1)     AS pct_of_income
FROM exp e
LEFT JOIN inc i
       ON i.user_id = e.user_id AND i.ym_key = e.ym_key;

-- ---------------------------------------------------------------------
-- 3) vw_category_variance — the "How Much" engine. Planned (budget_line)
--    vs actual per user × month × category. Positive variance = under
--    budget (money kept), negative = over.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_category_variance AS
SELECT
    b.user_id,
    b.year,
    b.month,
    c.id                                       AS category_id,
    c.name                                     AS category,
    c.bucket,
    bl.planned_amount,
    COALESCE(act.actual, 0)                    AS actual_amount,
    bl.planned_amount - COALESCE(act.actual,0) AS variance,
    ROUND(COALESCE(act.actual, 0)
          / NULLIF(bl.planned_amount, 0) * 100, 1) AS pct_consumed
FROM budget b
JOIN budget_line  bl ON bl.budget_id  = b.id
JOIN dim_category c  ON c.id          = bl.category_id
LEFT JOIN (
    -- Includes SAVINGS alongside EXPENSE — same reasoning as vw_monthly_bucket's
    -- exp CTE above: the SAVINGS budget line otherwise always shows 0% consumed
    -- no matter how much was actually contributed.
    SELECT t.user_id,
           t.date_key / 10000        AS year,
           (t.date_key / 100) % 100  AS month,
           t.category_id,
           SUM(t.amount)             AS actual
    FROM fact_transaction t
    WHERE t.flow_type IN ('EXPENSE', 'SAVINGS')
    GROUP BY 1, 2, 3, 4
) act ON act.user_id     = b.user_id
     AND act.year        = b.year
     AND act.month       = b.month
     AND act.category_id = bl.category_id;

-- ---------------------------------------------------------------------
-- Scaling note: when fact_transaction grows past a few million rows,
-- promote vw_monthly_bucket to a MATERIALIZED VIEW and refresh it from
-- a nightly job (or after batch imports):
--
--   CREATE MATERIALIZED VIEW mv_monthly_bucket AS SELECT * FROM vw_monthly_bucket;
--   CREATE UNIQUE INDEX ON mv_monthly_bucket (user_id, ym_key, bucket);
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_bucket;
-- ---------------------------------------------------------------------
