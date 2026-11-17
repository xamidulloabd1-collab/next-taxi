/** Daily maintenance: purges expired auth/idempotency/quote data. Schedule with cron: `npm run maintenance:retention`. */
import "./load-env";
import { runRetention } from "../src/features/privacy/service";
import { disconnectDb } from "../src/lib/db/prisma";

runRetention()
  .then((r) => console.log(JSON.stringify({ level: "info", msg: "retention complete", ...r })))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
