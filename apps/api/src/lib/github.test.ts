import { describe, it, expect } from "vitest";
import { parseGitHubUrl } from "./github";

describe("parseGitHubUrl", () => {
  it("parses https GitHub URL", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "main",
    });
  });

  it("parses URL with trailing slash", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo/")).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "main",
    });
  });

  it("parses .git URL", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "main",
    });
  });

  it("parses SSH-style URL", () => {
    expect(parseGitHubUrl("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "main",
    });
  });

  it("parses URL with tree/branch", () => {
    expect(
      parseGitHubUrl("https://github.com/owner/repo/tree/develop")
    ).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "develop",
    });
  });

  it("returns null for non-GitHub URL", () => {
    expect(parseGitHubUrl("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(parseGitHubUrl("not-a-url")).toBeNull();
  });
});
