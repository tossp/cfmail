import type { Env } from "./types";
import { listEmails, getEmailById, deleteEmail, getAttachment } from "./db";
import { getObject, deleteObjects } from "./storage";

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return corsResponse(new Response(null, { status: 204 }));
  }

  if (!authenticate(request, env)) {
    return corsResponse(json({ error: "Unauthorized" }, 401));
  }

  try {
    const response = await route(request, env, url, path);
    return corsResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    console.error("API error:", message);
    return corsResponse(json({ error: message }, 500));
  }
}

async function route(
  request: Request,
  env: Env,
  url: URL,
  path: string,
): Promise<Response> {
  // GET /api/emails
  if (request.method === "GET" && path === "/api/emails") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const size = Math.min(100, Math.max(1, parseInt(url.searchParams.get("size") ?? "20", 10)));
    const to = url.searchParams.get("to") ?? undefined;

    const result = await listEmails(env.DB, page, size, to);
    return json(result);
  }

  // GET /api/emails/:id
  const emailMatch = path.match(/^\/api\/emails\/([^/]+)$/);
  if (request.method === "GET" && emailMatch) {
    const email = await getEmailById(env.DB, emailMatch[1]);
    if (!email) return json({ error: "Not found" }, 404);
    return json(email);
  }

  // GET /api/emails/:id/raw
  const rawMatch = path.match(/^\/api\/emails\/([^/]+)\/raw$/);
  if (request.method === "GET" && rawMatch) {
    const email = await getEmailById(env.DB, rawMatch[1]);
    if (!email) return json({ error: "Not found" }, 404);

    const object = await getObject(env.BUCKET, email.r2_key);
    if (!object) return json({ error: "Raw email not found in storage" }, 404);

    return new Response(object.body, {
      headers: {
        "Content-Type": "message/rfc822",
        "Content-Disposition": `attachment; filename="${email.id}.eml"`,
      },
    });
  }

  // GET /api/emails/:id/attachments/:aid
  const attMatch = path.match(/^\/api\/emails\/([^/]+)\/attachments\/([^/]+)$/);
  if (request.method === "GET" && attMatch) {
    const attachment = await getAttachment(env.DB, attMatch[1], attMatch[2]);
    if (!attachment) return json({ error: "Attachment not found" }, 404);

    const object = await getObject(env.BUCKET, attachment.r2_key);
    if (!object) return json({ error: "Attachment not found in storage" }, 404);

    const filename = attachment.filename ?? attachment.id;
    return new Response(object.body, {
      headers: {
        "Content-Type": attachment.content_type ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // DELETE /api/emails/:id
  const deleteMatch = path.match(/^\/api\/emails\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    const result = await deleteEmail(env.DB, deleteMatch[1]);
    if (!result) return json({ error: "Not found" }, 404);

    await deleteObjects(env.BUCKET, result.r2Keys);
    return json({ success: true });
  }

  return json({ error: "Not found" }, 404);
}

function authenticate(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization");
  if (!header) return false;
  const token = header.replace(/^Bearer\s+/i, "");
  return token === env.AUTH_TOKEN;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
