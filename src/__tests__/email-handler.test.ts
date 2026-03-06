import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleEmail } from "../email-handler";
import type { Env } from "../types";

vi.mock("../db", () => ({
  insertEmail: vi.fn().mockResolvedValue(undefined),
  insertAttachments: vi.fn().mockResolvedValue(undefined),
  deleteEmail: vi.fn().mockResolvedValue(null),
}));

vi.mock("../storage", () => ({
  putRawEmail: vi.fn().mockResolvedValue(undefined),
  putAttachment: vi.fn().mockResolvedValue(undefined),
  deleteObjects: vi.fn().mockResolvedValue(undefined),
  emailRawKey: (id: string) => `emails/${id}/raw.eml`,
  attachmentKey: (eid: string, aid: string) => `emails/${eid}/attachments/${aid}`,
}));

function makeStream(content: string): ReadableStream {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

function makeMessage(overrides?: Partial<{
  from: string;
  to: string;
  raw: ReadableStream;
  headers: Headers;
}>): ForwardableEmailMessage {
  const rawContent = [
    "From: sender@example.com",
    "To: me@mydomain.com",
    "Subject: Test Email",
    "Message-ID: <test-123@example.com>",
    "Content-Type: text/plain",
    "",
    "Hello, this is a test email.",
  ].join("\r\n");

  return {
    from: overrides?.from ?? "sender@example.com",
    to: overrides?.to ?? "me@mydomain.com",
    raw: overrides?.raw ?? makeStream(rawContent),
    rawSize: 500,
    headers: overrides?.headers ?? new Headers({
      "authentication-results": "dkim=pass; spf=pass; dmarc=pass",
      subject: "Test Email",
      "message-id": "<test-123@example.com>",
    }),
    setReject: vi.fn(),
    forward: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    BUCKET: {} as R2Bucket,
    AUTH_TOKEN: "test-token",
    SENDER_BLACKLIST: "",
    MAX_EMAIL_SIZE: "26214400",
    MAX_ATTACHMENT_SIZE: "10485760",
    RETENTION_DAYS_UNREAD: "30",
    RETENTION_DAYS_READ: "3",
    WEBHOOK_URL: "",
    WEBHOOK_SECRET: "",
    GOTIFY_URL: "",
    GOTIFY_TOKEN: "",
    SITE_URL: "",
    ...overrides,
  } as Env;
}

describe("handleEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects blacklisted sender", async () => {
    const msg = makeMessage({ from: "spam@evil.com" });
    const env = makeEnv({ SENDER_BLACKLIST: "evil.com" });

    const result = await handleEmail(msg, env);

    expect(result).toBeUndefined();
    expect(msg.setReject).toHaveBeenCalledWith("Sender is blacklisted");
  });

  it("rejects junk mail (DMARC fail)", async () => {
    const headers = new Headers({
      "authentication-results": "dmarc=fail",
    });
    const msg = makeMessage({ headers });
    const env = makeEnv();

    const result = await handleEmail(msg, env);

    expect(result).toBeUndefined();
    expect(msg.setReject).toHaveBeenCalledWith("DMARC check failed");
  });

  it("rejects oversized email", async () => {
    const bigContent = "x".repeat(100);
    const msg = makeMessage({ raw: makeStream(bigContent) });
    const env = makeEnv({ MAX_EMAIL_SIZE: "50" });

    const result = await handleEmail(msg, env);

    expect(result).toBeUndefined();
    expect(msg.setReject).toHaveBeenCalledWith("Message too large");
  });

  it("stores email successfully and returns record", async () => {
    const { insertEmail } = await import("../db");
    const { putRawEmail } = await import("../storage");
    const msg = makeMessage();
    const env = makeEnv();

    const result = await handleEmail(msg, env);

    expect(result).toBeDefined();
    expect(result!.from_address).toBe("sender@example.com");
    expect(result!.to_address).toBe("me@mydomain.com");
    expect(insertEmail).toHaveBeenCalledTimes(1);
    expect(putRawEmail).toHaveBeenCalledTimes(1);
    expect(msg.setReject).not.toHaveBeenCalled();
  });

  it("rolls back on R2 upload failure", async () => {
    const { putRawEmail } = await import("../storage");
    const { deleteEmail } = await import("../db");
    (putRawEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("R2 down"));

    const msg = makeMessage();
    const env = makeEnv();

    await expect(handleEmail(msg, env)).rejects.toThrow("R2 down");
    expect(deleteEmail).toHaveBeenCalled();
  });

  it("truncates large text/html in D1 record", async () => {
    const { insertEmail } = await import("../db");

    const longText = "a".repeat(100_000);
    const rawContent = [
      "From: sender@example.com",
      "To: me@mydomain.com",
      "Subject: Large",
      "Content-Type: text/plain",
      "",
      longText,
    ].join("\r\n");

    const msg = makeMessage({ raw: makeStream(rawContent) });
    const env = makeEnv();

    const result = await handleEmail(msg, env);

    expect(result).toBeDefined();
    const savedRecord = (insertEmail as ReturnType<typeof vi.fn>).mock.calls[0][1];
    if (savedRecord.text) {
      expect(new TextEncoder().encode(savedRecord.text).byteLength).toBeLessThanOrEqual(65536);
    }
  });
});
