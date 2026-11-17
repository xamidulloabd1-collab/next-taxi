import "./scripts/load-env";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma runs through the official `pg` driver adapter with the JS/WASM engines.
// No native engine binaries are downloaded, which keeps installs working behind
// restrictive networks and on small hosting plans.
export default defineConfig({
  experimental: { adapter: true },
  schema: path.join("prisma", "schema.prisma"),
  migrations: { path: path.join("prisma", "migrations"), seed: "tsx prisma/seed.ts" },
  engine: "js",
  async adapter() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    return new PrismaPg({ connectionString: url });
  },
});
