import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";

export type AppKind = "passenger" | "driver" | "admin";

export const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "CITY_MANAGER", "SUPPORT_OPERATOR", "FINANCE_MANAGER", "COMPLIANCE_REVIEWER"];

export const SESSION_COOKIES: Record<AppKind, string> = { passenger: "nt_p", driver: "nt_d", admin: "nt_a" };
const SESSION_TTL_SECONDS: Record<AppKind, number> = {
  passenger: 30 * 24 * 3600,
  driver: 30 * 24 * 3600,
  admin: 12 * 3600,
};

export interface AuthContext {
  userId: string;
  phone: string;
  fullName: string | null;
  roles: Role[];
  /** For scoped roles (CITY_MANAGER): role → cityId (null = all cities). */
  roleCities: Partial<Record<Role, string | null>>;
  app: AppKind;
  sessionId: string;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, app: AppKind, meta: { ip?: string; userAgent?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS[app] * 1000);
  await db().session.create({
    data: { userId, app, tokenHash: hashToken(token), expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
  });
  return { token, expiresAt };
}

export function sessionCookieOptions(app: AppKind, expiresAt: Date) {
  return {
    name: SESSION_COOKIES[app],
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/** Resolves a raw session token to an auth context (used by cookie auth and by tests). */
export async function resolveSessionToken(token: string, app: AppKind): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const session = await db().session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { roles: true } } },
  });
  if (!session || session.app !== app || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE" || session.user.deletedAt) return null;

  // Touch at most every 5 minutes to limit write load.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db().session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  const roleCities: AuthContext["roleCities"] = {};
  for (const r of session.user.roles) roleCities[r.role] = r.cityId;
  return {
    userId: session.userId,
    phone: session.user.phone,
    fullName: session.user.fullName,
    roles: session.user.roles.map((r) => r.role),
    roleCities,
    app,
    sessionId: session.id,
  };
}

export async function getAuth(app: AppKind): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIES[app])?.value;
  if (!token) return null;
  return resolveSessionToken(token, app);
}

export async function requireAuth(app: AppKind): Promise<AuthContext> {
  const ctx = await getAuth(app);
  if (!ctx) throw Errors.unauthenticated();
  if (app === "passenger" && !ctx.roles.includes("PASSENGER")) throw Errors.forbidden();
  if (app === "driver" && !ctx.roles.includes("DRIVER")) throw Errors.forbidden();
  if (app === "admin" && !ctx.roles.some((r) => STAFF_ROLES.includes(r))) throw Errors.forbidden();
  return ctx;
}

export async function revokeSession(app: AppKind) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIES[app])?.value;
  if (token) await db().session.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  store.delete(SESSION_COOKIES[app]);
}

export async function revokeAllSessions(userId: string) {
  await db().session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
