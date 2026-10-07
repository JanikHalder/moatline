import { describe, it, expect } from "vitest";
import {
  bearerAgentToken,
  generateAgentToken,
  hashAgentToken,
} from "./agent-token";

describe("agent tokens", () => {
  it("are random, prefixed, and stored only as a hash", () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    expect(a.token).toMatch(/^pca_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashAgentToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });

  it("are only accepted as a well-formed bearer header", () => {
    const { token } = generateAgentToken();
    expect(bearerAgentToken(`Bearer ${token}`)).toBe(token);
    expect(bearerAgentToken(token)).toBeNull();
    expect(bearerAgentToken("Bearer pca_short")).toBeNull();
    expect(bearerAgentToken(undefined)).toBeNull();
  });
});

describe("enrollment codes", () => {
  it("are one-hour, prefixed and distinct from agent tokens", async () => {
    const { generateEnrollmentCode, isEnrollmentCode, ENROLLMENT_TTL_MS } =
      await import("./agent-token");
    const e = generateEnrollmentCode();
    expect(isEnrollmentCode(e.code)).toBe(true);
    expect(e.hash).toBe(hashAgentToken(e.code));
    expect(e.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      ENROLLMENT_TTL_MS
    );
    // An agent token is not an install code, and vice versa.
    expect(isEnrollmentCode(generateAgentToken().token)).toBe(false);
    expect(bearerAgentToken(`Bearer ${e.code}`)).toBeNull();
  });
});
