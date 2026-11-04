import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  scans: {},
  packageFindings: {},
  vulnerabilities: {},
  repositories: {},
  organization: {},
}));

import { explainNotFound } from "./scan";
import type { RepoHandle } from "../lib/git-host";

function handle(
  api: {
    branchHead?: string | null;
    branches?: string[] | null;
    rootReadable?: boolean;
  },
  token: string | null = "tok"
): RepoHandle {
  return {
    kind: "github",
    label: "GitHub",
    owner: "acme",
    repo: "shop",
    token,
    api: {
      branchHead: async () => api.branchHead ?? null,
      listBranches: async () => {
        if (!api.branches) throw new Error("no list");
        return api.branches.map((name) => ({
          name,
          sha: "x",
          date: null,
          protected: false,
        }));
      },
      readFile: async () =>
        api.rootReadable
          ? { ok: true as const, text: "{}" }
          : { ok: false as const, status: 404, error: "Not Found" },
    },
  } as unknown as RepoHandle;
}

describe("explainNotFound", () => {
  it("names the missing root package.json when the branch exists", async () => {
    const msg = await explainNotFound(
      handle({ branchHead: "abc" }),
      "main",
      "package.json"
    );
    expect(msg).toContain("no package.json in the root of");
    expect(msg).toContain("monorepo");
  });

  it("points at a wrong root directory when the repo root has a package.json", async () => {
    const msg = await explainNotFound(
      handle({ branchHead: "abc", rootReadable: true }),
      "main",
      "apps/web/package.json"
    );
    expect(msg).toContain('"apps/web/package.json" does not exist');
    expect(msg).toContain("clear the root directory");
  });

  it("lists the real branches when the branch is missing", async () => {
    const msg = await explainNotFound(
      handle({ branches: ["feature-x", "master", "develop"] }),
      "main",
      "package.json"
    );
    expect(msg).toContain('branch "main" does not exist');
    expect(msg).toContain('"master", "develop"');
    expect(msg).not.toContain("feature-x");
  });

  it("says the repo is unreachable when branches cannot be listed", async () => {
    const msg = await explainNotFound(
      handle({ branches: null }, null),
      "main",
      "package.json"
    );
    expect(msg).toContain("is not reachable");
    expect(msg).toContain("Private repos need a GitHub token");
  });
});
