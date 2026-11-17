import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramGatewaySender, type OtpSender } from "@/lib/auth/otp-delivery";

type Call = { method: string; body: Record<string, unknown>; auth: string | null };

function mockGateway(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.split("/").pop()!;
      calls.push({ method, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify(responses[method]), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Telegram Gateway OTP delivery", () => {
  it("explains network failures in development", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }));
    const err = await new TelegramGatewaySender("tok").sendCode("+998771234567", "123456", 300).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/fetch failed: ENOTFOUND.*gatewayapi\.telegram\.org/);
  });

  it("checks ability, then sends our own code with the same (free) request_id and a ttl", async () => {
    const calls = mockGateway({
      checkSendAbility: { ok: true, result: { request_id: "req-1", phone_number: "+998771234567", request_cost: 0.01 } },
      sendVerificationMessage: { ok: true, result: { request_id: "req-1", phone_number: "+998771234567", request_cost: 0.01 } },
    });
    const r = await new TelegramGatewaySender("tok").sendCode("+998771234567", "123456", 300, "challenge-1");
    expect(r).toEqual({ channel: "telegram", providerRef: "req-1" });
    expect(calls.map((c) => c.method)).toEqual(["checkSendAbility", "sendVerificationMessage"]);
    expect(calls[0]!.auth).toBe("Bearer tok");
    expect(calls[1]!.body).toMatchObject({ phone_number: "+998771234567", request_id: "req-1", code: "123456", ttl: 300, payload: "challenge-1" });
  });

  it("rejects numbers without Telegram with a clear error when there is no fallback", async () => {
    mockGateway({ checkSendAbility: { ok: false, error: "PHONE_NUMBER_NOT_FOUND" } });
    await expect(new TelegramGatewaySender("tok").sendCode("+998771234567", "123456", 300)).rejects.toMatchObject({ code: "OTP_NO_TELEGRAM", status: 400 });
  });

  it("falls back to SMS when configured", async () => {
    const calls = mockGateway({ checkSendAbility: { ok: false, error: "PHONE_NUMBER_NOT_FOUND" } });
    const sms: OtpSender = { name: "sms", sendCode: vi.fn(async () => ({ channel: "sms" as const })) };
    const r = await new TelegramGatewaySender("tok", { fallback: sms }).sendCode("+998771234567", "654321", 300);
    expect(r.channel).toBe("sms");
    expect(sms.sendCode).toHaveBeenCalledWith("+998771234567", "654321", 300, undefined);
    expect(calls).toHaveLength(1); // no paid send attempted
  });

  it("treats token/balance problems as a service outage (503), not the user's fault", async () => {
    mockGateway({ checkSendAbility: { ok: false, error: "ACCESS_TOKEN_INVALID" } });
    const err = await new TelegramGatewaySender("bad").sendCode("+998771234567", "123456", 300).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "OTP_TELEGRAM_UNAVAILABLE", status: 503 });
    expect((err as Error).message).toContain("ACCESS_TOKEN_INVALID"); // dev/test builds show the reason
    mockGateway({
      checkSendAbility: { ok: true, result: { request_id: "r", phone_number: "+998771234567" } },
      sendVerificationMessage: { ok: false, error: "BALANCE_NOT_ENOUGH" },
    });
    await expect(new TelegramGatewaySender("tok").sendCode("+998771234567", "123456", 300)).rejects.toMatchObject({ code: "OTP_TELEGRAM_UNAVAILABLE" });
  });
});
