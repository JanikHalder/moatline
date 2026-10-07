import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  maskSecret,
} from "./crypto";

beforeAll(() => {
  process.env.SECRETS_KEY = "test-secrets-key-for-unit-tests";
});

describe("crypto", () => {
  it("roundtrips a secret", () => {
    const enc = encryptSecret("super-secret-token");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("super-secret-token");
    expect(decryptSecret(enc)).toBe("super-secret-token");
  });

  it("uses a random IV (different ciphertext each call)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails to decrypt a tampered payload", () => {
    const enc = encryptSecret("x");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("masks values", () => {
    expect(maskSecret("abc")).toBe("••••••••");
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret("")).toBeNull();
  });
});
