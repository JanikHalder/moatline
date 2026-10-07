import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mockRepo = {
  id: "repo-1",
  organizationId: "org-1",
  githubUrl: "https://github.com/owner/repo",
  name: "repo",
  defaultBranch: "main",
  packageJsonPath: "package.json",
  lastScannedAt: null,
  createdAt: new Date(),
};

const mockScanId = "scan-1";

vi.mock("db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        // Drizzle query builders are thenable: awaiting them runs the query,
        // while .limit() narrows it first. Mock both shapes.
        where: vi.fn(() => {
          const out: Record<string, unknown> = {
            limit: () => Promise.resolve([]),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([mockRepo]).then(resolve),
            catch: () => out,
          };
          return out;
        }),
        orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
    insert: vi.fn((_table: unknown) => ({
      values: vi.fn((vals: unknown) => {
        const v = vals as Record<string, unknown>;
        if (v && v.scanId !== undefined) return Promise.resolve();
        return { returning: () => Promise.resolve([{ id: mockScanId }]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
  scans: {},
  packageFindings: {},
  vulnerabilities: {},
  repositories: {},
  organization: {},
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn((cmd: string, args: string[]) => {
    const destDir = args[args.length - 1];
    if (typeof destDir === "string" && destDir.includes("scan-")) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(
          path.join(destDir, "package.json"),
          JSON.stringify({ name: "test", dependencies: {} })
        );
      } catch (e) {
        return { status: 1, stderr: String(e) };
      }
    }
    return { status: 0 };
  }),
}));

describe("runScan", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn((input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.github.com") && url.includes("contents")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              dependencies: { lodash: "^4.17.0" },
              devDependencies: {},
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.includes("registry.npmjs.org")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              "dist-tags": { latest: "4.17.21" },
              version: "4.17.21",
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("runs full scan without throwing (fetch package.json, clone+depcheck, fetch versions)", async () => {
    const { runScan } = await import("./scan");
    const result = await runScan("repo-1", mockScanId);
    expect(result).toBe(mockScanId);
  });

  it("does not crash when getUnusedPackages runs (real depcheck on fake clone)", async () => {
    const { runScan } = await import("./scan");
    await expect(runScan("repo-1", mockScanId)).resolves.toBe(mockScanId);
  });

  it("falls back to the public raw URL when the GitHub token is rejected (401)", async () => {
    const previousToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "invalid-token";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url.includes("api.github.com")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "Bad credentials" }), {
            status: 401,
          })
        );
      }
      // A public repo without a lockfile: only package.json is there.
      if (url.includes("raw.githubusercontent.com")) {
        if (!url.endsWith("/package.json"))
          return Promise.resolve(new Response("404", { status: 404 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ dependencies: { lodash: "^4.17.0" } }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.includes("registry.npmjs.org")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              "dist-tags": { latest: "4.17.21" },
              version: "4.17.21",
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      const { runScan } = await import("./scan");
      await expect(runScan("repo-1", mockScanId)).resolves.toBe(mockScanId);
      expect(calls.some((u) => u.includes("raw.githubusercontent.com"))).toBe(
        true
      );
      // Reaching the npm registry proves the scan continued past the 401.
      expect(calls.some((u) => u.includes("registry.npmjs.org"))).toBe(true);
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousToken;
    }
  });
});

describe("clone + depcheck isolation", () => {
  it("spawnSync mock creates dir and package.json so depcheck can run", async () => {
    const { spawnSync } = await import("node:child_process");
    const tempDir = path.join(os.tmpdir(), "scan-test-" + Date.now());
    (spawnSync as ReturnType<typeof vi.fn>)("git", [
      "clone",
      "--depth",
      "1",
      "https://x.git",
      tempDir,
    ]);
    expect(fs.existsSync(tempDir)).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "package.json"))).toBe(true);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(tempDir, "package.json"), "utf8")
    );
    expect(pkg.name).toBe("test");
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
