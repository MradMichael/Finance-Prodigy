/**
 * An in-memory stand-in for the ONE Prisma client the routes use
 * (src/lib/prisma.ts), implementing exactly the calls they make and nothing
 * else (audit 2.4.156, isolation layer 2). A call the fake does not
 * implement throws, so a route that grows a new query fails its test rather
 * than silently getting `undefined`.
 *
 * Every write is recorded in `writes`, so a test can assert that a refused
 * request wrote NOTHING -- the half of each promise a status code alone
 * cannot show.
 *
 * WHAT THIS CANNOT REPRODUCE (2.4.116), and so no test here claims to:
 * Serializable isolation and its conflicts (P2034) and the P2028 retry;
 * two concurrent requests racing on the unique email; real foreign keys
 * between warehouse tables; database collation. `$transaction` here runs
 * the callback against the same store, one request at a time.
 */
import { Prisma } from "@prisma/client";

/**
 * The standing constraint, enforced in the fixture layer too: no test may
 * use an address on a protected domain, so no test is ever written against
 * something shaped like a real account. Same lists as
 * server/scripts/purge-example-invalid.mjs (PROTECTED_DOMAINS and
 * PROTECTED_LABELS) -- the owner's constraint, guarded in code there first.
 */
const PROTECTED_DOMAINS = ["hotmail.com", "outlook.com", "gmail.com", "googlemail.com", "live.com", "msn.com"];
const PROTECTED_LABELS = ["hotmail.", "outlook.", "gmail.", "googlemail.", "live.", "msn."];
function refuseProtected(email: string): void {
  const domain = String(email).toLowerCase().split("@").pop() ?? "";
  if (PROTECTED_DOMAINS.includes(domain) || PROTECTED_LABELS.some((l) => domain.startsWith(l))) {
    throw new Error(`fakePrisma: refusing a protected-domain address in a test fixture (${domain})`);
  }
}

export interface UserSyncRow {
  id: number;
  email: string;
  dataJson: string;
  authTokenHash: string | null;
  recoveryTokenHash: string | null;
  syncedAt: Date;
}
export interface Write { op: string; table: string; key: string | number }

const WAREHOUSE = ["factTransaction", "factMonthlySnapshot", "goal", "debt", "budget", "dimAccount"] as const;
type WarehouseTable = (typeof WAREHOUSE)[number];

class Store {
  userSync = new Map<string, UserSyncRow>();
  users = new Map<string, { id: number; email: string }>();
  warehouse: Record<WarehouseTable, { userId: number }[]> = {
    factTransaction: [], factMonthlySnapshot: [], goal: [], debt: [], budget: [], dimAccount: [],
  };
  writes: Write[] = [];
  private nextId = 1;

  reset() {
    this.userSync.clear(); this.users.clear();
    for (const t of WAREHOUSE) this.warehouse[t] = [];
    this.writes = []; this.nextId = 1;
  }

  /** Test setup: seed a row WITHOUT recording a write. */
  seedUserSync(row: Partial<UserSyncRow> & { email: string }): UserSyncRow {
    refuseProtected(row.email);
    const full: UserSyncRow = {
      id: this.nextId++, dataJson: "{}", authTokenHash: null, recoveryTokenHash: null,
      syncedAt: new Date("2026-09-20T08:00:00.000Z"), ...row,
    };
    this.userSync.set(full.email, full);
    return full;
  }
  /** Test setup: seed a warehouse user and N rows in each derived table. */
  seedWarehouse(email: string, rowsPerTable = 2): number {
    refuseProtected(email);
    const id = this.nextId++;
    this.users.set(email, { id, email });
    for (const t of WAREHOUSE) for (let i = 0; i < rowsPerTable; i++) this.warehouse[t].push({ userId: id });
    return id;
  }
  warehouseRowsFor(userId: number): number {
    return WAREHOUSE.reduce((n, t) => n + this.warehouse[t].filter((r) => r.userId === userId).length, 0);
  }

  notFound(): never {
    throw new Prisma.PrismaClientKnownRequestError("Record to delete does not exist.", { code: "P2025", clientVersion: "fake" });
  }

  client() {
    const s = this;
    const deleteMany = (t: WarehouseTable) => async ({ where }: { where: { userId: number } }) => {
      const before = s.warehouse[t].length;
      s.warehouse[t] = s.warehouse[t].filter((r) => r.userId !== where.userId);
      const count = before - s.warehouse[t].length;
      s.writes.push({ op: "deleteMany", table: t, key: where.userId });
      return { count };
    };
    const tx = {
      userSync: {
        findUnique: async ({ where }: { where: { email: string } }) => {
          const r = s.userSync.get(where.email);
          return r ? { ...r } : null;
        },
        upsert: async ({ where, create, update }: { where: { email: string }; create: Partial<UserSyncRow>; update: Partial<UserSyncRow> }) => {
          refuseProtected(where.email);
          const existing = s.userSync.get(where.email);
          const next: UserSyncRow = existing
            ? { ...existing, ...update }
            : { id: s.nextId++, email: where.email, dataJson: "{}", authTokenHash: null, recoveryTokenHash: null, syncedAt: new Date(), ...create };
          s.userSync.set(where.email, next);
          s.writes.push({ op: existing ? "upsert:update" : "upsert:create", table: "userSync", key: where.email });
          return { ...next };
        },
        update: async ({ where, data }: { where: { email: string }; data: Partial<UserSyncRow> }) => {
          const existing = s.userSync.get(where.email);
          if (!existing) s.notFound();
          const next = { ...existing, ...data };
          s.userSync.set(where.email, next);
          s.writes.push({ op: "update", table: "userSync", key: where.email });
          return { ...next };
        },
        delete: async ({ where }: { where: { email: string } }) => {
          const existing = s.userSync.get(where.email);
          if (!existing) s.notFound();
          s.userSync.delete(where.email);
          s.writes.push({ op: "delete", table: "userSync", key: where.email });
          return existing;
        },
      },
      user: {
        findUnique: async ({ where }: { where: { email: string } }) => s.users.get(where.email) ?? null,
        delete: async ({ where }: { where: { id: number } }) => {
          const found = [...s.users.values()].find((u) => u.id === where.id);
          if (!found) s.notFound();
          s.users.delete(found.email);
          s.writes.push({ op: "delete", table: "user", key: where.id });
          return found;
        },
      },
      factTransaction: { deleteMany: deleteMany("factTransaction") },
      factMonthlySnapshot: { deleteMany: deleteMany("factMonthlySnapshot") },
      goal: { deleteMany: deleteMany("goal") },
      debt: { deleteMany: deleteMany("debt") },
      budget: { deleteMany: deleteMany("budget") },
      dimAccount: { deleteMany: deleteMany("dimAccount") },
    };
    return {
      ...tx,
      $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
      $disconnect: async () => {},
    };
  }
}

export const store = new Store();
/** What src/lib/prisma exports under test. A Proxy so an unimplemented call throws loudly. */
export const prisma = new Proxy(store.client(), {
  get(target, prop) {
    if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
    if (typeof prop === "symbol" || prop === "then") return undefined;
    throw new Error(`fakePrisma: "${String(prop)}" is not implemented -- a route is using a query the fake does not model`);
  },
});
