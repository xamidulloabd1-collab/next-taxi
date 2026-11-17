/** Loads ./.env for CLI scripts (Next.js loads it itself). Existing variables are never overridden. */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
