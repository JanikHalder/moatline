import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  repo: null as Record<string, unknown> | null,
  repoUpdates: [] as Record<string, unknown>[],
  deployUpdates: [] as Record<string, unknown>[],
}));

const mocks = vi.hoisted(() => ({ checkLiveUrl: vi.fn(), notify: vi.fn() }));

// Incidents have their own tests; resetAllMocks must not break this stub.
vi.mock("./incidents", () => ({ onLiveResult: async () => {} }));
vi.mock("db", () => {
  const mk = (t: string) => ({ __t: t });
  const repositories = mk("repositories");
  const deployRuns = mk("deployRuns");
  return {
    repositories,
    deployRuns,
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(state.repo ? [state.repo] : []),
        }),
      }),
      update: (t: { __t: string }) => ({
        set: (vals: Record<string, unknown>) => {
          const target =
            t.__t === "repositories" ? state.repoUpdates : state.deployUpdates;
          target.push(vals);
          const done = Promise.resolve();
          return {
            where: () =>
              Object.assign(done, {
                returning: () =>
                  Promise.resolve([{ ...(state.repo ?? {}), ...vals }]),
                catch: () => done,
              }),
          };
        },
      }),
    },
  };
});

vi.mock("../lib/live-check", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/live-check")>(
      "../lib/live-check"
    );
  return { ...actual, checkLiveUrl: mocks.checkLiveUrl };
});
vi.mock("../lib/notify", () => ({ notify: mocks.notify }));

import { runLiveCheck, watchDeployLive } from "./live-check";

const up = (commit: string | null = null) => ({
  ok: true,
  httpStatus: 200,
  commit,
  durationMs: 12,
  error: null,
});
const down = () => ({
  ok: false,
  httpStatus: 502,
  commit: null,
  durationMs: 8,
  error: "HTTP 502",
});

beforeEach(() => {
  state.repo = {
    id: "r1",
    organizationId: "org1",
    name: "repo",
    liveUrl: "https://app.example.com/api/health",
    liveCommit: null,
  };
  state.repoUpdates = [];
  state.deployUpdates = [];
  mocks.checkLiveUrl.mockReset();
  mocks.notify.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("runLiveCheck", () => {
  it("records what the URL answered", async () => {
    mocks.checkLiveUrl.mockResolvedValue(up("752de05"));
    const res = await runLiveCheck("r1");
    expect(res.ok).toBe(true);
    expect(state.repoUpdates.at(-1)).toMatchObject({
      liveStatus: "up",
      liveHttpStatus: 200,
      liveCommit: "752de05",
    });
  });

  it("records a failure as a result, not an error", async () => {
    mocks.checkLiveUrl.mockResolvedValue(down());
    const res = await runLiveCheck("r1");
    expect(res.ok).toBe(true);
    expect(state.repoUpdates.at(-1)).toMatchObject({
      liveStatus: "down",
      liveError: "HTTP 502",
    });
  });

  it("says so when no live URL is configured, without probing anything", async () => {
    state.repo = { ...state.repo, liveUrl: null };
    const res = await runLiveCheck("r1");
    expect(res).toEqual({
      ok: false,
      error: "No live URL configured for this repo.",
    });
    expect(mocks.checkLiveUrl).not.toHaveBeenCalled();
  });

  it("refuses a stored URL that is no longer allowed", async () => {
    state.repo = { ...state.repo, liveUrl: "http://127.0.0.1:5432" };
    const res = await runLiveCheck("r1");
    expect(res.ok).toBe(false);
    expect(mocks.checkLiveUrl).not.toHaveBeenCalled();
  });
});

const watch = (previousCommit: string | null) =>
  watchDeployLive({
    repositoryId: "r1",
    deployRunId: "d1",
    organizationId: "org1",
    repoName: "repo",
    url: "https://app.example.com/api/health",
    previousCommit,
    attempts: 4,
    intervalMs: 1,
    stabilityIntervalMs: 1,
  });

describe("watchDeployLive", () => {
  it("confirms the deploy once the reported commit changes, and stops there", async () => {
    mocks.checkLiveUrl
      .mockResolvedValueOnce(down())
      .mockResolvedValueOnce(up("75fd897"))
      .mockResolvedValueOnce(up("752de05"))
      .mockResolvedValue(up("752de05"));

    const result = await watch("75fd897");

    // Stopped watching at the switch, then 4 stability rounds of the health
    // URL and the site root.
    expect(mocks.checkLiveUrl).toHaveBeenCalledTimes(3 + 4 * 2);
    expect(state.deployUpdates.at(-1)).toMatchObject({ liveOk: true });
    expect(state.deployUpdates.at(-1)!.liveDetail).toMatch(/New build is live/);
    expect(result.verdict).toBe("healthy");
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("calls it broken when the new build stops answering after the switch", async () => {
    mocks.checkLiveUrl
      .mockResolvedValueOnce(up("752de05"))
      .mockResolvedValue(down());

    const result = await watch("75fd897");

    expect(result.verdict).toBe("broken");
    expect(state.deployUpdates.at(-1)).toMatchObject({ liveOk: false });
    expect(state.deployUpdates.at(-1)!.liveDetail).toMatch(/then stopped/);
  });

  it("also checks /admin for Payload, and names it when it fails", async () => {
    mocks.checkLiveUrl.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith("/admin") ? down() : up("752de05"))
    );
    const result = await watchDeployLive({
      repositoryId: "r1",
      deployRunId: "d1",
      organizationId: "org1",
      repoName: "repo",
      url: "https://app.example.com/api/health",
      previousCommit: "75fd897",
      attempts: 2,
      intervalMs: 1,
      stabilityIntervalMs: 1,
      extraPaths: ["/admin"],
    });
    expect(result.verdict).toBe("broken");
    expect(result.detail).toMatch(/\/admin/);
  });

  it("stops at once when Dokploy reports the build failed", async () => {
    mocks.checkLiveUrl.mockResolvedValue(up("75fd897"));
    const result = await watchDeployLive({
      repositoryId: "r1",
      deployRunId: "d1",
      organizationId: "org1",
      repoName: "repo",
      url: "https://app.example.com/api/health",
      previousCommit: "75fd897",
      attempts: 30,
      intervalMs: 1,
      stabilityIntervalMs: 1,
      buildStatus: async () => "error",
    });
    expect(result.verdict).toBe("build_failed");
    expect(mocks.checkLiveUrl).not.toHaveBeenCalled();
    expect(state.deployUpdates.at(-1)).toMatchObject({ liveOk: false });
  });

  it("without a commit, ends the wait when Dokploy says it is done", async () => {
    mocks.checkLiveUrl.mockResolvedValue(up(null));
    const statuses = ["running", "done"] as const;
    let i = 0;
    const result = await watchDeployLive({
      repositoryId: "r1",
      deployRunId: "d1",
      organizationId: "org1",
      repoName: "repo",
      url: "https://app.example.com/api/health",
      previousCommit: null,
      attempts: 30,
      intervalMs: 1,
      stabilityIntervalMs: 1,
      buildStatus: async () => statuses[Math.min(i++, 1)]!,
    });
    expect(result.verdict).toBe("healthy");
    // 2 watch rounds, then 4 stability rounds of health URL + site root.
    expect(mocks.checkLiveUrl).toHaveBeenCalledTimes(2 + 4 * 2);
  });

  it("fails the run when the old commit keeps answering", async () => {
    mocks.checkLiveUrl.mockResolvedValue(up("75fd897"));

    const result = await watch("75fd897");

    expect(state.deployUpdates.at(-1)).toMatchObject({ liveOk: false });
    expect(state.deployUpdates.at(-1)!.liveDetail).toMatch(
      /has not taken over/
    );
    expect(result.verdict).toBe("build_failed");
  });

  it("fails the run when the URL never comes back", async () => {
    mocks.checkLiveUrl.mockResolvedValue(down());

    const result = await watch("75fd897");

    expect(state.deployUpdates.at(-1)).toMatchObject({ liveOk: false });
    expect(state.deployUpdates.at(-1)!.liveDetail).toMatch(/did not come back/);
    expect(result.verdict).toBe("broken");
  });

  it("calls reachability by its name when no commit is reported", async () => {
    mocks.checkLiveUrl.mockResolvedValue(up(null));

    await watch(null);

    const last = state.deployUpdates.at(-1)!;
    expect(last.liveOk).toBe(true);
    expect(last.liveDetail).toMatch(/reachability, not which build/);
  });
});

describe("brokenChecks", () => {
  it("reports checks that turned false, once", async () => {
    const { brokenChecks } = await import("./live-check");
    expect(brokenChecks({ email: true }, { email: false, s3: true })).toEqual([
      "email",
    ]);
    expect(brokenChecks({ email: false }, { email: false })).toEqual([]);
    expect(brokenChecks(null, { storage: false })).toEqual(["storage"]);
  });
});
