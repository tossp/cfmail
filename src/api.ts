import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { listEmails, getEmailById, deleteEmail, getAttachment, markAsRead } from "./db";
import { getObject, deleteObjects } from "./storage";
import { verifyActionSig } from "./notify";
import { log } from "./log";

type HonoEnv = { Bindings: Env };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = new Hono<HonoEnv>();

app.onError((err, c) => {
  log.error("api.error", {
    method: c.req.method,
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err),
  });
  return c.json({ error: "Internal server error" }, 500);
});

app.use("*", cors());

app.get("/api/emails/:id/delete", async (c) => {
  const id = c.req.param("id");
  const sig = c.req.query("sig") ?? "";
  const html = (title: string, msg: string, ok: boolean) =>
    c.html(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
        `<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;` +
        `background:#${ok ? "f0fdf4" : "fef2f2"}}div{text-align:center;padding:2rem}h1{font-size:2rem}p{color:#666}</style></head>` +
        `<body><div><h1>${ok ? "✅" : "❌"}</h1><h1>${title}</h1><p>${msg}</p></div></body></html>`,
    );

  const ts = c.req.query("ts") ?? "";
  if (!sig || !ts || !(await verifyActionSig(id, c.env.AUTH_TOKEN, sig, ts))) {
    return html("签名无效", "此链接无效或已过期", false);
  }

  const result = await deleteEmail(c.env.DB, id);
  if (!result) return html("邮件不存在", "该邮件可能已被删除", false);

  await deleteObjects(c.env.BUCKET, result.r2Keys);
  return html("已删除", "邮件已成功删除", true);
});

app.use("/api/*", async (c, next) => {
  if (c.req.path.endsWith("/delete") && c.req.query("sig")) {
    return next();
  }

  if (c.env.RATE_LIMITER) {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
    if (!success) return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const header = c.req.header("Authorization");
  if (!header) return c.json({ error: "Unauthorized" }, 401);

  const token = header.replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(token, c.env.AUTH_TOKEN)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

app.use("/api/emails/:id{.+}", async (c, next) => {
  const id = c.req.param("id");
  if (id && !UUID_RE.test(id)) return c.json({ error: "Invalid email ID" }, 400);
  const aid = c.req.param("aid");
  if (aid && !UUID_RE.test(aid)) return c.json({ error: "Invalid attachment ID" }, 400);
  await next();
});

app.get("/api/emails", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const size = Math.min(100, Math.max(1, parseInt(c.req.query("size") ?? "20", 10)));
  const to = c.req.query("to") ?? undefined;

  const result = await listEmails(c.env.DB, page, size, to);
  return c.json(result);
});

app.get("/api/emails/:id", async (c) => {
  const email = await getEmailById(c.env.DB, c.req.param("id"));
  if (!email) return c.json({ error: "Not found" }, 404);

  await markAsRead(c.env.DB, email.id);
  if (!email.read_at) email.read_at = new Date().toISOString();
  return c.json(email);
});

app.get("/api/emails/:id/raw", async (c) => {
  const email = await getEmailById(c.env.DB, c.req.param("id"));
  if (!email) return c.json({ error: "Not found" }, 404);

  const object = await getObject(c.env.BUCKET, email.r2_key);
  if (!object) return c.json({ error: "Raw email not found in storage" }, 404);

  await markAsRead(c.env.DB, email.id);
  return new Response(object.body, {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="${email.id}.eml"`,
    },
  });
});

app.get("/api/emails/:id/attachments/:aid", async (c) => {
  const { id, aid } = c.req.param();
  const attachment = await getAttachment(c.env.DB, id, aid);
  if (!attachment) return c.json({ error: "Attachment not found" }, 404);

  const object = await getObject(c.env.BUCKET, attachment.r2_key);
  if (!object) return c.json({ error: "Attachment not found in storage" }, 404);

  await markAsRead(c.env.DB, id);
  const filename = attachment.filename ?? attachment.id;
  return new Response(object.body, {
    headers: {
      "Content-Type": attachment.content_type ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

app.patch("/api/emails/:id/read", async (c) => {
  const id = c.req.param("id");
  const updated = await markAsRead(c.env.DB, id);
  if (!updated) {
    const exists = await getEmailById(c.env.DB, id);
    if (!exists) return c.json({ error: "Not found" }, 404);
    return c.json({ success: true, already_read: true });
  }
  return c.json({ success: true });
});

app.delete("/api/emails/:id", async (c) => {
  const result = await deleteEmail(c.env.DB, c.req.param("id"));
  if (!result) return c.json({ error: "Not found" }, 404);

  await deleteObjects(c.env.BUCKET, result.r2Keys);
  return c.json({ success: true });
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    const dummy = new Uint8Array(a.length);
    crypto.subtle.timingSafeEqual(dummy, dummy);
    return false;
  }
  const encoder = new TextEncoder();
  return crypto.subtle.timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

export default app;
