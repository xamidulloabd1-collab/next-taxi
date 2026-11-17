import { z } from "zod";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /**
     * Deployment strictness. Defaults to "production" for production builds. Use "staging" for a
     * production build that may use test SMS/OTP echo (QA, e2e). Real deployments must not set it.
     */
    APP_ENV: z.enum(["development", "staging", "production"]).optional(),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    APP_URL: z.string().url().default("http://localhost:3000"),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    TRUST_PROXY: bool,

    /** Where login codes go: "sms" (SMS_PROVIDER) or "telegram" (Telegram Gateway API). */
    OTP_CHANNEL: z.enum(["sms", "telegram"]).default("sms"),
    TELEGRAM_GATEWAY_TOKEN: z.string().optional(),
    /** Optional verified Telegram channel username shown as the sender. */
    TELEGRAM_GATEWAY_SENDER: z.string().optional(),
    /** With OTP_CHANNEL=telegram: send an SMS when the number has no Telegram account. */
    OTP_SMS_FALLBACK: bool,
    /** Cost guard: maximum login codes sent per day across all users. */
    OTP_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(1).default(1000),
    SMS_PROVIDER: z.enum(["console", "eskiz"]).default("console"),
    ESKIZ_EMAIL: z.string().optional(),
    ESKIZ_PASSWORD: z.string().optional(),
    ESKIZ_FROM: z.string().default("4546"),
    OTP_DEV_ECHO: bool,

    ROUTING_PROVIDER: z.enum(["estimate", "osrm"]).default("estimate"),
    OSRM_URL: z.string().url().optional(),
    ALLOW_ESTIMATED_ROUTING: bool,
    GEOCODING_PROVIDER: z.enum(["none", "nominatim"]).default("none"),
    GEOCODING_URL: z.string().url().optional(),
    GEOCODING_USER_AGENT: z.string().default("NEXT-TAXI/0.1 (set GEOCODING_USER_AGENT with contact email)"),

    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./storage/private"),
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    DISPATCH_WORKER: z.enum(["inline", "external", "off"]).default("inline"),
    DISPATCH_TICK_MS: z.coerce.number().int().min(500).max(60_000).default(2000),
    CRON_SECRET: z.string().min(24).optional(),

    ERROR_WEBHOOK_URL: z.string().url().optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .transform((e) => ({ ...e, APP_ENV: e.APP_ENV ?? (e.NODE_ENV === "production" ? "production" : "development") }))
  .superRefine((env, ctx) => {
    if (env.OTP_CHANNEL === "telegram" && !env.TELEGRAM_GATEWAY_TOKEN)
      ctx.addIssue({ code: "custom", path: ["TELEGRAM_GATEWAY_TOKEN"], message: "TELEGRAM_GATEWAY_TOKEN is required when OTP_CHANNEL=telegram" });
    if (env.APP_ENV !== "production") return;
    if (env.OTP_DEV_ECHO) ctx.addIssue({ code: "custom", path: ["OTP_DEV_ECHO"], message: "OTP_DEV_ECHO must be false in production" });
    const usesSms = env.OTP_CHANNEL === "sms" || env.OTP_SMS_FALLBACK;
    if (usesSms && env.SMS_PROVIDER === "console")
      ctx.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "Configure a real SMS provider in production" });
    if (env.SMS_PROVIDER === "eskiz" && (!env.ESKIZ_EMAIL || !env.ESKIZ_PASSWORD))
      ctx.addIssue({ code: "custom", path: ["ESKIZ_EMAIL"], message: "Eskiz credentials are required" });
    if (env.ROUTING_PROVIDER === "estimate" && !env.ALLOW_ESTIMATED_ROUTING)
      ctx.addIssue({
        code: "custom",
        path: ["ROUTING_PROVIDER"],
        message: "Estimated routing is not allowed in production unless ALLOW_ESTIMATED_ROUTING=true",
      });
    if (env.ROUTING_PROVIDER === "osrm" && !env.OSRM_URL) ctx.addIssue({ code: "custom", path: ["OSRM_URL"], message: "OSRM_URL is required" });
    if (!env.APP_URL.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "APP_URL must use HTTPS in production" });
    if (env.STORAGE_PROVIDER === "s3" && (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY))
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3 storage requires endpoint, bucket and credentials" });
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated server environment. Throws a readable error listing every invalid variable. */
export function env(): Env {
  if (cached) return cached;
  // `KEY=` lines in .env files arrive as empty strings; treat them as "not set".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests that mutate process.env. */
export function resetEnvCache() {
  cached = null;
}
