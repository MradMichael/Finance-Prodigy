// =====================================================================
// MOMENTUM — Financial Motivation Platform
// ---------------------------------------------------------------------
// Dimensional model: classic star schema.
//   • dim_*  → conformed dimensions (user, date, category, account)
//   • fact_* → additive, grain-stable fact tables
//   • budget / debt / goal → operational planning tables (slowly changing)
//
// Design intent:
//   1. Every fact carries date_key (YYYYMMDD int) → single-key join to
//      dim_date, the master calendar. BI tools (Qlik, Power BI) connect
//      directly to Postgres and read the star without any reshaping.
//   2. Physical names are snake_case (@@map / @map) so raw SQL and BI
//      load scripts never need quoted identifiers.
//   3. Money is DECIMAL(12,2) — never floats.
//   4. Heavy aggregations live in SQL views (prisma/analytics_views.sql),
//      not in the API layer. The app reads pre-shaped data.
// =====================================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ----------------------------------------------------------------- //
//  ENUMS                                                             //
// ----------------------------------------------------------------- //

/// 50/30/20 framework buckets. INCOME is modeled as a bucket so the
/// category dimension is complete and every transaction is classifiable.
enum BudgetBucket {
  NEEDS
  WANTS
  SAVINGS
  INCOME
}

enum FlowType {
  INCOME
  EXPENSE
  TRANSFER
}

enum AccountType {
  CHECKING
  SAVINGS
  CREDIT_CARD
  CASH
  INVESTMENT
}

enum GoalType {
  EMERGENCY_FUND
  TRAVEL
  PURCHASE
  EDUCATION
  CUSTOM
}

enum GoalStatus {
  ACTIVE
  ACHIEVED
  PAUSED
  ARCHIVED
}

enum DebtStatus {
  ACTIVE
  PAID_OFF
  ARCHIVED
}

enum PayoffStrategy {
  SNOWBALL  // smallest balance first — motivation via quick wins
  AVALANCHE // highest APR first — mathematically optimal
}

// ----------------------------------------------------------------- //
//  DIMENSIONS                                                        //
// ----------------------------------------------------------------- //

model User {
  id             Int            @id @default(autoincrement())
  email          String         @unique
  name           String
  currency       String         @default("USD")
  /// Preferred debt payoff strategy (drives default dashboard view)
  payoffStrategy PayoffStrategy @default(AVALANCHE) @map("payoff_strategy")
  /// Emergency fund target, in months of essential expenses (3–6)
  efTargetMonths Int            @default(6) @map("ef_target_months")
  createdAt      DateTime       @default(now()) @map("created_at")

  transactions      FactTransaction[]
  budgets           Budget[]
  debts             Debt[]
  goals             Goal[]
  debtPayments      FactDebtPayment[]
  goalContributions FactGoalContribution[]
  snapshots         FactMonthlySnapshot[]
  accounts          DimAccount[]

  @@map("dim_user")
}

/// Master calendar — the conformed time dimension. Seeded 2024–2032
/// by prisma/seed.ts and auto-extended on insert by the API layer.
/// date_key = YYYYMMDD integer (e.g. 20260610) for cheap range scans.
model DimDate {
  dateKey    Int      @id @map("date_key")
  date       DateTime @unique @db.Date
  year       Int
  quarter    Int
  month      Int
  monthName  String   @map("month_name")
  /// 'YYYY-MM' — the natural grain for monthly BI slicing
  yearMonth  String   @map("year_month")
  week       Int
  dayOfMonth Int      @map("day_of_month")
  dayOfWeek  Int      @map("day_of_week")
  dayName    String   @map("day_name")
  isWeekend  Boolean  @map("is_weekend")

  transactions      FactTransaction[]
  debtPayments      FactDebtPayment[]
  goalContributions FactGoalContribution[]

  @@index([year, month])
  @@index([yearMonth])
  @@map("dim_date")
}

/// Two-level category hierarchy (parent → child) mapped to a 50/30/20
/// bucket. Drill path for BI: bucket → parent category → category.
model DimCategory {
  id        Int          @id @default(autoincrement())
  name      String
  bucket    BudgetBucket
  icon      String?
  parentId  Int?         @map("parent_id")
  parent    DimCategory?  @relation("CategoryTree", fields: [parentId], references: [id])
  children  DimCategory[] @relation("CategoryTree")
  isActive  Boolean      @default(true) @map("is_active")

  transactions FactTransaction[]
  budgetLines  BudgetLine[]

  @@unique([name, bucket])
  @@index([bucket])
  @@map("dim_category")
}

model DimAccount {
  id       Int         @id @default(autoincrement())
  userId   Int         @map("user_id")
  user     User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  name     String
  type     AccountType
  currency String      @default("USD")
  isActive Boolean     @default(true) @map("is_active")

  transactions FactTransaction[]

  @@map("dim_account")
}

// ----------------------------------------------------------------- //
//  FACTS                                                             //
// ----------------------------------------------------------------- //

/// Grain: one row per money movement. Amounts are stored POSITIVE;
/// direction comes from flow_type. The signed view (vw_fact_ledger)
/// exposes signed_amount for BI tools.
model FactTransaction {
  id          Int          @id @default(autoincrement())
  userId      Int          @map("user_id")
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  dateKey     Int          @map("date_key")
  date        DimDate      @relation(fields: [dateKey], references: [dateKey])
  occurredAt  DateTime     @map("occurred_at")
  amount      Decimal      @db.Decimal(12, 2)
  flowType    FlowType     @map("flow_type")
  categoryId  Int          @map("category_id")
  category    DimCategory  @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  accountId   Int          @map("account_id")
  account     DimAccount   @relation(fields: [accountId], references: [id], onDelete: Restrict)
  merchant    String?
  note        String?
  isRecurring Boolean      @default(false) @map("is_recurring")
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")

  @@index([userId, dateKey])
  @@index([userId, flowType, dateKey])
  @@index([categoryId, dateKey])
  @@map("fact_transaction")
}

/// Grain: one row per payment toward a debt, split into the interest
/// and principal portions at write time (computed in the API layer)
/// so BI can report "interest burned" without re-deriving amortization.
model FactDebtPayment {
  id               Int      @id @default(autoincrement())
  debtId           Int      @map("debt_id")
  debt             Debt     @relation(fields: [debtId], references: [id], onDelete: Cascade)
  userId           Int      @map("user_id")
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  dateKey          Int      @map("date_key")
  date             DimDate  @relation(fields: [dateKey], references: [dateKey])
  amount           Decimal  @db.Decimal(12, 2)
  principalPortion Decimal  @map("principal_portion") @db.Decimal(12, 2)
  interestPortion  Decimal  @map("interest_portion") @db.Decimal(12, 2)
  note             String?
  createdAt        DateTime @default(now()) @map("created_at")

  @@index([userId, dateKey])
  @@index([debtId, dateKey])
  @@map("fact_debt_payment")
}

/// Grain: one row per contribution toward a goal.
model FactGoalContribution {
  id        Int      @id @default(autoincrement())
  goalId    Int      @map("goal_id")
  goal      Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  userId    Int      @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  dateKey   Int      @map("date_key")
  date      DimDate  @relation(fields: [dateKey], references: [dateKey])
  amount    Decimal  @db.Decimal(12, 2)
  note      String?
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId, dateKey])
  @@index([goalId, dateKey])
  @@map("fact_goal_contribution")
}

/// Periodic snapshot fact (grain: user × month). Written by a
/// month-end job; gives BI tools trend lines (health score, debt
/// balance, savings rate) without scanning the transaction fact.
model FactMonthlySnapshot {
  id             Int     @id @default(autoincrement())
  userId         Int     @map("user_id")
  user           User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  year           Int
  month          Int
  totalIncome    Decimal @map("total_income") @db.Decimal(12, 2)
  needsSpend     Decimal @map("needs_spend") @db.Decimal(12, 2)
  wantsSpend     Decimal @map("wants_spend") @db.Decimal(12, 2)
  savingsAmount  Decimal @map("savings_amount") @db.Decimal(12, 2)
  debtBalanceEnd Decimal @map("debt_balance_end") @db.Decimal(12, 2)
  efBalanceEnd   Decimal @map("ef_balance_end") @db.Decimal(12, 2)
  healthScore    Int     @map("health_score")

  @@unique([userId, year, month])
  @@map("fact_monthly_snapshot")
}

// ----------------------------------------------------------------- //
//  PLANNING TABLES                                                   //
// ----------------------------------------------------------------- //

/// One budget header per user-month. Bucket percentages default to
/// 50/30/20 but are user-tunable; category-level detail in BudgetLine.
model Budget {
  id             Int          @id @default(autoincrement())
  userId         Int          @map("user_id")
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  year           Int
  month          Int
  expectedIncome Decimal      @map("expected_income") @db.Decimal(12, 2)
  needsPct       Int          @default(50) @map("needs_pct")
  wantsPct       Int          @default(30) @map("wants_pct")
  savingsPct     Int          @default(20) @map("savings_pct")
  lines          BudgetLine[]
  createdAt      DateTime     @default(now()) @map("created_at")

  @@unique([userId, year, month])
  @@map("budget")
}

model BudgetLine {
  id            Int         @id @default(autoincrement())
  budgetId      Int         @map("budget_id")
  budget        Budget      @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  categoryId    Int         @map("category_id")
  category      DimCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  plannedAmount Decimal     @map("planned_amount") @db.Decimal(12, 2)

  @@unique([budgetId, categoryId])
  @@map("budget_line")
}

model Debt {
  id                Int        @id @default(autoincrement())
  userId            Int        @map("user_id")
  user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  name              String
  lender            String?
  originalPrincipal Decimal    @map("original_principal") @db.Decimal(12, 2)
  currentBalance    Decimal    @map("current_balance") @db.Decimal(12, 2)
  /// Annual percentage rate, e.g. 24.90
  aprPct            Decimal    @map("apr_pct") @db.Decimal(5, 2)
  minimumPayment    Decimal    @map("minimum_payment") @db.Decimal(12, 2)
  startDate         DateTime?  @map("start_date") @db.Date
  status            DebtStatus @default(ACTIVE)
  createdAt         DateTime   @default(now()) @map("created_at")

  payments FactDebtPayment[]

  @@index([userId, status])
  @@map("debt")
}

model Goal {
  id             Int        @id @default(autoincrement())
  userId         Int        @map("user_id")
  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  emoji          String?
  type           GoalType   @default(CUSTOM)
  targetAmount   Decimal    @map("target_amount") @db.Decimal(12, 2)
  /// Balance the goal started with (denormalized running total below)
  startingAmount Decimal    @default(0) @map("starting_amount") @db.Decimal(12, 2)
  /// Denormalized = starting_amount + SUM(contributions); maintained
  /// transactionally by the API for O(1) dashboard reads.
  currentAmount  Decimal    @default(0) @map("current_amount") @db.Decimal(12, 2)
  targetDate     DateTime   @map("target_date") @db.Date
  priority       Int        @default(3)
  status         GoalStatus @default(ACTIVE)
  createdAt      DateTime   @default(now()) @map("created_at")

  contributions FactGoalContribution[]

  @@index([userId, status])
  @@map("goal")
}
