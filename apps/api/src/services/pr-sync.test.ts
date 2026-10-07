import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runs: [] as Record<string, unknown>[],
  sets: [] as Record<string, unknown>[],
}));

vi.mock("db", () => ({
  repositories: { id: "id" },
  updateRuns: {
    id: "id",
    repositoryId: "r",
    prNumber: "p",
    status: "s",
    merged: "m",
  },
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(state.runs) }),
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

import { syncPullRequests } from "./pr-sync";
import { githubApi } from "../lib/git-github";
import { parseRepoUrl } from "../lib/git-host";

const api = githubApi(parseRepoUrl("https://github.com/acme/shop")!, {
  token: "tok",
  username: null,
});

const repo = { id: "r1", githubUrl: "https://github.com/acme/shop" } as never;

beforeEach(() => {
  state.runs = [];
  state.sets = [];
});

function github(routes: Record<string, unknown>) {
  globalThis.fetch = vi.fn((url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.endsWith(k));
    return Promise.resolve(
      hit
        ? new Response(JSON.stringify(hit[1]))
        : new Response("{}", { status: 404 })
    );
  }) as unknown as typeof fetch;
}

describe("syncPullRequests", () => {
  it("stores every open PR and marks which ones Moatline opened", async () => {
    github({
      "/pulls?state=open&per_page=100": [
        {
          number: 7,
          title: "Bump next",
          html_url: "u7",
          created_at: "2026-10-01",
          user: { login: "dependabot[bot]" },
          head: { ref: "dependabot/npm/next" },
        },
        {
          number: 8,
          title: "fix(security)",
          html_url: "u8",
          created_at: "2026-10-02",
          user: { login: "pc" },
          head: { ref: "security/cve-fix-1" },
        },
      ],
    });
    await syncPullRequests(repo, api);
    expect(state.sets[0]).toMatchObject({
      openPrs: [
        { number: 7, author: "dependabot[bot]", ours: false },
        { number: 8, ours: true },
      ],
    });
  });

  it("closes the loop for PRs merged or closed on GitHub", async () => {
    state.runs = [
      { id: "a", prNumber: 3 },
      { id: "b", prNumber: 4 },
    ];
    github({
      "/pulls?state=open&per_page=100": [],
      "/pulls/3": {
        state: "closed",
        merged_at: "2026-10-03",
        merge_commit_sha: "abc",
      },
      "/pulls/4": { state: "closed", merged_at: null },
    });
    await syncPullRequests(repo, api);
    expect(state.sets.slice(1)).toEqual([
      { status: "merged", merged: true, mergeSha: "abc", currentStep: null },
      { status: "closed", currentStep: null },
    ]);
  });
});
