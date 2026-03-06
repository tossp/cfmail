import type { Env } from "./types";

export function isBlacklisted(from: string, env: Env): boolean {
  const list = env.SENDER_BLACKLIST?.trim();
  if (!list) return false;

  const entries = list.split(",").map((s) => s.trim().toLowerCase());
  const sender = from.toLowerCase();

  return entries.some(
    (entry) => sender === entry || sender.endsWith(`@${entry}`),
  );
}

interface JunkResult {
  isJunk: boolean;
  reason?: string;
}

export function checkJunkMail(headers: Headers): JunkResult {
  const authResults = (headers.get("authentication-results") ?? "").toLowerCase();

  const dmarc = extractResult(authResults, "dmarc");
  if (dmarc === "fail") {
    return { isJunk: true, reason: "DMARC check failed" };
  }

  const spf = extractResult(authResults, "spf");
  if (spf === "fail" || spf === "softfail") {
    return { isJunk: true, reason: `SPF check: ${spf}` };
  }

  const spfHeader = headers.get("received-spf")?.trim().toLowerCase().split(/\s+/)[0];
  if (spfHeader === "fail" || spfHeader === "softfail") {
    return { isJunk: true, reason: `SPF check: ${spfHeader}` };
  }

  const dkim = extractResult(authResults, "dkim");
  if (dkim === "fail") {
    return { isJunk: true, reason: "DKIM check failed" };
  }

  return { isJunk: false };
}

function extractResult(authResults: string, mechanism: string): string {
  const re = new RegExp(`${mechanism}\\s*=\\s*(\\w+)`);
  const match = authResults.match(re);
  return match?.[1] ?? "";
}
