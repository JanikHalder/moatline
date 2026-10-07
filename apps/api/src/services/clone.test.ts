import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../lib/run", () => ({ run: mocks.run }));

import {
  projectDirFromPackageJsonPath,
  isCommitSha,
  cloneRepo,
  cleanupClone,
} from "./clone";

const okResult = {
  ok: true,
  stdout: "",
  stderr: "",
  status: 0,
  timedOut: false,
};

const gitCalls = () =>
  mocks.run.mock.calls.map(([, args]) => (args as string[]).join(" "));

beforeEach(() => {
  mocks.run.mockReset().mockResolvedValue(okResult);
});

describe("projectDirFromPackageJsonPath", () => {
  const temp = "/tmp/clone-abc";

  it("returns the temp dir for a root package.json", () => {
    expect(projectDirFromPackageJsonPath(temp, "package.json")).toBe(temp);
  });

  it("returns the temp dir for an empty path", () => {
    expect(projectDirFromPackageJsonPath(temp, "")).toBe(temp);
  });

  it("resolves a subdirectory package.json", () => {
    expect(projectDirFromPackageJsonPath(temp, "apps/web/package.json")).toBe(
      path.join(temp, "apps/web")
    );
  });
});

describe("isCommitSha", () => {
  it("accepts short and full hex SHAs", () => {
    expect(isCommitSha("752de05")).toBe(true);
    expect(isCommitSha("752de05e244d374ce98fa7a841c9280b1fa19be3")).toBe(true);
  });

  it("rejects branch names, versions and option-shaped values", () => {
    expect(isCommitSha("main")).toBe(false);
    expect(isCommitSha("v1.2.3")).toBe(false);
    expect(isCommitSha("--upload-pack=evil")).toBe(false);
    expect(isCommitSha("752de0")).toBe(false); // too short to be meaningful
  });
});

describe("cloneRepo", () => {
  it("clones the branch when no commit is given", async () => {
    const res = await cloneRepo({ owner: "o", repo: "r", branch: "main" });
    expect(res.ok).toBe(true);
    expect(gitCalls()).toEqual([
      expect.stringContaining("clone --depth 1 --branch main"),
    ]);
    cleanupClone(res.tempDir);
  });

  it("fetches the exact commit instead — a SHA is not a branch", async () => {
    const res = await cloneRepo({
      owner: "o",
      repo: "r",
      branch: "main",
      commit: "752de05e244d374ce98fa7a841c9280b1fa19be3",
    });
    expect(res.ok).toBe(true);
    expect(gitCalls()).toEqual([
      "init --quiet",
      expect.stringContaining("remote add origin"),
      "fetch --depth 1 --quiet origin 752de05e244d374ce98fa7a841c9280b1fa19be3",
      "checkout --quiet FETCH_HEAD",
    ]);
    cleanupClone(res.tempDir);
  });

  it("stops at the first failing git step", async () => {
    mocks.run
      .mockResolvedValueOnce(okResult)
      .mockResolvedValueOnce(okResult)
      .mockResolvedValueOnce({
        ...okResult,
        ok: false,
        stderr: "couldn't find remote ref",
      });

    const res = await cloneRepo({
      owner: "o",
      repo: "r",
      branch: "main",
      commit: "752de05",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/couldn't find remote ref/);
    expect(gitCalls()).toHaveLength(3); // no checkout after a failed fetch
    cleanupClone(res.tempDir);
  });

  it("refuses a commit that is not a SHA without running git", async () => {
    const res = await cloneRepo({
      owner: "o",
      repo: "r",
      branch: "main",
      commit: "--upload-pack=touch /tmp/pwned",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a commit SHA/);
    expect(mocks.run).not.toHaveBeenCalled();
    cleanupClone(res.tempDir);
  });

  it("keeps the token out of error output", async () => {
    mocks.run.mockResolvedValue({
      ...okResult,
      ok: false,
      stderr: "fatal: could not read https://x-access-token:s3cret@github.com",
    });
    const res = await cloneRepo({
      owner: "o",
      repo: "r",
      branch: "main",
      token: "s3cret",
    });
    expect(res.error).not.toContain("s3cret");
    expect(res.error).toContain("***");
    cleanupClone(res.tempDir);
  });
});
