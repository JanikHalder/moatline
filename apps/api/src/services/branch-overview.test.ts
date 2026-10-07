import { describe, expect, it, vi } from "vitest";
import type { GitApi, HostBranch, MergedPr } from "../lib/git-api";
import { branchOverview, deletable } from "./branch-overview";

function fakeApi(opts: {
  branches: HostBranch[];
  merged?: Record<string, boolean | null>;
  mergedPrs?: Record<string, MergedPr>;
  open?: Array<{ number: number; headRef: string }>;
}): GitApi {
  return {
    kind: "github",
    listBranches: async () => opts.branches,
    listOpenPrs: async () =>
      (opts.open ?? []).map((p) => ({
        ...p,
        title: `PR ${p.number}`,
        url: `u${p.number}`,
        author: null,
        draft: false,
        createdAt: "2026-10-01",
      })),
    mergedPrs: async () => new Map(Object.entries(opts.mergedPrs ?? {})),
    compareBranch: vi.fn(async (head: string) => {
      const m = opts.merged?.[head];
      return m == null ? null : { merged: m, date: "2026-09-01T00:00:00Z" };
    }),
  } as unknown as GitApi;
}

const b = (name: string, sha = name.padEnd(40, "0"), extra = {}) => ({
  name,
  sha,
  date: null,
  protected: false,
  ...extra,
});

describe("branchOverview", () => {
  it("sorts branches into default, merged, open PR and unmerged", async () => {
    const api = fakeApi({
      branches: [
        b("main"),
        b("old-feature"),
        b("wip"),
        b("pr-branch"),
        b("squashed", "abcdef1234567890abcdef1234567890abcdef12"),
      ],
      merged: { "old-feature": true, wip: false, squashed: false },
      open: [{ number: 5, headRef: "pr-branch" }],
      mergedPrs: {
        squashed: {
          number: 9,
          url: "u9",
          mergedAt: "2026-09-20",
          headSha: "abcdef123456",
        },
      },
    });
    const { branches } = await branchOverview(api, "main");
    const by = Object.fromEntries(branches.map((r) => [r.name, r]));
    expect(by.main!.status).toBe("default");
    expect(by["old-feature"]!.status).toBe("merged");
    expect(by["old-feature"]!.date).toBe("2026-09-01T00:00:00Z");
    expect(by.wip!.status).toBe("unmerged");
    expect(by["pr-branch"]!.status).toBe("open_pr");
    expect(by["pr-branch"]!.openPr?.number).toBe(5);
    // Squash merge: the PR knows, the commits do not.
    expect(by.squashed!.status).toBe("merged");
    expect(by.squashed!.mergedPr?.number).toBe(9);
    expect(branches[0]!.name).toBe("main");
  });

  it("does not count a PR merge when the branch got new commits since", async () => {
    const api = fakeApi({
      branches: [b("main"), b("reused", "1".repeat(40))],
      merged: { reused: false },
      mergedPrs: {
        reused: {
          number: 2,
          url: "u2",
          mergedAt: null,
          headSha: "2".repeat(40),
        },
      },
    });
    const { branches } = await branchOverview(api, "main");
    expect(branches.find((r) => r.name === "reused")!.status).toBe("unmerged");
  });

  it("trusts GitLab's own merged flag without comparing", async () => {
    const api = fakeApi({
      branches: [
        b("main"),
        b("done", undefined, { merged: true }),
        b("todo", undefined, { merged: false, date: "2026-08-01" }),
      ],
    });
    const { branches } = await branchOverview(api, "main");
    expect(branches.map((r) => [r.name, r.status])).toEqual([
      ["main", "default"],
      ["done", "merged"],
      ["todo", "unmerged"],
    ]);
    expect(api.compareBranch).not.toHaveBeenCalled();
  });

  it("only offers merged, unprotected branches for deletion", async () => {
    const api = fakeApi({
      branches: [b("main"), b("a"), b("p", undefined, { protected: true })],
      merged: { a: true, p: true },
    });
    const { branches } = await branchOverview(api, "main");
    expect(branches.filter(deletable).map((r) => r.name)).toEqual(["a"]);
  });
});
