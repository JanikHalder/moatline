import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOMATION_POLICY,
  resolveAutomationPolicy,
} from "./automation-policy";

describe("resolveAutomationPolicy", () => {
  it("returns defaults for null or empty", () => {
    expect(resolveAutomationPolicy(null)).toEqual(DEFAULT_AUTOMATION_POLICY);
    expect(resolveAutomationPolicy({})).toEqual(DEFAULT_AUTOMATION_POLICY);
  });

  it("requires explicit true for restrictive flags", () => {
    expect(
      resolveAutomationPolicy({
        defaultAutoFixCritical: true,
        allowMcpSecurityFix: false,
        requirePrReview: true,
      })
    ).toEqual({
      defaultAutoFixCritical: true,
      allowMcpSecurityFix: false,
      requirePrReview: true,
    });
  });

  it("keeps MCP fixes on unless explicitly false", () => {
    expect(resolveAutomationPolicy({ allowMcpSecurityFix: true })).toEqual({
      ...DEFAULT_AUTOMATION_POLICY,
      allowMcpSecurityFix: true,
    });
  });
});
