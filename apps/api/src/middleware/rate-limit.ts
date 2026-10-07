import type { Context, Next } from "hono";
import { clientIp } from "../lib/client-ip";

const windowMs = 60 * 1000;
/**
 * Per IP and minute. One page of the app loads a dozen endpoints, and an
 * office shares one address — 100 was reached by clicking through a few
 * pages. Logins have their own, much tighter throttle.
 */
const maxRequests = Math.max(
  60,
  Number(process.env.RATE_LIMIT_PER_MINUTE) || 600
);
const store = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(c: Context, next: Next) {
  const key = clientIp(c);
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  entry.count++;
  if (entry.count > maxRequests) {
    return c.json({ error: "Too many requests" }, 429);
  }
  c.header("X-RateLimit-Limit", String(maxRequests));
  c.header(
    "X-RateLimit-Remaining",
    String(Math.max(0, maxRequests - entry.count))
  );
  await next();
}

export function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now >= entry.resetAt) store.delete(key);
  }
}
if (typeof setInterval !== "undefined") {
  setInterval(cleanupRateLimitStore, 60 * 1000);
}
