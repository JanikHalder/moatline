import path from "node:path";
import { eq } from "drizzle-orm";
import { db, repositories } from "db";
import type { GitApi } from "../lib/git-api";
import {
  frameworkOf,
  isMigrationFile,
  riskyStatements,
  setupIssues,
  type MigrationFramework,
  type MigrationIssue,
} from "../lib/migrations";
import { notify } from "../lib/notify";

/**
 * Database migrations seen before they reach production: risky setups on
 * the default branch, and what each open pull request — and every commit
 * merged but not deployed yet — would do to the data. Platforms see
 * containers; this needs the code.
 */

export type MigrationCheck = {
  checkedAt: string;
  framework: MigrationFramework | null;
  /** Default branch tip the check ran on. */
  head: string | null;
  setup: MigrationIssue[];
  /** Merged migrations since the deployed commit (or the previous tip). */
  branch: { from: string; to: string; issues: MigrationIssue[] } | null;
  prs: Array<{
    number: number;
    url: string;
    title: string;
    headSha: string | null;
    issues: MigrationIssue[];
  }>;
  /** What was already notified, so each finding is told once. */
  notified: string[];
};

type Repo = typeof repositories.$inferSelect;

/** Migration files read per change set — a big rebase is not a review. */
const MAX_FILES = 15;
const MAX_PRS = 20;
/** Re-check unchanged repositories this often (setup issues can change). */
const RECHECK_MS = 6 * 60 * 60 * 1000;

async function text(api: GitApi, file: string, ref: string) {
  const r = await api.readFile(file, ref).catch(() => null);
  return r?.ok ? r.text : null;
}

/** Risky statements in the migrations a change set adds or edits. */
async function changeIssues(
  api: GitApi,
  base: string,
  head: string,
  readAt: string
): Promise<MigrationIssue[] | null> {
  const files = await api.changedFiles(base, head).catch(() => null);
  if (!files) return null;
  const migrations = files.filter(isMigrationFile).slice(0, MAX_FILES);
  const out: MigrationIssue[] = [];
  for (const f of migrations) {
    const body = await text(api, f, readAt);
    if (body) out.push(...riskyStatements(body, f));
  }
  return out;
}

/** Whether the check should run again. */
export function due(
  prev: MigrationCheck | null,
  head: string | null,
  prs: Array<{ number: number; headSha: string | null }>,
  now = Date.now()
): boolean {
  if (!prev) return true;
  if (prev.head !== head) return true;
  if (now - Date.parse(prev.checkedAt) > RECHECK_MS) return true;
  const before = new Map(prev.prs.map((p) => [p.number, p.headSha]));
  return (
    prs.length !== prev.prs.length ||
    prs.some((p) => !before.has(p.number) || before.get(p.number) !== p.headSha)
  );
}

/** Check a repository's migrations; returns the stored result. */
export async function checkMigrations(
  repo: Repo,
  api: GitApi,
  opts: { head: string | null; force?: boolean }
): Promise<MigrationCheck | null> {
  const prev = (repo.migrationCheck as MigrationCheck | null) ?? null;
  const branch = repo.defaultBranch;
  const openPrs = ((await api.listOpenPrs().catch(() => null)) ?? []).slice(
    0,
    MAX_PRS
  );
  if (!opts.force && !due(prev, opts.head, openPrs)) return prev;

  const pkgPath = repo.packageJsonPath || "package.json";
  const dir =
    path.posix.dirname(pkgPath) === "."
      ? ""
      : `${path.posix.dirname(pkgPath)}/`;
  const pkgText = await text(api, pkgPath, branch);
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  } = {};
  try {
    pkg = pkgText ? JSON.parse(pkgText) : {};
  } catch {
    pkg = {};
  }
  const framework = frameworkOf(pkg);
  const result: MigrationCheck = {
    checkedAt: new Date().toISOString(),
    framework,
    head: opts.head,
    setup: [],
    branch: null,
    prs: [],
    notified: prev?.notified ?? [],
  };

  if (framework) {
    const firstOf = async (files: string[]) => {
      for (const f of files) {
        const t = await text(api, f, branch);
        if (t != null) return t;
      }
      return null;
    };
    const payloadConfig =
      framework === "payload"
        ? await firstOf(
            [
              "src/payload.config.ts",
              "payload.config.ts",
              "src/payload/payload.config.ts",
            ].map((f) => `${dir}${f}`)
          )
        : null;
    const dockerfile = await firstOf([
      ...new Set([`${dir}Dockerfile`, "Dockerfile"]),
    ]);
    const hasMigrations =
      framework === "payload"
        ? (await text(api, `${dir}src/migrations/index.ts`, branch)) != null
        : false;
    result.setup = setupIssues({
      framework,
      scripts: pkg.scripts ?? {},
      payloadConfig,
      dockerfile,
      hasMigrations,
    });

    // Merged, perhaps not live yet: since what runs, else since last time.
    const from = repo.deployedCommit ?? prev?.head ?? null;
    if (from && opts.head && from !== opts.head) {
      const issues = await changeIssues(api, from, opts.head, opts.head);
      if (issues) result.branch = { from, to: opts.head, issues };
    }

    for (const pr of openPrs) {
      const reuse = prev?.prs.find(
        (p) => p.number === pr.number && p.headSha && p.headSha === pr.headSha
      );
      if (reuse) {
        result.prs.push(reuse);
        continue;
      }
      if (!pr.headRef) continue;
      const issues = await changeIssues(
        api,
        branch,
        pr.headRef,
        pr.headSha ?? pr.headRef
      );
      result.prs.push({
        number: pr.number,
        url: pr.url,
        title: pr.title.slice(0, 200),
        headSha: pr.headSha,
        issues: issues ?? [],
      });
    }
  }

  // Tell once per change set — a new push to the PR is a new change set.
  const tell: Array<{
    key: string;
    title: string;
    message: string;
    url?: string;
  }> = [];
  for (const pr of result.prs) {
    const high = pr.issues.filter((i) => i.severity === "high");
    const key = `pr:${pr.number}:${pr.headSha ?? ""}`;
    if (high.length && !result.notified.includes(key))
      tell.push({
        key,
        title: `PR #${pr.number} in ${repo.name} would delete data`,
        message: [
          `"${pr.title}" adds a migration that ${high.map((i) => i.title.toLowerCase()).join(", ")}.`,
          "Check it before merging — a renamed field or collection looks like this to the migration tool.",
        ].join("\n"),
        url: pr.url,
      });
  }
  if (result.branch) {
    const high = result.branch.issues.filter((i) => i.severity === "high");
    const key = `branch:${result.branch.to}`;
    if (high.length && !result.notified.includes(key))
      tell.push({
        key,
        title: `${repo.name}: a merged migration deletes data`,
        message: [
          `${repo.defaultBranch} now has a migration that ${high.map((i) => i.title.toLowerCase()).join(", ")}.`,
          repo.deployedCommit
            ? "It is not deployed yet — take a backup or fix the migration first."
            : "Take a backup before it is deployed.",
        ].join("\n"),
      });
  }
  for (const t of tell) {
    await notify(repo.organizationId, {
      type: "workflow_failed",
      title: t.title,
      message: t.message,
      url: t.url,
    }).catch(() => {});
    result.notified.push(t.key);
  }
  result.notified = result.notified.slice(-200);

  await db
    .update(repositories)
    .set({ migrationCheck: result })
    .where(eq(repositories.id, repo.id));
  return result;
}
