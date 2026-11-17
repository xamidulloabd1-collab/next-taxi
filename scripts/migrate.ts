/**
 * Applies prisma/migrations/* in order and records them in `_prisma_migrations`
 * using the same table layout and checksum (sha256 of migration.sql) as
 * `prisma migrate deploy`, so both tools can be used interchangeably.
 *
 * Why: Prisma's native schema-engine binary is downloaded from binaries.prisma.sh,
 * which is blocked on some networks; this runner only needs the `pg` driver.
 */
import "./load-env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");
const LOCK_ID = 727_001; // arbitrary advisory-lock key for migrations

export async function migrate(databaseUrl: string, log: (m: string) => void = console.log): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const done = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null }>(
      `SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
    );
    const byName = new Map(done.rows.map((r) => [r.migration_name, r]));
    const dirs = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    for (const name of dirs) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = byName.get(name);
      if (existing) {
        if (!existing.finished_at) throw new Error(`Migration ${name} previously failed; resolve it manually before continuing.`);
        if (existing.checksum !== checksum) throw new Error(`Migration ${name} was modified after being applied (checksum mismatch).`);
        continue;
      }
      const id = randomUUID();
      log(`Applying ${name} ...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`,
          [id, checksum, name],
        );
        await client.query("COMMIT");
        applied.push(name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
    }
    log(applied.length ? `Applied ${applied.length} migration(s).` : "Database is up to date.");
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith("migrate")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  migrate(url).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
