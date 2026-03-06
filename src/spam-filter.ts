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
  const dmarcResult = getHeaderValue(headers, "dmarc");
  if (dmarcResult === "fail") {
    return { isJunk: true, reason: "DMARC check failed" };
  }

  const spfResult = getHeaderValue(headers, "received-spf");
  if (spfResult === "fail" || spfResult === "softfail") {
    return { isJunk: true, reason: `SPF check: ${spfResult}` };
  }

  const authResults = headers.get("authentication-results") ?? "";
  if (authResults.includes("dkim=fail")) {
    return { isJunk: true, reason: "DKIM check failed" };
  }

  return { isJunk: false };
}

function getHeaderValue(headers: Headers, prefix: string): string {
  const value = headers.get(prefix);
  if (!value) return "";
  return value.trim().toLowerCase().split(/\s+/)[0];
}
