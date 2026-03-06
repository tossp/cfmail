import { describe, it, expect } from "vitest";
import { isBlacklisted, checkJunkMail } from "../spam-filter";
import type { Env } from "../types";

function makeEnv(blacklist: string): Env {
  return { SENDER_BLACKLIST: blacklist } as Env;
}

describe("isBlacklisted", () => {
  it("returns false when blacklist is empty", () => {
    expect(isBlacklisted("user@example.com", makeEnv(""))).toBe(false);
  });

  it("matches exact email address", () => {
    expect(isBlacklisted("spam@evil.com", makeEnv("spam@evil.com"))).toBe(true);
  });

  it("matches domain", () => {
    expect(isBlacklisted("anyone@evil.com", makeEnv("evil.com"))).toBe(true);
  });

  it("does not match partial domain", () => {
    expect(isBlacklisted("user@notevil.com", makeEnv("evil.com"))).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isBlacklisted("User@Evil.COM", makeEnv("evil.com"))).toBe(true);
  });

  it("supports multiple entries", () => {
    const env = makeEnv("spam@x.com, evil.com, bad.org");
    expect(isBlacklisted("spam@x.com", env)).toBe(true);
    expect(isBlacklisted("user@evil.com", env)).toBe(true);
    expect(isBlacklisted("user@bad.org", env)).toBe(true);
    expect(isBlacklisted("user@good.com", env)).toBe(false);
  });
});

describe("checkJunkMail", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it("returns not junk for clean headers", () => {
    const h = headers({
      "authentication-results": "mx.google.com; dkim=pass; spf=pass; dmarc=pass",
    });
    expect(checkJunkMail(h)).toEqual({ isJunk: false });
  });

  it("detects DMARC fail", () => {
    const h = headers({
      "authentication-results": "dmarc=fail (p=reject)",
    });
    const result = checkJunkMail(h);
    expect(result.isJunk).toBe(true);
    expect(result.reason).toContain("DMARC");
  });

  it("detects SPF fail from Authentication-Results", () => {
    const h = headers({
      "authentication-results": "spf=fail smtp.mailfrom=evil.com",
    });
    const result = checkJunkMail(h);
    expect(result.isJunk).toBe(true);
    expect(result.reason).toContain("SPF");
  });

  it("detects SPF softfail from Authentication-Results", () => {
    const h = headers({
      "authentication-results": "spf=softfail",
    });
    const result = checkJunkMail(h);
    expect(result.isJunk).toBe(true);
    expect(result.reason).toContain("softfail");
  });

  it("detects SPF fail from Received-SPF header", () => {
    const h = headers({
      "received-spf": "Fail (protection.outlook.com: ...)",
    });
    const result = checkJunkMail(h);
    expect(result.isJunk).toBe(true);
    expect(result.reason).toContain("SPF");
  });

  it("detects DKIM fail", () => {
    const h = headers({
      "authentication-results": "dkim=fail header.d=evil.com",
    });
    const result = checkJunkMail(h);
    expect(result.isJunk).toBe(true);
    expect(result.reason).toContain("DKIM");
  });

  it("passes when no authentication headers present", () => {
    expect(checkJunkMail(headers({}))).toEqual({ isJunk: false });
  });

  it("SPF pass in Authentication-Results does not trigger rejection", () => {
    const h = headers({
      "authentication-results": "spf=pass smtp.mailfrom=good.com; dkim=pass",
    });
    expect(checkJunkMail(h)).toEqual({ isJunk: false });
  });
});
