import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  saved: null as unknown,
  notified: [] as Array<{ title: string }>,
}));

vi.mock("db", () => ({
  repositories: { id: "id" },
  db: {
    update: () => ({
      set: (v: { migrationCheck: unknown }) => ({
        where: () => {
          state.saved = v.migrationCheck;
          return Promise.resolve();
        },
      }),
    }),
  },
}));
vi.mock("../lib/notify", () => ({
  notify: vi.fn(async (_org: string, e: { title: string }) => {
    state.notified.push(e);
  }),
}));

import type { GitApi } from "../lib/git-api";
import { checkMigrations, due, type MigrationCheck } from "./migration-guard";

const files: Record<string, string> = {
  "package.json": JSON.stringify({
    dependencies: { "@payloadcms/db-postgres": "3.0.0" },
    scripts: { start: "next start" },
  }),
  "src/payload.config.ts": "db: postgresAdapter({ pool, push: true })",
  "src/migrations/index.ts": "export const migrations = []",
  "src/migrations/20261006_rename.ts": `export async function up({ db }) {
  await db.execute(sql\`DROP TABLE "authors";\`)
}
export async function down({ db }) {}`,
};

const api = {
  readFile: async (f: string) =>
    f in files
      ? { ok: true, text: files[f] }
      : { ok: false, status: 404, error: "not found" },
  listOpenPrs: async () => [
    {
      number: 7,
      title: "Rename authors to people",
      url: "https://github.com/acme/shop/pull/7",
      author: null,
      draft: false,
      createdAt: "2026-10-06",
      headRef: "rename",
      headSha: "abc1234",
    },
  ],
  changedFiles: async (_b: string, head: string) =>
    head === "rename" ? ["src/migrations/20261006_rename.ts", "src/x.ts"] : [],
} as unknown as GitApi;

const repo = {
  id: "r1",
  name: "shop",
  organizationId: "o1",
  defaultBranch: "main",
  packageJsonPath: "package.json",
  deployedCommit: null,
  migrationCheck: null,
} as never;

beforeEach(() => {
  state.saved = null;
  state.notified = [];
});

describe("migration guard", () => {
  it("finds the risky setup and the PR that drops a table, and tells once", async () => {
    const r = await checkMigrations(repo, api, { head: "h1" });
    expect(r?.framework).toBe("payload");
    expect(r?.setup.map((i) => i.kind)).toEqual([
      "push-in-production",
      "never-run",
    ]);
    expect(r?.prs[0]).toMatchObject({
      number: 7,
      issues: [{ kind: "drop-table", title: "Drops table authors" }],
    });
    expect(state.notified.map((n) => n.title)).toEqual([
      "PR #7 in shop would delete data",
    ]);

    // Same PR, same commit: nothing new to tell.
    state.notified = [];
    await checkMigrations(
      { ...(repo as object), migrationCheck: r } as never,
      api,
      {
        head: "h1",
        force: true,
      }
    );
    expect(state.notified).toEqual([]);
  });

  it("runs again only when something moved", () => {
    const prev = {
      checkedAt: new Date().toISOString(),
      head: "h1",
      prs: [{ number: 7, headSha: "a" }],
    } as MigrationCheck;
    expect(due(prev, "h1", [{ number: 7, headSha: "a" }])).toBe(false);
    expect(due(prev, "h2", [{ number: 7, headSha: "a" }])).toBe(true);
    expect(due(prev, "h1", [{ number: 7, headSha: "b" }])).toBe(true);
    expect(due(prev, "h1", [])).toBe(true);
    expect(due(null, "h1", [])).toBe(true);
  });
});
