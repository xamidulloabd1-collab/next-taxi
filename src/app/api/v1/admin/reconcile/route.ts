import { json } from "@/lib/http";
import { adminRoute } from "@/features/admin/guard";
import { reconcile } from "@/features/payments/service";

export const GET = adminRoute("finance.view", async () => json({ issues: await reconcile(), checkedAt: new Date().toISOString() }));
