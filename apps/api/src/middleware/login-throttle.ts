import type { Context, Next } from "hono";
import { clientIp } from "../lib/client-ip";

/**
 * Attempts per account, independent of the IP. The per-IP limit alone can be
 * sidestepped by rotating addresses (or by reaching the origin past
 * Cloudflare); a password guesser still has to name the account it attacks.
 */
const RULES: Array<{ path: string; max: number; windowMs: number }> = [
  { path: "/api/auth/sign-in/email", max: 10, windowMs: 15 * 60 * 1000 },
  {
    path: "/api/auth/two-factor/verify-totp",
    max: 10,
    windowMs: 15 * 60 * 1000,
  },
  { path: "/api/auth/forget-password", max: 5, windowMs: 60 * 60 * 1000 },
  {
    path: "/api/auth/request-password-reset",
    max: 5,
    windowMs: 60 * 60 * 1000,
  },
  {
    path: "/api/auth/send-verification-email",
    max: 3,
    windowMs: 60 * 60 * 1000,
  },
];

/**
 * Attempts per address. Sign-up names a new account every time, so the
 * per-account rule cannot hold it; on the cloud, where sign-up is open,
 * this keeps one address from creating accounts in bulk.
 */
const IP_RULES: Array<{ path: string; max: number; windowMs: number }> = [
  { path: "/api/auth/sign-up/email", max: 5, windowMs: 60 * 60 * 1000 },
];

const attempts = new Map<string, { count: number; resetAt: number }>();

export function resetLoginThrottle(): void {
  attempts.clear();
}

export async function loginThrottle(c: Context, next: Next) {
  if (c.req.method !== "POST") return next();
  const path = new URL(c.req.url).pathname;
  const ipRule = IP_RULES.find((r) => path.endsWith(r.path));
  if (ipRule) {
    const limited = hit(`${ipRule.path}|ip:${clientIp(c)}`, ipRule);
    if (limited)
      return c.json(
        {
          code: "TOO_MANY_ATTEMPTS",
          message: `Too many sign-ups from this network. Try again in ${limited} minute${limited === 1 ? "" : "s"}.`,
        },
        429
      );
    return next();
  }
  const rule = RULES.find((r) => path.endsWith(r.path));
  if (!rule) return next();

  let subject: string | null = null;
  try {
    // Clone: the auth handler still needs to read the body.
    const body = (await c.req.raw.clone().json()) as { email?: unknown };
    if (typeof body.email === "string")
      subject = body.email.trim().toLowerCase();
  } catch {
    subject = null;
  }
  // TOTP verification has no email in the body; key it by the pending
  // two-factor cookie instead, so a stolen password cannot brute-force codes.
  if (!subject) {
    const cookie = c.req.header("cookie") ?? "";
    const m = cookie.match(/two_factor=([^;]+)/);
    subject = m ? `2fa:${m[1]}` : null;
  }
  if (!subject) return next();

  const key = `${rule.path}|${subject}`;
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + rule.windowMs };
    attempts.set(key, entry);
  }
  entry.count++;
  if (entry.count > rule.max) {
    const minutes = Math.ceil((entry.resetAt - now) / 60000);
    return c.json(
      {
        code: "TOO_MANY_ATTEMPTS",
        message: `Too many attempts for this account. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      },
      429
    );
  }
  if (attempts.size > 50_000) {
    for (const [k, v] of attempts) if (now >= v.resetAt) attempts.delete(k);
  }
  return next();
}

/** Count one attempt; minutes until the window resets when over the limit. */
function hit(
  key: string,
  rule: { max: number; windowMs: number }
): number | null {
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + rule.windowMs };
    attempts.set(key, entry);
  }
  entry.count++;
  return entry.count > rule.max
    ? Math.ceil((entry.resetAt - now) / 60000)
    : null;
}
