import { env } from "@/lib/env";
import { AppError, Errors } from "@/lib/errors";
import { logger, maskPhone } from "@/lib/logger";
import { getSmsProvider, type SmsProvider } from "@/lib/auth/sms";

export type OtpChannel = "telegram" | "sms" | "console";

export interface OtpDelivery {
  channel: OtpChannel;
  /** Provider reference (Telegram Gateway request_id), for support/debugging. */
  providerRef?: string;
}

/** Delivers a login code to a phone number through some channel. */
export interface OtpSender {
  readonly name: string;
  sendCode(phoneE164: string, code: string, ttlSeconds: number, payload?: string): Promise<OtpDelivery>;
}

export function otpText(code: string) {
  return `NEXT TAXI tasdiqlash kodi: ${code}. Kodni hech kimga bermang.`;
}

/** Sends the code as an SMS through the configured SMS provider (console in development). */
export class SmsOtpSender implements OtpSender {
  readonly name = "sms";
  constructor(private readonly sms: SmsProvider) {}
  async sendCode(phone: string, code: string): Promise<OtpDelivery> {
    await this.sms.send(phone, otpText(code));
    return { channel: this.sms.name === "console" ? "console" : "sms" };
  }
}

interface GatewayResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}
interface RequestStatus {
  request_id: string;
  phone_number: string;
  request_cost?: number;
  remaining_balance?: number;
}

/**
 * Telegram Gateway API (https://core.telegram.org/gateway/api): delivers the code to the Telegram
 * account registered to the phone number — no bot, no prior action by the user.
 *
 * Flow per login: checkSendAbility (fails if the number has no Telegram; otherwise charges one
 * message in advance) → sendVerificationMessage with the same request_id (free) and our own code.
 * The code is still generated, hashed and verified by NEXT TAXI; Telegram only delivers it.
 * Undelivered codes are refunded by Telegram when `ttl` is set. Sending to the token owner's own
 * number is free, which is convenient for testing.
 */
export class TelegramGatewaySender implements OtpSender {
  readonly name = "telegram";
  constructor(
    private readonly token: string,
    private readonly options: { senderUsername?: string; fallback?: OtpSender; baseUrl?: string } = {},
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<GatewayResponse<T>> {
    const res = await fetch(`${this.options.baseUrl ?? "https://gatewayapi.telegram.org"}/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as GatewayResponse<T> | null;
    if (!json) throw new Error(`Telegram Gateway ${method}: HTTP ${res.status} (JSON emas)`);
    return json;
  }

  async sendCode(phone: string, code: string, ttlSeconds: number, payload?: string): Promise<OtpDelivery> {
    let ability: GatewayResponse<RequestStatus>;
    try {
      ability = await this.call<RequestStatus>("checkSendAbility", { phone_number: phone });
    } catch (err) {
      logger.error("Telegram Gateway unreachable", { err, to: maskPhone(phone) });
      const e = err as { message?: string; cause?: { code?: string; message?: string } };
      return this.fallbackOr(phone, code, ttlSeconds, payload, unavailable([e?.message, e?.cause?.code ?? e?.cause?.message].filter(Boolean).join(": ") || "network error"));
    }

    if (!ability.ok || !ability.result) {
      const reason = ability.error ?? "UNKNOWN";
      // Account/billing problems are ours, not the user's: alert and do not blame their number.
      if (/TOKEN|BALANCE|ACCESS|FLOOD|INTERNAL/i.test(reason)) {
        logger.error("Telegram Gateway rejected the request", { reason, to: maskPhone(phone) });
        return this.fallbackOr(phone, code, ttlSeconds, payload, unavailable(reason));
      }
      logger.info("Number cannot receive Telegram codes", { reason, to: maskPhone(phone) });
      return this.fallbackOr(
        phone,
        code,
        ttlSeconds,
        payload,
        new AppError("OTP_NO_TELEGRAM", 400, "Bu raqamda Telegram hisobi topilmadi. Telegram’da ro‘yxatdan o‘tgan raqamni kiriting."),
      );
    }

    const sent = await this.call<RequestStatus>("sendVerificationMessage", {
      phone_number: phone,
      request_id: ability.result.request_id,
      code,
      ttl: Math.min(3600, Math.max(30, ttlSeconds)),
      ...(payload ? { payload: payload.slice(0, 128) } : {}),
      ...(this.options.senderUsername ? { sender_username: this.options.senderUsername } : {}),
    }).catch((err: unknown) => ({ ok: false, error: String((err as Error)?.message ?? err) }) as GatewayResponse<RequestStatus>);

    if (!sent.ok || !sent.result) {
      logger.error("Telegram Gateway send failed", { reason: sent.error, to: maskPhone(phone) });
      return this.fallbackOr(phone, code, ttlSeconds, payload, unavailable(sent.error ?? "send failed"));
    }
    logger.info("OTP sent via Telegram", { to: maskPhone(phone), requestId: sent.result.request_id, cost: sent.result.request_cost, balance: sent.result.remaining_balance });
    return { channel: "telegram", providerRef: sent.result.request_id };
  }

  private async fallbackOr(phone: string, code: string, ttl: number, payload: string | undefined, error: AppError): Promise<OtpDelivery> {
    if (!this.options.fallback) throw error;
    logger.warn("Falling back to SMS for OTP", { to: maskPhone(phone), reason: error.code });
    return this.options.fallback.sendCode(phone, code, ttl, payload);
  }
}

/** Dev-only hints for Gateway errors (production shows only the generic message). */
const GATEWAY_HINTS: [RegExp, string][] = [
  [/ACCESS_TOKEN|TOKEN_INVALID|UNAUTHORIZED/i, "TELEGRAM_GATEWAY_TOKEN noto‘g‘ri: gateway.telegram.org → Account settings dan tokenni qayta nusxalang"],
  [/BALANCE/i, "Gateway balansi yetarli emas: gateway.telegram.org da balansni to‘ldiring (o‘z raqamingizga yuborish bepul)"],
  [/FLOOD|TOO_MANY/i, "Telegram juda ko‘p so‘rov deb hisobladi: birozdan keyin urinib ko‘ring"],
  [/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|abort|timeout/i, "gatewayapi.telegram.org ga ulanib bo‘lmadi: internet, proxy yoki VPN ni tekshiring"],
];

function unavailable(reason: string): AppError {
  const base = "Telegram orqali kod yuborib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.";
  if (process.env.NODE_ENV === "production") return Errors.unavailable("OTP_TELEGRAM_UNAVAILABLE", base);
  const hint = GATEWAY_HINTS.find(([re]) => re.test(reason))?.[1];
  return Errors.unavailable("OTP_TELEGRAM_UNAVAILABLE", `${base} [dev: ${reason}${hint ? ` — ${hint}` : ""}]`);
}

let sender: OtpSender | null = null;

export function getOtpSender(): OtpSender {
  if (sender) return sender;
  const e = env();
  const sms = new SmsOtpSender(getSmsProvider());
  sender =
    e.OTP_CHANNEL === "telegram" && e.TELEGRAM_GATEWAY_TOKEN
      ? new TelegramGatewaySender(e.TELEGRAM_GATEWAY_TOKEN, { senderUsername: e.TELEGRAM_GATEWAY_SENDER, fallback: e.OTP_SMS_FALLBACK ? sms : undefined })
      : sms;
  return sender;
}

export function setOtpSenderForTests(s: OtpSender | null) {
  sender = s;
}
