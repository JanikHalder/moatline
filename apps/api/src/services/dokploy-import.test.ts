import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, repositories: {}, servers: {} }));
vi.mock("./deploy", () => ({ resolveDokployConfig: vi.fn() }));
vi.mock("./dokploy-sync", () => ({
  serverRunning: vi.fn(),
  syncDokployForOrg: vi.fn(),
}));

import { planImport } from "./dokploy-import";
import type { DokployApplication } from "../lib/dokploy";

const app = (p: Partial<DokployApplication>): DokployApplication => ({
  applicationId: "a",
  kind: "application",
  name: "App",
  appName: "app-x1",
  project: "Kunde",
  environment: "production",
  githubRepo: "acme/shop",
  branch: "main",
  autoDeploy: true,
  ...p,
});

const repo = {
  id: "r1",
  name: "web",
  githubUrl: "https://github.com/Acme/Web",
  defaultBranch: "main",
  dokployApplicationId: null,
};

describe("planImport", () => {
  it("skips repositories already added, linked or not", () => {
    const plan = planImport(
      [
        app({ applicationId: "a1", githubRepo: "acme/web" }),
        app({ applicationId: "a2", githubRepo: "other/thing" }),
      ],
      [
        repo,
        {
          ...repo,
          id: "r2",
          githubUrl: "https://github.com/x/y",
          dokployApplicationId: "a2",
        },
      ]
    );
    expect(plan.candidates).toEqual([]);
    expect(plan.existing.map((e) => e.repositoryId)).toEqual(["r1", "r2"]);
  });

  it("adds another branch of a known repository as its own", () => {
    const plan = planImport(
      [
        app({
          applicationId: "a1",
          githubRepo: "acme/web",
          branch: "staging",
        }),
      ],
      [repo]
    );
    expect(plan.candidates.map((c) => c.applicationId)).toEqual(["a1"]);
  });

  it("makes one repository of staging and production on one branch", () => {
    const plan = planImport(
      [
        app({ applicationId: "s", environment: "staging" }),
        app({ applicationId: "p", environment: "production" }),
      ],
      []
    );
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      applicationId: "p",
      also: ["Kunde / staging / App"],
    });
  });

  it("lists services without a GitHub source", () => {
    const plan = planImport([app({ githubRepo: null })], []);
    expect(plan.unsupported).toHaveLength(1);
    expect(plan.candidates).toEqual([]);
  });
});
