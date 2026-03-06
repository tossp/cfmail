import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyActionSig, sendNotifications } from "../notify";
import type { Env, EmailRecord } from "../types";

function makeEmail(overrides?: Partial<EmailRecord>): EmailRecord {
  return {
    id: "01234567-0123-0123-0123-0123456789ab",
    message_id: "<test@example.com>",
    from_address: "sender@example.com",
    from_name: "Sender",
    to_address: "me@mydomain.com",
    subject: "Test Subject",
    text: "Hello world",
    html: "<p>Hello world</p>",
    received_at: "2026-03-06T12:00:00.000Z",
    raw_size: 1234,
    has_attachments: 0,
    read_at: null,
    r2_key: "emails/test/raw.eml",
    ...overrides,
  };
}

describe("verifyActionSig", () => {
  const secret = "test-secret-token";

  async function generateSig(id: string, ts: number): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`delete:${id}:${ts}`),
    );
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  it("verifies a valid signature", async () => {
    const ts = Math.floor(Date.now() / 3600_000);
    const sig = await generateSig("email-id-1", ts);
    expect(await verifyActionSig("email-id-1", secret, sig, String(ts))).toBe(true);
  });

  it("rejects wrong id", async () => {
    const ts = Math.floor(Date.now() / 3600_000);
    const sig = await generateSig("email-id-1", ts);
    expect(await verifyActionSig("email-id-2", secret, sig, String(ts))).toBe(false);
  });

  it("rejects wrong secret", async () => {
    const ts = Math.floor(Date.now() / 3600_000);
    const sig = await generateSig("email-id-1", ts);
    expect(await verifyActionSig("email-id-1", "wrong-secret", sig, String(ts))).toBe(false);
  });

  it("rejects expired signature (>72 hours)", async () => {
    const ts = Math.floor(Date.now() / 3600_000) - 73;
    const sig = await generateSig("email-id-1", ts);
    expect(await verifyActionSig("email-id-1", secret, sig, String(ts))).toBe(false);
  });

  it("accepts signature near expiry boundary (72 hours)", async () => {
    const ts = Math.floor(Date.now() / 3600_000) - 72;
    const sig = await generateSig("email-id-1", ts);
    expect(await verifyActionSig("email-id-1", secret, sig, String(ts))).toBe(true);
  });

  it("rejects invalid timestamp", async () => {
    expect(await verifyActionSig("id", secret, "abcdef", "not-a-number")).toBe(false);
  });

  it("rejects tampered signature", async () => {
    const ts = Math.floor(Date.now() / 3600_000);
    const sig = await generateSig("email-id-1", ts);
    const tampered = sig.slice(0, -2) + "ff";
    expect(await verifyActionSig("email-id-1", secret, tampered, String(ts))).toBe(false);
  });
});

describe("sendNotifications", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("skips webhook when URL is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = {
      WEBHOOK_URL: "",
      WEBHOOK_SECRET: "",
      GOTIFY_URL: "",
      GOTIFY_TOKEN: "",
    } as unknown as Env;

    await sendNotifications(env, makeEmail());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends webhook with correct payload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    const env = {
      WEBHOOK_URL: "https://hook.example.com/notify",
      WEBHOOK_SECRET: "",
      GOTIFY_URL: "",
      GOTIFY_TOKEN: "",
    } as unknown as Env;

    const email = makeEmail();
    await sendNotifications(env, email);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hook.example.com/notify");
    expect(opts?.method).toBe("POST");

    const body = JSON.parse(opts?.body as string);
    expect(body.event).toBe("email.received");
    expect(body.id).toBe(email.id);
    expect(body.from).toBe(email.from_address);
  });

  it("includes HMAC signature when secret is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    const env = {
      WEBHOOK_URL: "https://hook.example.com/notify",
      WEBHOOK_SECRET: "my-secret",
      GOTIFY_URL: "",
      GOTIFY_TOKEN: "",
    } as unknown as Env;

    await sendNotifications(env, makeEmail());

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-Webhook-Signature"]).toBeDefined();
    expect(headers["X-Webhook-Signature"].length).toBe(64);
  });

  it("sends gotify notification when configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    const env = {
      WEBHOOK_URL: "",
      WEBHOOK_SECRET: "",
      GOTIFY_URL: "https://gotify.example.com",
      GOTIFY_TOKEN: "app-token",
      SITE_URL: "https://cfmail.example.com",
      AUTH_TOKEN: "test-auth",
    } as unknown as Env;

    await sendNotifications(env, makeEmail());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://gotify.example.com/message?token=app-token");

    const body = JSON.parse(opts?.body as string);
    expect(body.title).toContain("Test Subject");
    expect(body.extras["client::display"]).toEqual({ contentType: "text/markdown" });
    expect(body.extras["client::notification"].click.url).toContain("/api/emails/");
    expect(body.message).toContain("删除");
  });
});
