import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { listEmails, getEmailById, deleteEmail, getAttachment, markAsRead } from "./db";
import { getObject, deleteObjects } from "./storage";

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

app.use("*", cors());

app.use("/api/*", async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header) return c.json({ error: "Unauthorized" }, 401);

  const token = header.replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(token, c.env.AUTH_TOKEN)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
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
