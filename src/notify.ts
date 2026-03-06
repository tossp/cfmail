import type { Env, EmailRecord } from "./types";

export async function sendNotifications(
  env: Env,
  email: EmailRecord,
): Promise<void> {
  await Promise.allSettled([
    sendWebhook(env, email),
    sendGotify(env, email),
  ]);
}

async function sendGotify(env: Env, email: EmailRecord): Promise<void> {
  const baseUrl = env.GOTIFY_URL?.trim();
  const token = env.GOTIFY_TOKEN?.trim();
  if (!baseUrl || !token) return;

  const from = email.from_name
    ? `${email.from_name} <${email.from_address}>`
    : email.from_address;

  const subject = email.subject ?? "(无主题)";
  const size = formatSize(email.raw_size);
  const att = email.has_attachments > 0 ? " 📎" : "";

  const lines = [
    `**From:** ${from}`,
    `**To:** ${email.to_address}`,
    `**Size:** ${size}${att}`,
  ];
  if (email.text) {
    const preview = email.text.slice(0, 200).trim();
    lines.push("", "---", "", preview + (email.text.length > 200 ? "…" : ""));
  }

  const siteUrl = env.SITE_URL?.trim()?.replace(/\/+$/, "");
  if (siteUrl) {
    const detailUrl = `${siteUrl}/api/emails/${email.id}`;
    const deleteSig = await signAction(`delete:${email.id}`, env.AUTH_TOKEN);
    const deleteUrl = `${detailUrl}/delete?sig=${deleteSig}`;
    lines.push("", `[📋 详情](${detailUrl})  |  [🗑 删除](${deleteUrl})`);
  }

  const extras: Record<string, unknown> = {
    "client::display": { contentType: "text/markdown" },
  };

  if (siteUrl) {
    extras["client::notification"] = {
      click: { url: `${siteUrl}/api/emails/${email.id}` },
    };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/message?token=${token}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `📬 ${subject}`,
      message: lines.join("\n"),
      priority: 5,
      extras,
    }),
  });

  if (!resp.ok) {
    console.error(`Gotify failed: ${resp.status} ${resp.statusText}`);
  }
}

async function sendWebhook(env: Env, email: EmailRecord): Promise<void> {
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

async function signAction(payload: string, secret: string): Promise<string> {
  return sign(payload, secret);
}

export async function verifyActionSig(
  payload: string,
  secret: string,
  sig: string,
): Promise<boolean> {
  const expected = await sign(payload, secret);
  if (expected.length !== sig.length) return false;
  const encoder = new TextEncoder();
  return crypto.subtle.timingSafeEqual(
    encoder.encode(expected),
    encoder.encode(sig),
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
