import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

/**
 * Derive a stable 32-byte key from SECRETS_KEY (any length/encoding) via
 * SHA-256, so operators can use `openssl rand -base64 32` or any passphrase.
 */
function getKey(): Buffer {
  const raw = process.env.SECRETS_KEY ?? "";
  if (!raw) {
    throw new Error(
      "SECRETS_KEY is not set – required to store/read integration secrets."
    );
  }
  return crypto.createHash("sha256").update(raw).digest();
}

/** Encrypt a plaintext secret. Output: `v1:<iv>:<tag>:<ciphertext>` (base64). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

/** Placeholder returned to clients instead of a real secret. */
export const SECRET_MASK = "••••••••";

export function maskSecret(value: string | null | undefined): string | null {
  return value ? SECRET_MASK : null;
}
