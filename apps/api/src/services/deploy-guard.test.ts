import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  update: null as Record<string, unknown> | null,
  sets: [] as Record<string, unknown>[],
}));
const mocks = vi.hoisted(() => ({
  listDeployments: vi.fn(),
  rollbackTo: vi.fn(),
  revertTipCommit: vi.fn(),
  deployRepository: vi.fn(),
  notify: vi.fn(() => Promise.resolve()),
  startLiveScan: vi.fn(),
  runScan: vi.fn(),
}));

vi.mock("db", () => ({
  deployRuns: { id: "id", repositoryId: "repositoryId" },
  repositories: { id: "id" },
  updateRuns: { id: "id" },
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(state.row ? [state.row] : []),
        }),
        where: () => Promise.resolve(state.update ? [state.update] : []),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          state.sets.push(v);
          return Promise.resolve();
        },
      }),
    }),
  },
}));
vi.mock("../lib/dokploy", () => ({
  listDeployments: mocks.listDeployments,
  rollbackTo: mocks.rollbackTo,
}));
vi.mock("../lib/github", () => ({
  parseGitHubUrl: () => ({ owner: "o", repo: "r", branch: "main" }),
  revertTipCommit: mocks.revertTipCommit,
}));
vi.mock("../lib/github-token", () => ({ getGithubToken: async () => "tok" }));
vi.mock("../lib/notify", () => ({ notify: mocks.notify }));
vi.mock("./deploy", () => ({
  resolveDokployConfig: async () => ({
    ok: true,
    config: { baseUrl: "https://d", token: "t" },
  }),
  deployRepository: mocks.deployRepository,
}));

vi.mock("./live-scan", () => ({ startLiveScan: mocks.startLiveScan }));
vi.mock("./scan", () => ({ runScan: mocks.runScan }));

import { guardDeploy, rollbackDeploy } from "./deploy-guard";

const repo = {
  id: "r1",
  organizationId: "org1",
  name: "shop",
  githubUrl: "https://github.com/o/r",
  defaultBranch: "main",
  dokployApplicationId: "app1",
  liveUrl: "https://shop.example/api/health",
  autoRollback: true,
};

beforeEach(() => {
  state.row = { run: { id: "d1", updateRunId: "u1" }, repo };
  state.update = { id: "u1", mergeSha: "merge1", branchName: "deps/update-1" };
  state.sets = [];
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.notify.mockResolvedValue(undefined);
  mocks.revertTipCommit.mockResolvedValue({ ok: true, sha: "rev1" });
  mocks.deployRepository.mockResolvedValue({ ok: true });
});

describe("rollbackDeploy", () => {
  it("uses Dokploy's kept image, and reverts the merge too", async () => {
    mocks.listDeployments.mockResolvedValue([
      { deploymentId: "new", status: "done", rollbackId: "rbNew" },
      { deploymentId: "old", status: "done", rollbackId: "rbOld" },
    ]);
    mocks.rollbackTo.mockResolvedValue({ ok: true, status: 200, body: "" });
    const r = await rollbackDeploy("d1", "broken");
    expect(r.ok).toBe(true);
    expect(mocks.rollbackTo).toHaveBeenCalledWith(
      expect.objectContaining({ rollbackId: "rbOld" })
    );
    expect(mocks.revertTipCommit).toHaveBeenCalled();
    expect(mocks.deployRepository).not.toHaveBeenCalled();
    expect(state.sets.at(-1)).toMatchObject({ guard: "rolled_back" });
  });

  it("without a kept image, reverts and deploys the revert unguarded", async () => {
    mocks.listDeployments.mockResolvedValue([
      { deploymentId: "new", status: "done", rollbackId: null },
    ]);
    const r = await rollbackDeploy("d1", "broken");
    expect(r.ok).toBe(true);
    expect(mocks.deployRepository).toHaveBeenCalledWith("r1", null, {
      afterMerge: true,
      guard: false,
    });
  });

  it("after a failed build only reverts — the old version still runs", async () => {
    const r = await rollbackDeploy("d1", "build_failed");
    expect(r.ok).toBe(true);
    expect(mocks.listDeployments).not.toHaveBeenCalled();
    expect(mocks.deployRepository).not.toHaveBeenCalled();
    expect(state.sets.at(-1)).toMatchObject({ guard: "rolled_back" });
  });

  it("fails honestly when nothing can be undone", async () => {
    state.update = null;
    state.row = { run: { id: "d1", updateRunId: null }, repo };
    mocks.listDeployments.mockResolvedValue([]);
    const r = await rollbackDeploy("d1", "broken");
    expect(r.ok).toBe(false);
    expect(state.sets.at(-1)).toMatchObject({ guard: "rollback_failed" });
  });
});

describe("guardDeploy", () => {
  it("only reports when automatic rollback is off", async () => {
    await guardDeploy({ ...repo, autoRollback: false } as never, "d1", {
      verdict: "broken",
      detail: "502",
    });
    expect(mocks.revertTipCommit).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ title: "Deploy of shop broke the live site" })
    );
  });

  it("records a healthy deploy and analyses the deployed version again", async () => {
    mocks.startLiveScan.mockResolvedValue({ ok: true });
    await guardDeploy(repo as never, "d1", { verdict: "healthy", detail: "" });
    expect(state.sets).toEqual([{ guard: "healthy", guardDetail: null }]);
    expect(mocks.startLiveScan).toHaveBeenCalledWith("r1");
    expect(mocks.runScan).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("scans the branch when the live URL reports no commit", async () => {
    mocks.startLiveScan.mockResolvedValue({ ok: false, error: "no commit" });
    mocks.runScan.mockResolvedValue("s1");
    await guardDeploy(repo as never, "d1", { verdict: "healthy", detail: "" });
    expect(mocks.runScan).toHaveBeenCalledWith("r1");
  });
});
