import semver from "semver";
import { eq, or, isNotNull } from "drizzle-orm";
import { db, orgIntegrations } from "db";
import { dokployVersion } from "../lib/dokploy";
import { coolifyVersion } from "../lib/coolify";
import { komodoVersion } from "../lib/komodo";
import { portainerVersion } from "../lib/portainer";
import { notify } from "../lib/notify";
import { resolveDokployConfig } from "./deploy";
import { resolveCoolifyConfig } from "./coolify";
import { resolveKomodoConfig, resolvePortainerConfig } from "./stack-platforms";

/**
 * A watch on the platforms themselves: the version each connected one runs,
 * against the security advisories its project publishes. A platform cannot
 * credibly say it is the vulnerable part — so something else has to.
 */

export type PlatformKey = "dokploy" | "coolify" | "komodo" | "portainer";

const REPOS: Record<PlatformKey, { repo: string; label: string }> = {
  dokploy: { repo: "Dokploy/dokploy", label: "Dokploy" },
  coolify: { repo: "coollabsio/coolify", label: "Coolify" },
  komodo: { repo: "moghtech/komodo", label: "Komodo" },
  portainer: { repo: "portainer/portainer", label: "Portainer" },
};

export type Advisory = {
  id: string;
  cve: string | null;
  summary: string;
  severity: string;
  url: string;
  /** The ranges it affects, as GitHub writes them. */
  ranges: string[];
  patched: string | null;
};

export type PlatformStatus = {
  platform: PlatformKey;
  label: string;
  version: string | null;
  latest: string | null;
  /** Advisories that affect the installed version. */
  affected: Advisory[];
};

export type PlatformWatch = {
  checkedAt: string;
  platforms: PlatformStatus[];
  notified: string[];
};

const clean = (v: string | null | undefined) =>
  v ? v.trim().replace(/^v/i, "") : null;

/** Whether a version falls in one of GitHub's ranges ("< 1.2.3", ">= 1, < 2"). */
export function inRange(version: string, range: string): boolean | null {
  const v =
    semver.valid(version) ??
    semver.coerce(version, { includePrerelease: true })?.version ??
    null;
  if (!v) return null;
  const r = range.replace(/,/g, " ").replace(/\bv(?=\d)/g, "");
  try {
    return semver.satisfies(v, r, { includePrerelease: true });
  } catch {
    return null;
  }
}

type GhAdvisory = {
  ghsa_id: string;
  cve_id?: string | null;
  summary: string;
  severity: string;
  html_url: string;
  vulnerabilities?: Array<{
    vulnerable_version_range?: string | null;
    patched_versions?: string | null;
  }> | null;
};

const TTL = 6 * 60 * 60 * 1000;
const cache = new Map<
  string,
  { at: number; advisories: Advisory[]; latest: string | null }
>();

async function gh<T>(path: string): Promise<T | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** A project's published advisories and latest release, cached for hours. */
async function projectInfo(repo: string) {
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const [list, release] = await Promise.all([
    gh<GhAdvisory[]>(
      `/repos/${repo}/security-advisories?state=published&per_page=100`
    ),
    gh<{ tag_name?: string }>(`/repos/${repo}/releases/latest`),
  ]);
  const info = {
    at: Date.now(),
    advisories: (list ?? []).map((a) => ({
      id: a.ghsa_id,
      cve: a.cve_id ?? null,
      summary: a.summary,
      severity: a.severity,
      url: a.html_url,
      ranges: (a.vulnerabilities ?? [])
        .map((v) => v.vulnerable_version_range ?? "")
        .filter(Boolean),
      patched:
        (a.vulnerabilities ?? [])
          .map((v) => v.patched_versions)
          .find(Boolean) ?? null,
    })),
    latest: clean(release?.tag_name),
  };
  // A failed read is not "no advisories": keep the last good answer.
  if (list || !hit) cache.set(repo, info);
  return list ? info : (hit ?? info);
}

/** The advisories a version is affected by. */
export function affecting(version: string, advisories: Advisory[]): Advisory[] {
  return advisories.filter((a) =>
    a.ranges.some((r) => inRange(version, r) === true)
  );
}

async function versions(
  organizationId: string
): Promise<Partial<Record<PlatformKey, string | null>>> {
  const out: Partial<Record<PlatformKey, string | null>> = {};
  const [d, c, k, p] = await Promise.all([
    resolveDokployConfig(organizationId).catch(() => null),
    resolveCoolifyConfig(organizationId).catch(() => null),
    resolveKomodoConfig(organizationId).catch(() => null),
    resolvePortainerConfig(organizationId).catch(() => null),
  ]);
  if (d?.ok) out.dokploy = await dokployVersion(d.config).catch(() => null);
  if (c?.ok) out.coolify = await coolifyVersion(c.config).catch(() => null);
  if (k?.ok) {
    const r = await komodoVersion(k.config).catch(() => null);
    out.komodo = r?.ok ? clean(r.data) : null;
  }
  if (p?.ok) {
    const r = await portainerVersion(p.config).catch(() => null);
    out.portainer = r?.ok && r.data !== "?" ? clean(r.data) : null;
  }
  return out;
}

/** Check every connected platform of an organization, notify what is new. */
export async function watchPlatforms(
  organizationId: string
): Promise<PlatformWatch> {
  const [row] = await db
    .select({ platformWatch: orgIntegrations.platformWatch })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId));
  const prev = (row?.platformWatch as PlatformWatch | null) ?? null;
  const found = await versions(organizationId);
  const platforms: PlatformStatus[] = [];
  for (const [key, version] of Object.entries(found) as Array<
    [PlatformKey, string | null]
  >) {
    const { repo, label } = REPOS[key];
    const info = await projectInfo(repo);
    platforms.push({
      platform: key,
      label,
      version,
      latest: info.latest,
      affected: version ? affecting(version, info.advisories) : [],
    });
  }
  const notified = [...(prev?.notified ?? [])];
  for (const p of platforms) {
    for (const a of p.affected) {
      const key = `${p.platform}:${p.version}:${a.id}`;
      if (notified.includes(key)) continue;
      notified.push(key);
      await notify(organizationId, {
        type: "server_alert",
        title: `${p.label} ${p.version} has a known vulnerability (${a.severity})`,
        message: [
          a.summary,
          a.patched ? `Fixed in ${a.patched}.` : null,
          p.latest ? `Latest release: ${p.latest}.` : null,
          `Update ${p.label}: ${a.url}`,
        ]
          .filter(Boolean)
          .join("\n"),
        url: a.url,
      }).catch(() => {});
    }
  }
  const result: PlatformWatch = {
    checkedAt: new Date().toISOString(),
    platforms,
    notified: notified.slice(-200),
  };
  await db
    .update(orgIntegrations)
    .set({ platformWatch: result })
    .where(eq(orgIntegrations.organizationId, organizationId));
  return result;
}

const lastRun = new Map<string, number>();

/** Every few hours for each organization with a platform connected. */
export async function watchDuePlatforms(): Promise<void> {
  const orgs = await db
    .select({ organizationId: orgIntegrations.organizationId })
    .from(orgIntegrations)
    .where(
      or(
        isNotNull(orgIntegrations.dokployBaseUrl),
        isNotNull(orgIntegrations.coolifyBaseUrl),
        isNotNull(orgIntegrations.komodoBaseUrl),
        isNotNull(orgIntegrations.portainerBaseUrl)
      )
    );
  for (const o of orgs) {
    const last = lastRun.get(o.organizationId);
    if (last && Date.now() - last < TTL) continue;
    lastRun.set(o.organizationId, Date.now());
    await watchPlatforms(o.organizationId).catch((e) =>
      console.error("[platform-watch] failed:", e)
    );
  }
}
