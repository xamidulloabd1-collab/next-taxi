import { resetDatabase } from "../scripts/db-reset";
import { ensureDatabase, redact, testDatabaseUrl } from "./helpers/test-db";

/** Creates (if needed) and rebuilds the test database from migrations once per test run. */
export default async function setup() {
  const url = testDatabaseUrl();
  try {
    await ensureDatabase(url);
    await resetDatabase(url);
  } catch (err) {
    // Vitest prints "No test files found" when global setup fails; make the real cause obvious.
    console.error(`\n✖ Test database setup failed for ${redact(url)}\n${(err as Error).message}\n`);
    throw err;
  }
}
