import "../../scripts/load-env";
import { Client } from "pg";

/**
 * Test database URL. Uses TEST_DATABASE_URL when set; otherwise takes DATABASE_URL from the
 * environment/.env (same host, port and credentials) and swaps the database name for
 * `nexttaxi_test`, so tests never touch the development database.
 */
export function testDatabaseUrl(dbName = "nexttaxi_test"): string {
  if (process.env.TEST_DATABASE_URL && dbName === "nexttaxi_test") return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "postgresql://nexttaxi:nexttaxi_dev@localhost:5432/nexttaxi?schema=public";
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export function redact(url: string) {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}

/** Creates the database if it does not exist (connects to the server's `postgres` database). */
export async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = "/postgres";
  admin.search = "";
  const client = new Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Cannot connect to PostgreSQL at ${redact(admin.toString())} (${(err as Error).message || (err as { code?: string }).code}).\n` +
        `  • Is the database running? docker compose up -d db  →  docker compose ps (check the published port)\n` +
        `  • The port must match DATABASE_URL in .env (or set TEST_DATABASE_URL).`,
    );
  }
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}
