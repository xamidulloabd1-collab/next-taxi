import { env } from "@/lib/env";
import { logger, maskPhone } from "@/lib/logger";
import { Errors } from "@/lib/errors";

export interface SmsProvider {
  readonly name: string;
  send(phoneE164: string, text: string): Promise<void>;
}

/** Development-only: prints the message to the server log. Rejected by env validation in production. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send(phone: string, text: string) {
    logger.info("[DEV SMS] message not sent; printed instead", { to: maskPhone(phone), text });
  }
}

/**
 * Eskiz.uz adapter (https://documenter.getpostman.com/view/663428/RzfmES4z).
 * NOT verified against the live API from this environment: requires an Eskiz account,
 * an approved sender/template and credentials in ESKIZ_EMAIL / ESKIZ_PASSWORD.
 */
export class EskizSmsProvider implements SmsProvider {
  readonly name = "eskiz";
  private token: { value: string; expiresAt: number } | null = null;
  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly from: string,
    private readonly baseUrl = "https://notify.eskiz.uz/api",
  ) {}

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const form = new FormData();
    form.set("email", this.email);
    form.set("password", this.password);
    const res = await fetch(`${this.baseUrl}/auth/login`, { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Eskiz auth failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { token?: string } };
    const token = body.data?.token;
    if (!token) throw new Error("Eskiz auth response has no token");
    this.token = { value: token, expiresAt: Date.now() + 25 * 24 * 3600 * 1000 };
    return token;
  }

  async send(phone: string, text: string) {
    const token = await this.getToken();
    const form = new FormData();
    form.set("mobile_phone", phone.replace(/^\+/, ""));
    form.set("message", text);
    form.set("from", this.from);
    const res = await fetch(`${this.baseUrl}/message/sms/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) this.token = null;
    if (!res.ok) {
      logger.error("Eskiz SMS send failed", { status: res.status, to: maskPhone(phone) });
      throw Errors.unavailable("SMS_UNAVAILABLE", "SMS yuborib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.");
    }
  }
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (provider) return provider;
  const e = env();
  provider = e.SMS_PROVIDER === "eskiz" ? new EskizSmsProvider(e.ESKIZ_EMAIL ?? "", e.ESKIZ_PASSWORD ?? "", e.ESKIZ_FROM) : new ConsoleSmsProvider();
  return provider;
}

export function setSmsProviderForTests(p: SmsProvider | null) {
  provider = p;
}
