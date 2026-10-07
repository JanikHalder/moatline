import semver from "semver";
import type { AuditSeverity, Vulnerability } from "./audit";
import type { LockedPackage } from "./lockfile";

/** The endpoint `npm audit` itself uses: the GitHub advisory database. */
const BULK_URL = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const NAMES_PER_REQUEST = 400;
const TIMEOUT_MS = 30_000;

type Advisory = {
  id?: number;
  url?: string;
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
  cvss?: { score?: number };
};

const SEVERITIES: AuditSeverity[] = ["critical", "high", "moderate", "low"];

function severity(s?: string): AuditSeverity {
  return SEVERITIES.includes(s as AuditSeverity)
    ? (s as AuditSeverity)
    : "info";
}

/**
 * The first version outside the vulnerable range, read from its upper
 * bound ("<1.2.3" → 1.2.3). "<=1.2.3" or no bound: no fix known yet.
 */
export function patchedVersion(range: string): string | null {
  let best: string | null = null;
  for (const part of range.split("||")) {
    const m = part.match(/<\s*(\d+\.\d+\.\d+[\w.+-]*)\s*$/);
    if (!m || part.includes("<=")) return null;
    if (!best || semver.gt(m[1]!, best)) best = m[1]!;
  }
  return best;
}

const OSV_BATCH = "https://api.osv.dev/v1/querybatch";

/**
 * Known malicious package versions (the OpenSSF malicious-packages list in
 * OSV, ids "MAL-…") — worms and typosquats that steal tokens on install.
 * Not a CVE: there is no fixed version, the version itself is the attack.
 * A lookup that fails is skipped, not an error: the CVE results still stand.
 */
export async function lookupMalicious(
  packages: LockedPackage[],
  direct: Set<string>
): Promise<Vulnerability[]> {
  const out: Vulnerability[] = [];
  for (let i = 0; i < packages.length; i += 1000) {
    const chunk = packages.slice(i, i + 1000);
    let res: Response;
    try {
      res = await fetch(OSV_BATCH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries: chunk.map((p) => ({
            package: { name: p.name, ecosystem: "npm" },
            version: p.version,
          })),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return out;
    }
    if (!res.ok) return out;
    const data = (await res.json().catch(() => null)) as {
      results?: Array<{ vulns?: Array<{ id?: string }> }>;
    } | null;
    (data?.results ?? []).forEach((r, j) => {
      const pkg = chunk[j];
      if (!pkg) return;
      for (const v of r.vulns ?? []) {
        if (!v.id?.startsWith("MAL-")) continue;
        out.push({
          packageName: pkg.name,
          severity: "critical",
          ghsaId: null,
          cveId: null,
          title: `Malicious package (${v.id}): ${pkg.name}@${pkg.version} contains malware — remove it, then rotate every token and key the machines that installed it could reach.`,
          url: `https://osv.dev/vulnerability/${v.id}`,
          vulnerableRange: pkg.version,
          patchedVersion: null,
          fixAvailable: false,
          fixIsSemverMajor: false,
          isDirect: direct.has(pkg.name),
          cvssScore: null,
        });
      }
    });
  }
  return out;
}

/**
 * CVEs for exact installed versions, without cloning or installing: one
 * request per few hundred packages. Same data and same rows as
 * `npm audit` — one row per vulnerable package and advisory.
 */
export async function lookupAdvisories(
  packages: LockedPackage[],
  direct: Set<string>
): Promise<
  { ok: true; vulnerabilities: Vulnerability[] } | { ok: false; error: string }
> {
  const versions = new Map<string, string[]>();
  for (const p of packages) {
    const list = versions.get(p.name) ?? [];
    list.push(p.version);
    versions.set(p.name, list);
  }
  const names = [...versions.keys()];
  const out: Vulnerability[] = [];
  // The same advisory can come back more than once for a package.
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i += NAMES_PER_REQUEST) {
    const body = Object.fromEntries(
      names.slice(i, i + NAMES_PER_REQUEST).map((n) => [n, versions.get(n)!])
    );
    let res: Response;
    try {
      res = await fetch(BULK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return {
        ok: false,
        error: `npm advisory database not reachable: ${e instanceof Error ? e.message : "network error"}`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `npm advisory database answered HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as Record<string, Advisory[]>;
    for (const [name, advisories] of Object.entries(data)) {
      const installed = versions.get(name) ?? [];
      for (const a of advisories ?? []) {
        const range = a.vulnerable_versions ?? "";
        // The endpoint answers per package; which versions are hit is ours
        // to check.
        const hit = installed.filter((v) => {
          try {
            return semver.satisfies(v, range, { includePrerelease: true });
          } catch {
            return false;
          }
        });
        const key = `${name}|${a.url ?? a.id}`;
        if (!hit.length || seen.has(key)) continue;
        seen.add(key);
        const patched = patchedVersion(range);
        const maxMajor = Math.max(...hit.map((v) => semver.major(v)));
        out.push({
          packageName: name,
          severity: severity(a.severity),
          ghsaId: a.url?.match(/GHSA-[\w-]+/i)?.[0] ?? null,
          cveId: a.title?.match(/CVE-\d{4}-\d+/i)?.[0] ?? null,
          title: a.title ?? null,
          url: a.url ?? null,
          vulnerableRange: range || null,
          patchedVersion: patched,
          fixAvailable: patched != null,
          fixIsSemverMajor: patched != null && semver.major(patched) > maxMajor,
          isDirect: direct.has(name),
          cvssScore: a.cvss?.score != null ? String(a.cvss.score) : null,
        });
      }
    }
  }
  // Malware is checked alongside: the same lockfile, a different database.
  const malicious = await lookupMalicious(packages, direct).catch(() => []);
  return { ok: true, vulnerabilities: [...malicious, ...out] };
}
