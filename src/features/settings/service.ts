import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db/prisma";

/** Typed system settings with defaults and a short in-process cache. */
export const SETTING_DEFINITIONS = {
  arrival_radius_meters: { default: 400, description: "Haydovchi 'Yetib keldim' bosishi uchun olib ketish nuqtasigacha maksimal masofa (m)" },
  location_update_min_interval_seconds: { default: 3, description: "Haydovchi GPS yangilanishlari orasidagi minimal interval (soniya)" },
  support_phone: { default: "", description: "Ilovada ko‘rsatiladigan qo‘llab-quvvatlash telefoni" },
  passenger_cancel_reasons: {
    default: ["Rejam o‘zgardi", "Haydovchi juda uzoqda", "Xato manzil kiritdim", "Boshqa sabab"],
    description: "Yo‘lovchi bekor qilish sabablari",
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 30_000;

export async function getSetting<T>(key: SettingKey, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const row = await db().systemSetting.findUnique({ where: { key } });
  const value = (row?.value as T | undefined) ?? fallback;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key: SettingKey, value: unknown, updatedById: string) {
  const json = value as Prisma.InputJsonValue;
  const before = await db().systemSetting.findUnique({ where: { key } });
  const after = await db().systemSetting.upsert({
    where: { key },
    create: { key, value: json, description: SETTING_DEFINITIONS[key].description, updatedById },
    update: { value: json, updatedById },
  });
  cache.delete(key);
  return { before, after };
}

export async function listSettings() {
  const rows = await db().systemSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => ({
    key,
    description: SETTING_DEFINITIONS[key].description,
    value: byKey.get(key)?.value ?? SETTING_DEFINITIONS[key].default,
    isDefault: !byKey.has(key),
    updatedAt: byKey.get(key)?.updatedAt ?? null,
  }));
}
