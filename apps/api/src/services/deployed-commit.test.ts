import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listDeployments: vi.fn() }));
vi.mock("db", () => ({}));
vi.mock("../lib/dokploy", async (orig) => ({
  ...(await orig<typeof import("../lib/dokploy")>()),
  listDeployments: mocks.listDeployments,
}));
vi.mock("../lib/github-token", () => ({ getGithubToken: async () => "tok" }));
vi.mock("./deploy", () => ({
  resolveDokployConfig: async () => ({
    ok: true,
    config: { baseUrl: "https://d", token: "t" },
  }),
}));

import { deploymentCommit } from "../lib/dokploy";
import { resolveDeployedCommit } from "./deployed-commit";

const repo = {
  organizationId: "o",
  githubUrl: "https://github.com/acme/shop",
  defaultBranch: "main",
  dokployApplicationId: "a1",
  dokployKind: "application",
} as never;

beforeEach(() => mocks.listDeployments.mockReset());

describe("deploymentCommit", () => {
  it("reads the hash Dokploy writes for webhook deploys", () => {
    expect(
      deploymentCommit({
        title: "fix: footer",
        description: "Hash: 752de05a1b",
      })
    ).toBe("752de05a1b");
    expect(deploymentCommit({ commitHash: "ABCDEF1234567" })).toBe(
      "abcdef1234567"
    );
    expect(deploymentCommit({ title: "Manual deployment" })).toBeNull();
  });
});

describe("resolveDeployedCommit", () => {
  it("prefers what the site reports", async () => {
    const r = await resolveDeployedCommit(repo, "75fd897");
    expect(r).toMatchObject({ sha: "75fd897", source: "live" });
    expect(mocks.listDeployments).not.toHaveBeenCalled();
  });

  it("takes the commit Dokploy recorded for the last successful deploy", async () => {
    mocks.listDeployments.mockResolvedValue([
      { status: "error", commit: "bad0000", createdAt: "2026-10-03T10:00:00Z" },
      { status: "done", commit: "good123", createdAt: "2026-10-03T09:00:00Z" },
    ]);
    expect(await resolveDeployedCommit(repo, null)).toMatchObject({
      sha: "good123",
      source: "dokploy",
    });
  });

  it("else the branch's newest commit when that deploy started", async () => {
    mocks.listDeployments.mockResolvedValue([
      { status: "done", commit: null, createdAt: "2026-10-03T09:00:00Z" },
    ]);
    globalThis.fetch = vi.fn((url: string) => {
      expect(url).toContain("sha=main&until=2026-10-03T09%3A00%3A00Z");
      return Promise.resolve(
        new Response(JSON.stringify([{ sha: "c0ffee1234" }]))
      );
    }) as unknown as typeof fetch;
    expect(await resolveDeployedCommit(repo, null)).toMatchObject({
      sha: "c0ffee1234",
      source: "branch",
    });
  });
});
