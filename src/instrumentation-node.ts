import { startDispatchWorker } from "./features/dispatch/worker";

if ((process.env.DISPATCH_WORKER ?? "inline") === "inline") startDispatchWorker();
