import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../api";
import type { Env } from "../types";

vi.mock("../db", () => ({
  listEmails: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, size: 20 }),
  getEmailById: vi.fn().mockResolvedValue(null),
  deleteEmail: vi.fn().mockResolvedValue(null),
  getAttachment: vi.fn().mockResolvedValue(null),
  markAsRead: vi.fn().mockResolvedValue(true),
}));

vi.mock("../storage", () => ({
  getObject: vi.fn().mockResolvedValue(null),
  deleteObjects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../notify", () => ({
  verifyActionSig: vi.fn().mockResolvedValue(false),
}));

const AUTH_TOKEN = "test-secret-token";

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    BUCKET: {} as R2Bucket,
    AUTH_TOKEN,
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

function req(path: string, options?: RequestInit & { headers?: Record<string, string> }): Request {
  return new Request(`http://localhost${path}`, options);
}

function authReq(path: string, options?: RequestInit & { headers?: Record<string, string> }): Request {
  return req(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      ...options?.headers,
    },
  });
}

describe("API Authentication", () => {
  it("returns 401 without auth header", async () => {
    const res = await app.fetch(req("/api/emails"), makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await app.fetch(
      req("/api/emails", { headers: { Authorization: "Bearer wrong-token" } }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct token", async () => {
    const res = await app.fetch(authReq("/api/emails"), makeEnv());
    expect(res.status).toBe(200);
  });
});

describe("UUID Validation", () => {
  it("returns 400 for invalid email ID", async () => {
    const res = await app.fetch(authReq("/api/emails/not-a-uuid"), makeEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid email ID");
  });

  it("accepts valid UUID", async () => {
    const res = await app.fetch(
      authReq("/api/emails/01234567-0123-0123-0123-0123456789ab"),
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/emails", () => {
  it("returns paginated list", async () => {
    const res = await app.fetch(authReq("/api/emails"), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("size");
  });

  it("clamps page and size", async () => {
    const { listEmails } = await import("../db");
    await app.fetch(authReq("/api/emails?page=-5&size=999"), makeEnv());
    expect(listEmails).toHaveBeenCalledWith(expect.anything(), 1, 100, undefined);
  });
});

describe("GET /api/emails/:id", () => {
  it("returns 404 when email not found", async () => {
    const res = await app.fetch(
      authReq("/api/emails/01234567-0123-0123-0123-0123456789ab"),
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns email and marks as read", async () => {
    const { getEmailById, markAsRead } = await import("../db");
    (getEmailById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "01234567-0123-0123-0123-0123456789ab",
      from_address: "sender@test.com",
      to_address: "me@test.com",
      subject: "Hello",
      read_at: null,
      attachments: [],
    });

    const res = await app.fetch(
      authReq("/api/emails/01234567-0123-0123-0123-0123456789ab"),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(markAsRead).toHaveBeenCalledWith(expect.anything(), "01234567-0123-0123-0123-0123456789ab");
  });
});

describe("DELETE /api/emails/:id", () => {
  it("returns 404 when email not found", async () => {
    const res = await app.fetch(
      authReq("/api/emails/01234567-0123-0123-0123-0123456789ab", { method: "DELETE" }),
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("deletes email and R2 objects", async () => {
    const { deleteEmail } = await import("../db");
    const { deleteObjects } = await import("../storage");
    (deleteEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      r2Keys: ["emails/test/raw.eml"],
    });

    const res = await app.fetch(
      authReq("/api/emails/01234567-0123-0123-0123-0123456789ab", { method: "DELETE" }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(deleteObjects).toHaveBeenCalledWith(expect.anything(), ["emails/test/raw.eml"]);
  });
});

describe("Rate Limiting", () => {
  it("returns 429 when rate limit exceeded", async () => {
    const env = makeEnv({
      RATE_LIMITER: {
        limit: vi.fn().mockResolvedValue({ success: false }),
      },
    } as unknown as Partial<Env>);

    const res = await app.fetch(authReq("/api/emails"), env);
    expect(res.status).toBe(429);
  });
});

describe("Signed Delete Endpoint", () => {
  it("returns invalid signature page for bad sig", async () => {
    const res = await app.fetch(
      req("/api/emails/01234567-0123-0123-0123-0123456789ab/delete?sig=bad&ts=123"),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("签名无效");
  });
});
