import { describe, it, expect } from "vitest";
import { isAllowedGitHubUrl } from "./validate-github-url";

describe("isAllowedGitHubUrl", () => {
  it("allows https://github.com/owner/repo", () => {
    expect(isAllowedGitHubUrl("https://github.com/owner/repo")).toBe(true);
  });

  it("allows https://github.com/owner/repo with trailing slash", () => {
    expect(isAllowedGitHubUrl("https://github.com/owner/repo/")).toBe(true);
  });

  it("rejects http", () => {
    expect(isAllowedGitHubUrl("http://github.com/owner/repo")).toBe(false);
  });

  it("rejects non-GitHub host", () => {
    expect(isAllowedGitHubUrl("https://gitlab.com/owner/repo")).toBe(false);
  });

  it("rejects file protocol", () => {
    expect(isAllowedGitHubUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects URL without owner/repo path", () => {
    expect(isAllowedGitHubUrl("https://github.com")).toBe(false);
    expect(isAllowedGitHubUrl("https://github.com/owner")).toBe(false);
  });

  it("rejects invalid URL", () => {
    expect(isAllowedGitHubUrl("not-a-url")).toBe(false);
  });
});
