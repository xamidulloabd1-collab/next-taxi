/** DEVELOPMENT ONLY: drops and recreates the public schema, then applies all migrations. */
import "./load-env";
import { Client } from "pg";
import { migrate } from "./migrate";

export async function resetDatabase(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  await migrate(url, () => undefined);
}

if (process.argv[1]?.endsWith("db-reset.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
  resetDatabase(url)
    .then(() => console.log("Database reset and migrated."))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
