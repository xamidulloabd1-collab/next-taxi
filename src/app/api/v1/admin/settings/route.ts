import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { audit } from "@/lib/audit";
import { adminRoute } from "@/features/admin/guard";
import { SETTING_DEFINITIONS, setSetting, type SettingKey } from "@/features/settings/service";

const keys = Object.keys(SETTING_DEFINITIONS) as [SettingKey, ...SettingKey[]];
const valueSchemas: Record<SettingKey, z.ZodTypeAny> = {
  arrival_radius_meters: z.number().int().min(50).max(2000),
  location_update_min_interval_seconds: z.number().int().min(1).max(60),
  support_phone: z.string().trim().max(20),
  passenger_cancel_reasons: z.array(z.string().trim().min(2).max(60)).min(1).max(10),
};

export const PATCH = adminRoute("settings.manage", async (req, meta) => {
  const body = await parseJson(req, z.object({ key: z.enum(keys), value: z.unknown() }));
  const value = valueSchemas[body.key].parse(body.value);
  const r = await setSetting(body.key, value, meta.ctx.userId);
  await audit({ actorId: meta.ctx.userId, action: "setting.update", entityType: "system_setting", entityId: body.key, before: r.before?.value, after: value, ip: meta.ip, userAgent: meta.userAgent });
  return json({ key: body.key, value });
});
