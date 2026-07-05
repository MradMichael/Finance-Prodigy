-- CreateTable
CREATE TABLE "dim_user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payoff_strategy" TEXT NOT NULL DEFAULT 'AVALANCHE',
    "ef_target_months" INTEGER NOT NULL DEFAULT 6,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dim_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_date" (
    "date_key" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "month_name" TEXT NOT NULL,
    "year_month" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "day_name" TEXT NOT NULL,
    "is_weekend" BOOLEAN NOT NULL,

    CONSTRAINT "dim_date_pkey" PRIMARY KEY ("date_key")
);

-- CreateTable
CREATE TABLE "dim_category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "icon" TEXT,
    "parent_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dim_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_account" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dim_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_transaction" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date_key" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "flow_type" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "merchant" TEXT,
    "note" TEXT,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fact_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_debt_payment" (
    "id" SERIAL NOT NULL,
    "debt_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date_key" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "principal_portion" DECIMAL(12,2) NOT NULL,
    "interest_portion" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_debt_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_goal_contribution" (
    "id" SERIAL NOT NULL,
    "goal_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date_key" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_goal_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_monthly_snapshot" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "total_income" DECIMAL(12,2) NOT NULL,
    "needs_spend" DECIMAL(12,2) NOT NULL,
    "wants_spend" DECIMAL(12,2) NOT NULL,
    "savings_amount" DECIMAL(12,2) NOT NULL,
    "debt_balance_end" DECIMAL(12,2) NOT NULL,
    "ef_balance_end" DECIMAL(12,2) NOT NULL,
    "health_score" INTEGER NOT NULL,

    CONSTRAINT "fact_monthly_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "expected_income" DECIMAL(12,2) NOT NULL,
    "needs_pct" INTEGER NOT NULL DEFAULT 50,
    "wants_pct" INTEGER NOT NULL DEFAULT 30,
    "savings_pct" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_line" (
    "id" SERIAL NOT NULL,
    "budget_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "planned_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "budget_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lender" TEXT,
    "original_principal" DECIMAL(12,2) NOT NULL,
    "current_balance" DECIMAL(12,2) NOT NULL,
    "apr_pct" DECIMAL(5,2) NOT NULL,
    "minimum_payment" DECIMAL(12,2) NOT NULL,
    "start_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sync" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "auth_token_hash" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "type" TEXT NOT NULL DEFAULT 'CUSTOM',
    "target_amount" DECIMAL(12,2) NOT NULL,
    "starting_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "current_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "target_date" DATE NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dim_user_email_key" ON "dim_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "dim_date_date_key" ON "dim_date"("date");

-- CreateIndex
CREATE INDEX "dim_date_year_month_composite_idx" ON "dim_date"("year", "month");

-- CreateIndex
CREATE INDEX "dim_date_year_month_str_idx" ON "dim_date"("year_month");

-- CreateIndex
CREATE INDEX "dim_category_bucket_idx" ON "dim_category"("bucket");

-- CreateIndex
CREATE UNIQUE INDEX "dim_category_name_bucket_key" ON "dim_category"("name", "bucket");

-- CreateIndex
CREATE INDEX "fact_transaction_user_id_date_key_idx" ON "fact_transaction"("user_id", "date_key");

-- CreateIndex
CREATE INDEX "fact_transaction_user_id_flow_type_date_key_idx" ON "fact_transaction"("user_id", "flow_type", "date_key");

-- CreateIndex
CREATE INDEX "fact_transaction_category_id_date_key_idx" ON "fact_transaction"("category_id", "date_key");

-- CreateIndex
CREATE INDEX "fact_debt_payment_user_id_date_key_idx" ON "fact_debt_payment"("user_id", "date_key");

-- CreateIndex
CREATE INDEX "fact_debt_payment_debt_id_date_key_idx" ON "fact_debt_payment"("debt_id", "date_key");

-- CreateIndex
CREATE INDEX "fact_goal_contribution_user_id_date_key_idx" ON "fact_goal_contribution"("user_id", "date_key");

-- CreateIndex
CREATE INDEX "fact_goal_contribution_goal_id_date_key_idx" ON "fact_goal_contribution"("goal_id", "date_key");

-- CreateIndex
CREATE UNIQUE INDEX "fact_monthly_snapshot_user_id_year_month_key" ON "fact_monthly_snapshot"("user_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "budget_user_id_year_month_key" ON "budget"("user_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "budget_line_budget_id_category_id_key" ON "budget_line"("budget_id", "category_id");

-- CreateIndex
CREATE INDEX "debt_user_id_status_idx" ON "debt"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_sync_email_key" ON "user_sync"("email");

-- CreateIndex
CREATE INDEX "goal_user_id_status_idx" ON "goal"("user_id", "status");

-- AddForeignKey
ALTER TABLE "dim_category" ADD CONSTRAINT "dim_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "dim_category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dim_account" ADD CONSTRAINT "dim_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_transaction" ADD CONSTRAINT "fact_transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_transaction" ADD CONSTRAINT "fact_transaction_date_key_fkey" FOREIGN KEY ("date_key") REFERENCES "dim_date"("date_key") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fact_transaction" ADD CONSTRAINT "fact_transaction_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "dim_category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fact_transaction" ADD CONSTRAINT "fact_transaction_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "dim_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fact_debt_payment" ADD CONSTRAINT "fact_debt_payment_debt_id_fkey" FOREIGN KEY ("debt_id") REFERENCES "debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_debt_payment" ADD CONSTRAINT "fact_debt_payment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fact_debt_payment" ADD CONSTRAINT "fact_debt_payment_date_key_fkey" FOREIGN KEY ("date_key") REFERENCES "dim_date"("date_key") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fact_goal_contribution" ADD CONSTRAINT "fact_goal_contribution_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_goal_contribution" ADD CONSTRAINT "fact_goal_contribution_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fact_goal_contribution" ADD CONSTRAINT "fact_goal_contribution_date_key_fkey" FOREIGN KEY ("date_key") REFERENCES "dim_date"("date_key") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fact_monthly_snapshot" ADD CONSTRAINT "fact_monthly_snapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "dim_category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "debt" ADD CONSTRAINT "debt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dim_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
