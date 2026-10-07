/**
 * Integration test: runs a full scan against a real repository — by default
 * a small public one; set TEST_REPO_URL (and TEST_BRANCH) for your own.
 * Uses GITHUB_TOKEN and DATABASE_URL from apps/api/.env.
 *
 * Run: pnpm --filter api test:scan
 */

import "../load-env";
import { db } from "db";
import { organization, repositories, scans } from "db";
import { eq } from "drizzle-orm";
import { runScan } from "../services/scan";

const TEST_REPO_URL =
  process.env.TEST_REPO_URL ?? "https://github.com/expressjs/express";
const TEST_BRANCH = process.env.TEST_BRANCH ?? "master";
const TEST_ROOT = "package.json";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Use apps/api/.env");
    process.exit(1);
  }
  if (!process.env.GITHUB_TOKEN) {
    console.error(
      "GITHUB_TOKEN not set. Set it in apps/api/.env for private repos."
    );
    process.exit(1);
  }

  console.log("Using GITHUB_TOKEN from env");
  console.log(
    "Target repo:",
    TEST_REPO_URL,
    "branch:",
    TEST_BRANCH,
    "root:",
    TEST_ROOT
  );

  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, "demo"))
    .limit(1);

  if (!org) {
    console.error("Demo org not found. Run: pnpm --filter api seed:demo-org");
    process.exit(1);
  }

  const allRepos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, org.id));
  let repo = allRepos.find((r) => r.githubUrl === TEST_REPO_URL);

  if (!repo) {
    const [created] = await db
      .insert(repositories)
      .values({
        organizationId: org.id,
        githubUrl: TEST_REPO_URL,
        name: "test-scan",
        defaultBranch: TEST_BRANCH,
        packageJsonPath: TEST_ROOT,
      })
      .returning();
    if (!created) {
      console.error("Failed to create repo");
      process.exit(1);
    }
    repo = created;
    console.log("Created repo:", repo.id);
  } else {
    await db
      .update(repositories)
      .set({
        defaultBranch: TEST_BRANCH,
        packageJsonPath: TEST_ROOT,
      })
      .where(eq(repositories.id, repo!.id));
    console.log("Using existing repo:", repo!.id);
  }

  const [scan] = await db
    .insert(scans)
    .values({ repositoryId: repo.id, status: "pending" })
    .returning();

  if (!scan) {
    console.error("Failed to create scan");
    process.exit(1);
  }

  console.log("Starting scan", scan.id, "...");
  try {
    const result = await runScan(repo.id, scan.id);
    console.log("Scan finished:", result ?? "null");
    if (result) {
      const [updated] = await db
        .select({ status: scans.status, errorMessage: scans.errorMessage })
        .from(scans)
        .where(eq(scans.id, result))
        .limit(1);
      if (updated) {
        console.log("Status:", updated.status);
        if (updated.errorMessage) console.log("Error:", updated.errorMessage);
      }
    }
  } catch (err) {
    console.error("Scan threw:", err);
    process.exit(1);
  }
  process.exit(0);
}

main();
