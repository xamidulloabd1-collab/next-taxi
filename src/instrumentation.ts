/** Next.js server start hook: runs the dispatch loop in-process when DISPATCH_WORKER=inline. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
