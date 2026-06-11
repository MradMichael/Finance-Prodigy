/**
 * MOMENTUM — Database seed
 * Run: npx prisma db seed
 *
 * Seeds:
 *  1. dim_date     — master calendar 2024-01-01 → 2032-12-31
 *  2. dim_category — default 50/30/20 tree
 *  3. dim_user     — demo user + two accounts
 */
import { PrismaClient, BudgetBucket, AccountType } from "@prisma/client";

const prisma = new PrismaClient();

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function buildCalendarYear(year: number) {
  const rows = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const dow = d.getUTCDay();
    rows.push({
      dateKey: y * 10000 + m * 100 + day,
      date: new Date(d),
      year: y,
      quarter: Math.ceil(m / 3),
      month: m,
      monthName: MONTHS[m - 1],
      yearMonth: `${y}-${String(m).padStart(2, "0")}`,
      week: Math.ceil((Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7),
      dayOfMonth: day,
      dayOfWeek: dow,
      dayName: DAYS[dow],
      isWeekend: dow === 0 || dow === 6,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return rows;
}

const CATEGORY_TREE: Record<BudgetBucket, string[]> = {
  NEEDS:   ["Rent / Mortgage", "Groceries", "Utilities", "Transport & Fuel",
            "Insurance", "Healthcare", "Phone & Internet", "Debt Minimums"],
  WANTS:   ["Dining Out", "Entertainment", "Shopping", "Subscriptions",
            "Fitness & Hobbies", "Travel & Experiences", "Gifts"],
  SAVINGS: ["Emergency Fund", "Goal Contributions", "Investments", "Extra Debt Payments"],
  INCOME:  ["Salary", "Freelance & Side Income", "Business Income", "Other Income"],
};

async function main() {
  // 1) Master calendar — chunked per year to stay well under the
  //    Postgres bind-parameter ceiling.
  for (let year = 2024; year <= 2032; year++) {
    await prisma.dimDate.createMany({ data: buildCalendarYear(year), skipDuplicates: true });
    console.log(`dim_date ✓ ${year}`);
  }

  // 2) Category dimension
  for (const [bucket, names] of Object.entries(CATEGORY_TREE) as [BudgetBucket, string[]][]) {
    for (const name of names) {
      await prisma.dimCategory.upsert({
        where: { name_bucket: { name, bucket } },
        update: {},
        create: { name, bucket },
      });
    }
  }
  console.log("dim_category ✓");

  // 3) Demo user + accounts (replace with real auth provisioning later)
  const user = await prisma.user.upsert({
    where: { email: "demo@momentum.app" },
    update: {},
    create: {
      email: "demo@momentum.app",
      name: "Demo User",
      currency: "USD",
      efTargetMonths: 6,
      accounts: {
        create: [
          { name: "Main Checking", type: AccountType.CHECKING },
          { name: "High-Yield Savings", type: AccountType.SAVINGS },
        ],
      },
    },
  });
  console.log(`dim_user ✓ (id=${user.id})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
