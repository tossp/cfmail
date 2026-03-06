import type { Env, EmailRecord } from "./types";

export async function sendWebhook(env: Env, email: EmailRecord): Promise<void> {
  const url = env.WEBHOOK_URL?.trim();
  if (!url) return;

  const payload = {
    event: "email.received",
    id: email.id,
    from: email.from_address,
    from_name: email.from_name,
    to: email.to_address,
    subject: email.subject,
    received_at: email.received_at,
    has_attachments: email.has_attachments > 0,
    raw_size: email.raw_size,
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "cfmail-webhook/1.0",
  };

  const secret = env.WEBHOOK_SECRET?.trim();
  if (secret) {
    const signature = await sign(body, secret);
    headers["X-Webhook-Signature"] = signature;
  }

  const resp = await fetch(url, { method: "POST", headers, body });
  if (!resp.ok) {
    console.error(`Webhook failed: ${resp.status} ${resp.statusText}`);
  }
}

async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
