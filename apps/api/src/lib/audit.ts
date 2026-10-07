import fs from "node:fs";
import path from "node:path";
import { run } from "./run";
import { detectPackageManager, type PackageManager } from "./package-manager";

export type AuditSeverity = "critical" | "high" | "moderate" | "low" | "info";

export type Vulnerability = {
  packageName: string;
  severity: AuditSeverity;
  ghsaId: string | null;
  cveId: string | null;
  title: string | null;
  url: string | null;
  vulnerableRange: string | null;
  patchedVersion: string | null;
  fixAvailable: boolean;
  fixIsSemverMajor: boolean;
  isDirect: boolean;
  cvssScore: string | null;
};

export type AuditResult = {
  supported: boolean;
  manager: PackageManager;
  vulnerabilities: Vulnerability[];
  note?: string;
};

const LOCKFILE_TIMEOUT_MS = 120_000;
const AUDIT_TIMEOUT_MS = 120_000;

const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const CVE_RE = /CVE-\d{4}-\d+/i;

function extractGhsa(url?: string | null): string | null {
  return url?.match(GHSA_RE)?.[0] ?? null;
}

type NpmViaObject = {
  source?: number;
  name?: string;
  dependency?: string;
  title?: string;
  url?: string;
  severity?: string;
  cwe?: string[];
  cvss?: { score?: number; vectorString?: string };
  range?: string;
};
type NpmVia = string | NpmViaObject;

type NpmVuln = {
  name?: string;
  severity?: string;
  isDirect?: boolean;
  via?: NpmVia[];
  range?: string;
  fixAvailable?:
    | boolean
    | { name?: string; version?: string; isSemVerMajor?: boolean };
};

type NpmAuditReport = {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, NpmVuln>;
};

function normalizeSeverity(s?: string): AuditSeverity {
  switch (s) {
    case "critical":
    case "high":
    case "moderate":
    case "low":
      return s;
    default:
      return "info";
  }
}

/** Parse an `npm audit --json` (auditReportVersion 2) report into flat rows. */
export function parseNpmAudit(json: NpmAuditReport): Vulnerability[] {
  const out: Vulnerability[] = [];
  for (const [name, v] of Object.entries(json.vulnerabilities ?? {})) {
    // `via` mixes advisory OBJECTS with STRING graph-edges; keep the object.
    const advisory = (v.via ?? []).find(
      (x): x is NpmViaObject => typeof x === "object" && x !== null
    );
    const fix = v.fixAvailable;
    const fixObj = typeof fix === "object" && fix ? fix : null;
    const url = advisory?.url ?? null;
    out.push({
      packageName: name,
      severity: normalizeSeverity(v.severity ?? advisory?.severity),
      ghsaId: extractGhsa(url),
      cveId: advisory?.title?.match(CVE_RE)?.[0] ?? null,
      title: advisory?.title ?? null,
      url,
      vulnerableRange: v.range ?? advisory?.range ?? null,
      patchedVersion: fixObj?.version ?? null,
      fixAvailable: fix !== false && fix !== undefined,
      fixIsSemverMajor: fixObj?.isSemVerMajor ?? false,
      isDirect: v.isDirect ?? false,
      cvssScore:
        advisory?.cvss?.score != null ? String(advisory.cvss.score) : null,
    });
  }
  return out;
}

/**
 * The v1 audit format, which pnpm and yarn both speak: one entry per advisory
 * instead of npm v2's per-package tree. Fields carry different names and, in
 * places, different meanings — `patched_versions` is a range, not a version.
 */
type V1Advisory = {
  module_name?: string;
  severity?: string;
  title?: string;
  url?: string;
  github_advisory_id?: string;
  cves?: string[];
  vulnerable_versions?: string;
  patched_versions?: string;
  cvss?: { score?: number };
};

type V1Report = { advisories?: Record<string, V1Advisory> };

/**
 * Parse a v1 advisories report. `directDeps` decides `isDirect`: unlike npm's
 * report, v1 does not say whether the vulnerable package is one the project
 * asked for or something further down the tree — and that distinction drives
 * how urgent a finding is.
 */
export function parseV1Advisories(
  report: V1Report,
  directDeps: Set<string> = new Set()
): Vulnerability[] {
  const out: Vulnerability[] = [];
  for (const advisory of Object.values(report.advisories ?? {})) {
    const name = advisory.module_name;
    if (!name) continue;
    const patched = advisory.patched_versions?.trim() || null;
    // "<0.0.0" is how the format spells "no fix exists".
    const hasFix = !!patched && patched !== "<0.0.0";
    out.push({
      packageName: name,
      severity: normalizeSeverity(advisory.severity),
      ghsaId: advisory.github_advisory_id ?? extractGhsa(advisory.url),
      cveId: advisory.cves?.[0] ?? advisory.title?.match(CVE_RE)?.[0] ?? null,
      title: advisory.title ?? null,
      url: advisory.url ?? null,
      vulnerableRange: advisory.vulnerable_versions ?? null,
      patchedVersion: hasFix ? patched : null,
      fixAvailable: hasFix,
      // v1 does not report whether the fix is a major bump; assuming it is not
      // would let the "allow breaking fixes" gate wave through a major.
      fixIsSemverMajor: false,
      isDirect: directDeps.has(name),
      cvssScore:
        advisory.cvss?.score != null ? String(advisory.cvss.score) : null,
    });
  }
  return out;
}

/**
 * yarn classic streams NDJSON instead of one document. Both shapes are
 * accepted here, because which one a repo produces depends on its yarn
 * version, not on anything we control.
 */
export function parseV1Output(
  stdout: string,
  directDeps: Set<string> = new Set()
): Vulnerability[] | null {
  try {
    const parsed = JSON.parse(stdout) as V1Report;
    if (parsed && typeof parsed === "object" && "advisories" in parsed) {
      return parseV1Advisories(parsed, directDeps);
    }
  } catch {
    // Not a single document – fall through to the line-delimited form.
  }
  const advisories: Record<string, V1Advisory> = {};
  let sawLine = false;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const row = JSON.parse(trimmed) as {
        type?: string;
        data?: { advisory?: V1Advisory & { id?: number } };
      };
      if (row.type !== "auditAdvisory" || !row.data?.advisory) continue;
      sawLine = true;
      const adv = row.data.advisory;
      advisories[String(adv.id ?? Object.keys(advisories).length)] = adv;
    } catch {
      continue;
    }
  }
  return sawLine ? parseV1Advisories({ advisories }, directDeps) : null;
}

/** Names the project depends on directly, for `isDirect`. */
function directDependencies(projectDir: string): Set<string> {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

/**
 * pnpm and yarn audit the lockfile they already have — no lockfile generation
 * step, and no `npm install` fallback that would resolve versions the repo
 * never chose.
 */
async function runV1Audit(
  projectDir: string,
  manager: "pnpm" | "yarn"
): Promise<AuditResult> {
  // yarn berry moved audit under `yarn npm`; classic yarn has it at the top
  // level. The berry marker is its own config file.
  const berry = fs.existsSync(path.join(projectDir, ".yarnrc.yml"));
  const attempts: string[][] =
    manager === "pnpm"
      ? [["audit", "--json"]]
      : berry
        ? [
            ["npm", "audit", "--json", "--all", "--recursive"],
            ["audit", "--json"],
          ]
        : [
            ["audit", "--json"],
            ["npm", "audit", "--json", "--all", "--recursive"],
          ];

  const direct = directDependencies(projectDir);
  let lastNote = `${manager} audit produced no output.`;
  for (const args of attempts) {
    // Exits non-zero whenever it finds something – that is a result, not an
    // error, so stdout is parsed either way.
    const res = await run(manager, args, {
      cwd: projectDir,
      timeout: AUDIT_TIMEOUT_MS,
      scrubSecrets: true,
    });
    if (!res.stdout.trim()) {
      lastNote = `${manager} ${args.join(" ")} produced no output: ${res.stderr.slice(0, 300)}`;
      continue;
    }
    const parsed = parseV1Output(res.stdout, direct);
    if (parsed) {
      return { supported: true, manager, vulnerabilities: parsed };
    }
    lastNote = `${manager} ${args.join(" ")} output could not be parsed.`;
  }
  return { supported: false, manager, vulnerabilities: [], note: lastNote };
}

/**
 * Run a security audit inside a cloned project dir. npm reports the v2 tree
 * format, pnpm and yarn the older per-advisory one; both are normalized to the
 * same rows. Never throws — a scan that cannot audit says so rather than
 * reporting an empty, reassuring result.
 */
export async function runAudit(projectDir: string): Promise<AuditResult> {
  const manager = detectPackageManager(projectDir);
  if (manager !== "npm") return runV1Audit(projectDir, manager);

  // npm audit needs a lockfile (not node_modules). Generate one without
  // running lifecycle scripts if the repo doesn't commit one.
  const lockPath = path.join(projectDir, "package-lock.json");
  if (!fs.existsSync(lockPath)) {
    await run(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: projectDir, timeout: LOCKFILE_TIMEOUT_MS, scrubSecrets: true }
    );
    if (!fs.existsSync(lockPath)) {
      return {
        supported: false,
        manager,
        vulnerabilities: [],
        note: "Could not create a package-lock.json to audit.",
      };
    }
  }

  // `npm audit` exits non-zero when vulnerabilities are found — that is NOT
  // an error; parse stdout regardless.
  const res = await run("npm", ["audit", "--json"], {
    cwd: projectDir,
    timeout: AUDIT_TIMEOUT_MS,
    scrubSecrets: true,
  });
  if (!res.stdout) {
    return {
      supported: false,
      manager,
      vulnerabilities: [],
      note: `npm audit produced no output: ${res.stderr.slice(0, 300)}`,
    };
  }
  let report: NpmAuditReport;
  try {
    report = JSON.parse(res.stdout) as NpmAuditReport;
  } catch {
    return {
      supported: false,
      manager,
      vulnerabilities: [],
      note: "npm audit JSON could not be parsed.",
    };
  }
  return { supported: true, manager, vulnerabilities: parseNpmAudit(report) };
}
