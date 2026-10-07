import crypto from "node:crypto";

const PREFIX = "pca_";

/**
 * A new agent token. 32 random bytes — far beyond guessing — and only the
 * SHA-256 is stored, so the plaintext exists exactly once: in the response
 * that shows it to the person installing the agent.
 *
 * A plain hash (no salt, no KDF) is enough here: the token is random, not a
 * human-chosen password, so there is nothing for a dictionary to find.
 */
export function generateAgentToken(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const token = PREFIX + crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashAgentToken(token), prefix: token.slice(0, 10) };
}

export function hashAgentToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** The token from an `Authorization: Bearer pca_…` header, or null. */
export function bearerAgentToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(pca_[A-Za-z0-9_-]{20,100})\s*$/);
  return m ? m[1]! : null;
}

const ENROLL_PREFIX = "pce_";
/** How long an install command works. Long enough to SSH in and paste. */
export const ENROLLMENT_TTL_MS = 60 * 60 * 1000;

/**
 * A one-time enrollment code. It sits in the install command (and so in
 * shell history), which is acceptable only because it expires within the
 * hour and is consumed the moment the installer exchanges it for the real
 * agent token.
 */
export function generateEnrollmentCode(): {
  code: string;
  hash: string;
  expiresAt: Date;
} {
  const code = ENROLL_PREFIX + crypto.randomBytes(24).toString("base64url");
  return {
    code,
    hash: hashAgentToken(code),
    expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS),
  };
}

export function isEnrollmentCode(value: unknown): value is string {
  return typeof value === "string" && /^pce_[A-Za-z0-9_-]{32}$/.test(value);
}

/** An MCP API key: same strength and storage as agent tokens. */
export function generateApiKey(): {
  key: string;
  hash: string;
  prefix: string;
} {
  const key = "pck_" + crypto.randomBytes(32).toString("base64url");
  return { key, hash: hashAgentToken(key), prefix: key.slice(0, 10) };
}

export function bearerApiKey(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(pck_[A-Za-z0-9_-]{20,100})\s*$/);
  return m ? m[1]! : null;
}
