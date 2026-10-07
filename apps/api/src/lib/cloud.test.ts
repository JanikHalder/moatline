import { afterEach, describe, expect, it } from "vitest";
import {
  effectiveVerifyMode,
  isBillingExempt,
  isCloud,
  untrustedRepoEnv,
} from "./cloud";

afterEach(() => {
  delete process.env.CLOUD_MODE;
  delete process.env.BILLING_FREE_ORGS;
});

describe("cloud mode", () => {
  it("is off unless CLOUD_MODE is exactly true", () => {
    expect(isCloud()).toBe(false);
    process.env.CLOUD_MODE = "1";
    expect(isCloud()).toBe(false);
    process.env.CLOUD_MODE = "true";
    expect(isCloud()).toBe(true);
  });

  it("never runs repository code on the cloud", () => {
    expect(effectiveVerifyMode("build")).toBe("build");
    expect(effectiveVerifyMode(null)).toBe("typecheck");
    process.env.CLOUD_MODE = "true";
    expect(effectiveVerifyMode("build")).toBe("none");
    expect(effectiveVerifyMode("typecheck")).toBe("none");
  });

  it("keeps package managers away from the repository's own code", () => {
    expect(untrustedRepoEnv()).toEqual({});
    process.env.CLOUD_MODE = "true";
    expect(untrustedRepoEnv()).toMatchObject({
      npm_config_ignore_scripts: "true",
      npm_config_ignore_pnpmfile: "true",
      YARN_IGNORE_PATH: "1",
    });
  });

  it("exempts the operator's organizations by id or slug", () => {
    process.env.BILLING_FREE_ORGS = " org-1 , acme-digital ";
    expect(isBillingExempt({ id: "org-1" })).toBe(true);
    expect(isBillingExempt({ id: "x", slug: "acme-digital" })).toBe(true);
    expect(isBillingExempt({ id: "org-2", slug: "other" })).toBe(false);
  });
});
