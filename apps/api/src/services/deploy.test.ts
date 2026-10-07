import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  repo: null as Record<string, unknown> | null,
  integ: null as Record<string, unknown> | null,
  deployResult: { ok: true, status: 200, body: "{}" },
  updates: [] as Record<string, unknown>[],
}));

const mocks = vi.hoisted(() => ({
  triggerDeploy: vi.fn(),
  watchDeployLive: vi.fn(),
}));

vi.mock("db", () => {
  const mk = (t: string) => ({ __t: t });
  const repositories = mk("repositories");
  const orgIntegrations = mk("orgIntegrations");
  const deployRuns = mk("deployRuns");
  return {
    repositories,
    orgIntegrations,
    deployRuns,
    db: {
      select: () => ({
        from: (t: { __t: string }) => ({
          where: () =>
            Promise.resolve(
              t.__t === "repositories"
                ? state.repo
                  ? [state.repo]
                  : []
                : t.__t === "orgIntegrations"
                  ? state.integ
                    ? [state.integ]
                    : []
                  : []
            ),
        }),
      }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([{ id: "d1" }]) }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => ({
          where: () => {
            state.updates.push(vals);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

vi.mock("../lib/dokploy", () => ({ triggerDeploy: mocks.triggerDeploy }));
vi.mock("../lib/notify", () => ({ notify: vi.fn(() => Promise.resolve()) }));
vi.mock("./live-check", () => ({ watchDeployLive: mocks.watchDeployLive }));

import { deployRepository } from "./deploy";

const triggerDeploy = mocks.triggerDeploy;

const repo = {
  id: "r1",
  organizationId: "org1",
  name: "repo",
  githubUrl: "https://github.com/o/r",
  dokployApplicationId: "app1",
};
const integ = {
  dokployBaseUrl: "https://panel.example.com",
  dokployToken: "tok",
};

beforeEach(() => {
  state.repo = { ...repo };
  state.integ = { ...integ };
  state.deployResult = { ok: true, status: 200, body: "{}" };
  state.updates = [];
  triggerDeploy.mockReset();
  triggerDeploy.mockImplementation(() => Promise.resolve(state.deployResult));
  mocks.watchDeployLive.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("deployRepository", () => {
  it("triggers a deploy and records success", async () => {
    const res = await deployRepository("r1", "run1");
    expect(res.ok).toBe(true);
    expect(res.deployRunId).toBe("d1");
    expect(triggerDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://panel.example.com",
        token: "tok",
        applicationId: "app1",
      })
    );
    expect(state.updates.at(-1)).toMatchObject({ status: "succeeded" });
  });

  it("fails when the repo has no Dokploy or Coolify application", async () => {
    state.repo = { ...repo, dokployApplicationId: null };
    const res = await deployRepository("r1", null);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no Dokploy or Coolify application/i);
    expect(triggerDeploy).not.toHaveBeenCalled();
  });

  it("fails when Dokploy is not configured for the org", async () => {
    state.integ = null;
    const res = await deployRepository("r1", null);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/i);
    expect(triggerDeploy).not.toHaveBeenCalled();
  });

  it("watches the live URL after a trigger, carrying the commit it knew", async () => {
    state.repo = {
      ...repo,
      liveUrl: "https://app.example.com/api/health",
      liveCommit: "75fd897",
    };
    await deployRepository("r1", null);
    expect(mocks.watchDeployLive).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "r1",
        deployRunId: "d1",
        url: "https://app.example.com/api/health",
        previousCommit: "75fd897",
      })
    );
  });

  it("skips the watch when the repo has no live URL", async () => {
    await deployRepository("r1", null);
    expect(mocks.watchDeployLive).not.toHaveBeenCalled();
  });

  it("records a failed deploy when Dokploy rejects", async () => {
    state.deployResult = { ok: false, status: 500, body: "boom" };
    const res = await deployRepository("r1", null);
    expect(res.ok).toBe(false);
    expect(state.updates.at(-1)).toMatchObject({ status: "failed" });
  });
});

describe("buildStateOf", () => {
  it("counts one successful attempt, fails only when all failed", async () => {
    const { buildStateOf } = await import("./deploy");
    expect(buildStateOf(["error", "done"])).toBe("done");
    expect(buildStateOf(["error", "running"])).toBe("running");
    expect(buildStateOf(["error", "error"])).toBe("error");
    expect(buildStateOf([])).toBeNull();
  });
});
