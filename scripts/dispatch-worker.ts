/** Standalone dispatch worker for DISPATCH_WORKER=external deployments: `npm run worker`. */
import "./load-env";
import { startDispatchWorker } from "../src/features/dispatch/worker";

const stop = startDispatchWorker();
console.log("NEXT TAXI dispatch worker started");
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stop();
    process.exit(0);
  });
}
