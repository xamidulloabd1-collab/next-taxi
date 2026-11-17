import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

const globalForPrisma = globalThis as unknown as { __ntPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter, log: [{ emit: "event", level: "error" }] });
}

/** Lazily created singleton so that importing modules at build time does not require a database. */
export function db(): PrismaClient {
  if (!globalForPrisma.__ntPrisma) globalForPrisma.__ntPrisma = createClient();
  return globalForPrisma.__ntPrisma;
}

export async function disconnectDb() {
  if (globalForPrisma.__ntPrisma) {
    await globalForPrisma.__ntPrisma.$disconnect();
    globalForPrisma.__ntPrisma = undefined;
  }
}

/**
 * Runs `fn` in an interactive transaction, retrying on serialization failures and
 * deadlocks (SQLSTATE 40001 / 40P01), which PostgreSQL may raise under contention.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  opts: { isolationLevel?: Prisma.TransactionIsolationLevel; retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db().$transaction(fn, {
        isolationLevel: opts.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: opts.timeoutMs ?? 10_000,
        maxWait: 5_000,
      });
    } catch (err) {
      if (attempt < retries && isRetryable(err)) {
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 30));
        continue;
      }
      throw err;
    }
  }
}

function isRetryable(err: unknown): boolean {
  const text = String((err as { message?: string })?.message ?? err);
  return /40001|40P01|could not serialize|deadlock detected|P2034/i.test(text);
}

/** True when a Prisma/pg error is a unique-constraint violation (optionally on a specific index). */
export function isUniqueViolation(err: unknown, indexName?: string): boolean {
  const e = err as { code?: string; message?: string; meta?: Record<string, unknown> };
  const text = `${e?.message ?? ""} ${JSON.stringify(e?.meta ?? {})}`;
  const isUnique = e?.code === "P2002" || /23505|unique constraint/i.test(text);
  if (!isUnique) return false;
  return indexName ? text.includes(indexName) : true;
}
