import { and, eq, inArray } from "drizzle-orm";
import { db, updateRuns, repositories } from "db";
import { runSecurityFix } from "./security-fix";
import { auditRaw } from "../lib/audit-log";

const ACTIVE = ["created", "updating", "build_running", "deploying"] as const;

export type SecurityFixTrigger = "auto" | "manual" | "mcp";

/**
 * Start a security-fix run when none is already in flight for the repo.
 * Returns the run id, or null when skipped (overlap / insert failure).
 */
export async function startSecurityFixIfIdle(
  repositoryId: string,
  opts: {
    scanId?: string;
    triggerSource?: SecurityFixTrigger;
    detail?: { reason?: "cve" | "overnight"; apiKey?: string } | null;
  } = {}
): Promise<string | null> {
  const active = await db
    .select({ id: updateRuns.id })
    .from(updateRuns)
    .where(
      and(
        eq(updateRuns.repositoryId, repositoryId),
        eq(updateRuns.kind, "security"),
        inArray(updateRuns.status, [...ACTIVE])
      )
    );
  if (active.length > 0) return null;

  // An open security PR already waits for merge — do not open another.
  const openPr = await db
    .select({ id: updateRuns.id })
    .from(updateRuns)
    .where(
      and(
        eq(updateRuns.repositoryId, repositoryId),
        eq(updateRuns.kind, "security"),
        eq(updateRuns.status, "pr_opened")
      )
    )
    .limit(1);
  if (openPr.length > 0) return null;

  const [repo] = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      organizationId: repositories.organizationId,
    })
    .from(repositories)
    .where(eq(repositories.id, repositoryId));

  const source = opts.triggerSource ?? "auto";
  const branchName = `security/cve-fix-${Date.now()}`;
  const [newRun] = await db
    .insert(updateRuns)
    .values({
      repositoryId,
      branchName,
      status: "created",
      kind: "security",
      scanId: opts.scanId,
      triggerSource: source,
      triggerDetail: opts.detail ?? null,
    })
    .returning();
  if (!newRun) return null;

  console.log(
    `[api] Security-fix queued: repo=${repositoryId} run=${newRun.id} source=${source}${opts.detail?.reason ? ` (${opts.detail.reason})` : ""}`
  );
  await auditRaw({
    organizationId: repo?.organizationId ?? null,
    action: "security_fix.started",
    userEmail:
      source === "mcp" && opts.detail?.apiKey
        ? `mcp:${opts.detail.apiKey}`
        : source === "auto"
          ? "moatline:auto_fix"
          : null,
    target: {
      type: "repository",
      id: repositoryId,
      name: repo?.name ?? null,
    },
    detail: {
      source,
      runId: newRun.id,
      scanId: opts.scanId,
      branchName,
      ...(opts.detail ?? {}),
    },
  });
  runSecurityFix(newRun.id).catch((e) =>
    console.error("[api] runSecurityFix error:", e)
  );
  return newRun.id;
}

/** Same as startSecurityFixIfIdle, but waits until the run finishes. */
export async function runSecurityFixWhenIdle(
  repositoryId: string,
  opts: Parameters<typeof startSecurityFixIfIdle>[1] = {}
): Promise<string | null> {
  const id = await startSecurityFixIfIdle(repositoryId, opts);
  if (!id) return null;
  await waitForSecurityRun(id);
  return id;
}

const TERMINAL = new Set([
  "pushed",
  "pr_opened",
  "merged",
  "deployed",
  "failed",
  "closed",
]);

async function waitForSecurityRun(runId: string): Promise<void> {
  // Overnight backlog: one fix at a time so clones + builds cannot pile up.
  const deadline = Date.now() + 50 * 60 * 1000;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ status: updateRuns.status })
      .from(updateRuns)
      .where(eq(updateRuns.id, runId));
    if (!row || TERMINAL.has(row.status)) return;
    await sleep(5_000);
  }
  console.warn(
    `[api] security-fix ${runId} still running after 50 min — overnight continues`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
