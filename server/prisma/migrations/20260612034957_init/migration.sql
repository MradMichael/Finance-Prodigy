BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[dim_user] (
    [id] INT NOT NULL IDENTITY(1,1),
    [email] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [dim_user_currency_df] DEFAULT 'USD',
    [payoff_strategy] NVARCHAR(1000) NOT NULL CONSTRAINT [dim_user_payoff_strategy_df] DEFAULT 'AVALANCHE',
    [ef_target_months] INT NOT NULL CONSTRAINT [dim_user_ef_target_months_df] DEFAULT 6,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [dim_user_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [dim_user_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [dim_user_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[dim_date] (
    [date_key] INT NOT NULL,
    [date] DATE NOT NULL,
    [year] INT NOT NULL,
    [quarter] INT NOT NULL,
    [month] INT NOT NULL,
    [month_name] NVARCHAR(1000) NOT NULL,
    [year_month] NVARCHAR(1000) NOT NULL,
    [week] INT NOT NULL,
    [day_of_month] INT NOT NULL,
    [day_of_week] INT NOT NULL,
    [day_name] NVARCHAR(1000) NOT NULL,
    [is_weekend] BIT NOT NULL,
    CONSTRAINT [dim_date_pkey] PRIMARY KEY CLUSTERED ([date_key]),
    CONSTRAINT [dim_date_date_key] UNIQUE NONCLUSTERED ([date])
);

-- CreateTable
CREATE TABLE [dbo].[dim_category] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [bucket] NVARCHAR(1000) NOT NULL,
    [icon] NVARCHAR(1000),
    [parent_id] INT,
    [is_active] BIT NOT NULL CONSTRAINT [dim_category_is_active_df] DEFAULT 1,
    CONSTRAINT [dim_category_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [dim_category_name_bucket_key] UNIQUE NONCLUSTERED ([name],[bucket])
);

-- CreateTable
CREATE TABLE [dbo].[dim_account] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [dim_account_currency_df] DEFAULT 'USD',
    [is_active] BIT NOT NULL CONSTRAINT [dim_account_is_active_df] DEFAULT 1,
    CONSTRAINT [dim_account_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[fact_transaction] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT NOT NULL,
    [date_key] INT NOT NULL,
    [occurred_at] DATETIME2 NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [flow_type] NVARCHAR(1000) NOT NULL,
    [category_id] INT NOT NULL,
    [account_id] INT NOT NULL,
    [merchant] NVARCHAR(1000),
    [note] NVARCHAR(1000),
    [is_recurring] BIT NOT NULL CONSTRAINT [fact_transaction_is_recurring_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [fact_transaction_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [fact_transaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[fact_debt_payment] (
    [id] INT NOT NULL IDENTITY(1,1),
    [debt_id] INT NOT NULL,
    [user_id] INT NOT NULL,
    [date_key] INT NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [principal_portion] DECIMAL(12,2) NOT NULL,
    [interest_portion] DECIMAL(12,2) NOT NULL,
    [note] NVARCHAR(1000),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [fact_debt_payment_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [fact_debt_payment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[fact_goal_contribution] (
    [id] INT NOT NULL IDENTITY(1,1),
    [goal_id] INT NOT NULL,
    [user_id] INT NOT NULL,
    [date_key] INT NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [note] NVARCHAR(1000),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [fact_goal_contribution_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [fact_goal_contribution_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[fact_monthly_snapshot] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [total_income] DECIMAL(12,2) NOT NULL,
    [needs_spend] DECIMAL(12,2) NOT NULL,
    [wants_spend] DECIMAL(12,2) NOT NULL,
    [savings_amount] DECIMAL(12,2) NOT NULL,
    [debt_balance_end] DECIMAL(12,2) NOT NULL,
    [ef_balance_end] DECIMAL(12,2) NOT NULL,
    [health_score] INT NOT NULL,
    CONSTRAINT [fact_monthly_snapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [fact_monthly_snapshot_user_id_year_month_key] UNIQUE NONCLUSTERED ([user_id],[year],[month])
);

-- CreateTable
CREATE TABLE [dbo].[budget] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [expected_income] DECIMAL(12,2) NOT NULL,
    [needs_pct] INT NOT NULL CONSTRAINT [budget_needs_pct_df] DEFAULT 50,
    [wants_pct] INT NOT NULL CONSTRAINT [budget_wants_pct_df] DEFAULT 30,
    [savings_pct] INT NOT NULL CONSTRAINT [budget_savings_pct_df] DEFAULT 20,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [budget_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [budget_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [budget_user_id_year_month_key] UNIQUE NONCLUSTERED ([user_id],[year],[month])
);

-- CreateTable
CREATE TABLE [dbo].[budget_line] (
    [id] INT NOT NULL IDENTITY(1,1),
    [budget_id] INT NOT NULL,
    [category_id] INT NOT NULL,
    [planned_amount] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [budget_line_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [budget_line_budget_id_category_id_key] UNIQUE NONCLUSTERED ([budget_id],[category_id])
);

-- CreateTable
CREATE TABLE [dbo].[debt] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [lender] NVARCHAR(1000),
    [original_principal] DECIMAL(12,2) NOT NULL,
    [current_balance] DECIMAL(12,2) NOT NULL,
    [apr_pct] DECIMAL(5,2) NOT NULL,
    [minimum_payment] DECIMAL(12,2) NOT NULL,
    [start_date] DATE,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [debt_status_df] DEFAULT 'ACTIVE',
    [created_at] DATETIME2 NOT NULL CONSTRAINT [debt_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [debt_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[goal] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [emoji] NVARCHAR(1000),
    [type] NVARCHAR(1000) NOT NULL CONSTRAINT [goal_type_df] DEFAULT 'CUSTOM',
    [target_amount] DECIMAL(12,2) NOT NULL,
    [starting_amount] DECIMAL(12,2) NOT NULL CONSTRAINT [goal_starting_amount_df] DEFAULT 0,
    [current_amount] DECIMAL(12,2) NOT NULL CONSTRAINT [goal_current_amount_df] DEFAULT 0,
    [target_date] DATE NOT NULL,
    [priority] INT NOT NULL CONSTRAINT [goal_priority_df] DEFAULT 3,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [goal_status_df] DEFAULT 'ACTIVE',
    [created_at] DATETIME2 NOT NULL CONSTRAINT [goal_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [goal_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [dim_date_year_month_composite_idx] ON [dbo].[dim_date]([year], [month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [dim_date_year_month_str_idx] ON [dbo].[dim_date]([year_month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [dim_category_bucket_idx] ON [dbo].[dim_category]([bucket]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [fact_transaction_user_id_date_key_idx] ON [dbo].[fact_transaction]([user_id], [date_key]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [fact_transaction_user_id_flow_type_date_key_idx] ON [dbo].[fact_transaction]([user_id], [flow_type], [date_key]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [fact_transaction_category_id_date_key_idx] ON [dbo].[fact_transaction]([category_id], [date_key]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [fact_debt_payment_user_id_date_key_idx] ON [dbo].[fact_debt_payment]([user_id], [date_key]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [fact_debt_payment_debt_id_date_key_idx] ON [dbo].[fact_debt_payment]([debt_id], [date_key]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [fact_goal_contribution_user_id_date_key_idx] ON [dbo].[fact_goal_contribution]([user_id], [date_key]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [fact_goal_contribution_goal_id_date_key_idx] ON [dbo].[fact_goal_contribution]([goal_id], [date_key]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [debt_user_id_status_idx] ON [dbo].[debt]([user_id], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [goal_user_id_status_idx] ON [dbo].[goal]([user_id], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[dim_category] ADD CONSTRAINT [dim_category_parent_id_fkey] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[dim_category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[dim_account] ADD CONSTRAINT [dim_account_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[fact_transaction] ADD CONSTRAINT [fact_transaction_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[fact_transaction] ADD CONSTRAINT [fact_transaction_date_key_fkey] FOREIGN KEY ([date_key]) REFERENCES [dbo].[dim_date]([date_key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[fact_transaction] ADD CONSTRAINT [fact_transaction_category_id_fkey] FOREIGN KEY ([category_id]) REFERENCES [dbo].[dim_category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[fact_transaction] ADD CONSTRAINT [fact_transaction_account_id_fkey] FOREIGN KEY ([account_id]) REFERENCES [dbo].[dim_account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[fact_debt_payment] ADD CONSTRAINT [fact_debt_payment_debt_id_fkey] FOREIGN KEY ([debt_id]) REFERENCES [dbo].[debt]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[fact_debt_payment] ADD CONSTRAINT [fact_debt_payment_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[fact_debt_payment] ADD CONSTRAINT [fact_debt_payment_date_key_fkey] FOREIGN KEY ([date_key]) REFERENCES [dbo].[dim_date]([date_key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[fact_goal_contribution] ADD CONSTRAINT [fact_goal_contribution_goal_id_fkey] FOREIGN KEY ([goal_id]) REFERENCES [dbo].[goal]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[fact_goal_contribution] ADD CONSTRAINT [fact_goal_contribution_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[fact_goal_contribution] ADD CONSTRAINT [fact_goal_contribution_date_key_fkey] FOREIGN KEY ([date_key]) REFERENCES [dbo].[dim_date]([date_key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[fact_monthly_snapshot] ADD CONSTRAINT [fact_monthly_snapshot_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[budget] ADD CONSTRAINT [budget_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[budget_line] ADD CONSTRAINT [budget_line_budget_id_fkey] FOREIGN KEY ([budget_id]) REFERENCES [dbo].[budget]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[budget_line] ADD CONSTRAINT [budget_line_category_id_fkey] FOREIGN KEY ([category_id]) REFERENCES [dbo].[dim_category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[debt] ADD CONSTRAINT [debt_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[goal] ADD CONSTRAINT [goal_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[dim_user]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
