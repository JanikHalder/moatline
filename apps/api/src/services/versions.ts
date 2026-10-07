import { and, eq, inArray } from "drizzle-orm";
import semver from "semver";
import { clients, db, repositories, updateRuns } from "db";
import {
  NODE_EOL,
  STACK_PACKAGES,
  effectiveVersion,
  nodeSupport,
  type Stack,
  type StackPackage,
} from "../lib/stack";
import { runUpdateWorkflow, type UpdatePin } from "./update-workflow";

const TTL_MS = 60 * 60 * 1000;
const tags = new Map<string, { at: number; latest: string | null }>();

/** Newest release on npm (dist-tag "latest"), cached for an hour. */
export async function latestOf(name: string): Promise<string | null> {
  const hit = tags.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.latest;
  let latest: string | null = null;
  try {
    const res = await fetch(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (res.ok) {
      const body = (await res.json()) as { latest?: unknown };
      latest = typeof body.latest === "string" ? body.latest : null;
    }
  } catch {
    latest = null;
  }
  tags.set(name, { at: Date.now(), latest });
  return latest;
}

/** Whether a release exists on npm — a typo must not become a PR. */
export async function releaseExists(
  name: string,
  version: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export type Lag = "current" | "patch" | "minor" | "major" | "unknown";

/** How far a version is behind the newest release. */
export function lagOf(version: string | null, latest: string | null): Lag {
  if (!version || !latest || !semver.valid(version) || !semver.valid(latest))
    return "unknown";
  if (semver.gte(version, latest)) return "current";
  const d = semver.diff(version, latest);
  return d === "major" || d === "premajor"
    ? "major"
    : d === "minor" || d === "preminor"
      ? "minor"
      : "patch";
}

/**
 * The newest Node.js major that is LTS already and supported for another
 * year. An even major turns LTS in the October of its release year — 30
 * months before its end of life.
 */
export function recommendedNode(now = Date.now()): number {
  const YEAR = 365 * 24 * 3600 * 1000;
  const lts = Object.entries(NODE_EOL)
    .map(([major, eol]) => {
      const end = new Date(eol);
      const ltsFrom = new Date(end);
      ltsFrom.setUTCMonth(ltsFrom.getUTCMonth() - 30);
      return {
        major: Number(major),
        end: end.getTime(),
        ltsFrom: ltsFrom.getTime(),
      };
    })
    .filter((n) => n.major % 2 === 0 && n.ltsFrom <= now && n.end - now > YEAR)
    .map((n) => n.major);
  return lts.length ? Math.max(...lts) : 22;
}

export async function versionOverview(organizationId: string) {
  const latest = Object.fromEntries(
    await Promise.all(
      STACK_PACKAGES.map(async (n) => [n, await latestOf(n)] as const)
    )
  ) as Record<StackPackage, string | null>;
  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      githubUrl: repositories.githubUrl,
      clientId: repositories.clientId,
      clientName: clients.name,
      stack: repositories.stack,
    })
    .from(repositories)
    .leftJoin(clients, eq(clients.id, repositories.clientId))
    .where(eq(repositories.organizationId, organizationId));
  // Bulk upgrades still running, so the button does not start a second one.
  const busy = rows.length
    ? await db
        .select({ repositoryId: updateRuns.repositoryId })
        .from(updateRuns)
        .where(
          and(
            inArray(
              updateRuns.repositoryId,
              rows.map((r) => r.id)
            ),
            inArray(updateRuns.status, ["created", "updating", "build_running"])
          )
        )
    : [];
  const running = new Set(busy.map((b) => b.repositoryId));
  return {
    latest,
    node: { recommended: recommendedNode(), eol: NODE_EOL },
    repos: rows.map((r) => {
      const stack = r.stack as Stack | null;
      const packages = Object.fromEntries(
        STACK_PACKAGES.filter((n) => stack?.packages[n]).map((n) => {
          const version = effectiveVersion(stack!.packages[n]);
          return [
            n,
            {
              version,
              declared: stack!.packages[n]!.declared,
              fromLockfile: !!stack!.packages[n]!.installed,
              lag: lagOf(version, latest[n]),
            },
          ];
        })
      );
      return {
        id: r.id,
        name: r.name,
        githubUrl: r.githubUrl,
        client: r.clientId ? { id: r.clientId, name: r.clientName } : null,
        packages,
        node: stack?.node
          ? { ...stack.node, support: nodeSupport(stack.node.version) }
          : null,
        scannedAt: stack?.at ?? null,
        updating: running.has(r.id),
      };
    }),
  };
}

const LEADER: Record<UpdatePin["family"], string> = {
  Payload: "payload",
  "Next.js": "next",
  React: "react",
  Lexical: "lexical",
};

/**
 * One update run per repository: the family to exactly this release, a
 * pull request each. Builds run one at a time (heavy slot), so twenty
 * sites take a while but never overload the server.
 */
export async function startBulkUpgrade(
  organizationId: string,
  pin: UpdatePin,
  repoIds: string[]
): Promise<
  { ok: true; started: number } | { ok: false; error: string; status: 400 }
> {
  if (!(await releaseExists(LEADER[pin.family], pin.version)))
    return {
      ok: false,
      error: `${LEADER[pin.family]}@${pin.version} does not exist on npm.`,
      status: 400,
    };
  const repos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        inArray(repositories.id, repoIds)
      )
    );
  const slug = `${LEADER[pin.family]}-${pin.version}`.replace(/[^\w.-]/g, "-");
  for (const repo of repos) {
    const [run] = await db
      .insert(updateRuns)
      .values({
        repositoryId: repo.id,
        branchName: `deps/${slug}-${Date.now()}`,
        status: "created",
      })
      .returning({ id: updateRuns.id });
    if (run) runUpdateWorkflow(run.id, { pin }).catch(() => {});
  }
  return { ok: true, started: repos.length };
}
