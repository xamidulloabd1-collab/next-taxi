import type { DriverStatus } from "@prisma/client";

export const DRIVER_STATUS: Record<DriverStatus, { l: string; t: "success" | "warn" | "danger" | "neutral" }> = {
  PENDING_DOCUMENTS: { l: "Ariza to‘ldirilmoqda", t: "neutral" },
  PENDING_REVIEW: { l: "Tekshiruvda", t: "warn" },
  APPROVED: { l: "Tasdiqlangan", t: "success" },
  REJECTED: { l: "Rad etilgan", t: "danger" },
  SUSPENDED: { l: "To‘xtatilgan", t: "danger" },
};
