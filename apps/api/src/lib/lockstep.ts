import fs from "node:fs";
import path from "node:path";
import semver from "semver";

/**
 * Packages released together that only work at the same exact version.
 * Payload refuses to build when `payload` and an `@payloadcms/*` package
 * differ; Next.js and React behave alike. A typecheck passes either way —
 * the mismatch only shows in the deploy.
 */
export const FAMILIES = [
  {
    name: "Payload",
    leader: "payload",
    // The ESLint packages are versioned on their own.
    member: (n: string) =>
      n === "payload" ||
      (n.startsWith("@payloadcms/") && !n.includes("eslint")),
    // Payload checks every copy in the tree at startup.
    wholeTree: true,
  },
  {
    name: "Next.js",
    leader: "next",
    // Lint packages do not end up in the build.
    member: (n: string) =>
      n === "next" || (n.startsWith("@next/") && !n.includes("eslint")),
    // Old @next/env copies under helpers (next-sitemap …) are harmless:
    // only what the app declares has to match.
    wholeTree: false,
  },
  {
    name: "React",
    leader: "react",
    member: (n: string) => n === "react" || n === "react-dom",
    wholeTree: true,
  },
  {
    name: "Lexical",
    leader: "lexical",
    member: (n: string) => n === "lexical" || n.startsWith("@lexical/"),
    wholeTree: true,
  },
] as const;

export type Family = (typeof FAMILIES)[number];

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version?: string;
};

const SPEC = /^([~^]|>=)?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

export function familyOf(name: string): Family | null {
  return FAMILIES.find((f) => f.member(name)) ?? null;
}

/**
 * Move one family — leader and every member — to an exact release, keeping
 * each one's range style. The bulk upgrade ("every Payload site to 3.x").
 * Returns what changed; empty when the family is not used or already there.
 */
export function pinFamily(
  pkg: PkgJson,
  familyName: Family["name"],
  version: string
): string[] {
  const f = FAMILIES.find((x) => x.name === familyName);
  if (!f) return [];
  const all = { ...pkg.devDependencies, ...pkg.dependencies };
  if (!all[f.leader]) return [];
  const changes: string[] = [];
  for (const section of [pkg.dependencies, pkg.devDependencies]) {
    if (!section) continue;
    for (const [name, spec] of Object.entries(section)) {
      if (!f.member(name)) continue;
      const m = SPEC.exec(spec);
      if (!m || m[2] === version) continue;
      const next = `${m[1] ?? ""}${version}`;
      section[name] = next;
      changes.push(`${name}: ${spec} → ${next}`);
    }
  }
  return changes;
}

/**
 * Bring every declared family member to the leader's version, keeping each
 * one's own range style (^, ~ or exact). `npm-check-updates` and single
 * package fixes move one package; this moves its siblings with it.
 * Returns what changed, as "name: old → new".
 */
export function alignDeclared(pkg: PkgJson): string[] {
  const changes: string[] = [];
  const all = { ...pkg.devDependencies, ...pkg.dependencies };
  for (const f of FAMILIES) {
    const lead = SPEC.exec(all[f.leader] ?? "");
    if (!lead) continue;
    const version = lead[2]!;
    for (const section of [pkg.dependencies, pkg.devDependencies]) {
      if (!section) continue;
      for (const [name, spec] of Object.entries(section)) {
        if (name === f.leader || !f.member(name)) continue;
        const m = SPEC.exec(spec);
        if (!m || m[2] === version) continue;
        const next = `${m[1] ?? ""}${version}`;
        section[name] = next;
        changes.push(`${name}: ${spec} → ${next}`);
      }
    }
  }
  return changes;
}

function readPkg(dir: string): PkgJson | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8")
    ) as PkgJson;
  } catch {
    return null;
  }
}

/** Node's lookup: `name` as seen from inside `fromDir` (pnpm layout too). */
function resolveFrom(fromDir: string, name: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      try {
        return fs.realpathSync(candidate);
      } catch {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * After the install: do all members of each family resolve to one version,
 * for the app and for every direct dependency? Catches a sibling left
 * behind as well as a second copy pulled in by a plugin.
 */
export function checkInstalled(projectDir: string): {
  ok: boolean;
  problems: string[];
  /** Families found in the app, e.g. ["Payload 3.58.0", "Next.js 15.5.4"]. */
  checked: string[];
} {
  const pkg = readPkg(projectDir);
  if (!pkg) return { ok: true, problems: [], checked: [] };
  const direct = Object.keys({ ...pkg.devDependencies, ...pkg.dependencies });
  const leaders = new Map<string, string>();
  for (const f of FAMILIES) {
    const dir = resolveFrom(projectDir, f.leader);
    const v = dir ? readPkg(dir)?.version : undefined;
    if (v && direct.includes(f.leader)) leaders.set(f.name, v);
  }
  const checked = [...leaders].map(([f, v]) => `${f} ${v}`);
  if (!leaders.size) return { ok: true, problems: [], checked };

  const problems = new Set<string>();
  for (const name of direct) {
    const dir = resolveFrom(projectDir, name);
    if (!dir) continue;
    const own = readPkg(dir);
    const fam = familyOf(name);
    const lead = fam && leaders.get(fam.name);
    if (lead && own?.version && own.version !== lead && name !== fam.leader) {
      problems.add(
        `${name} ${own.version} — ${fam.leader} is ${lead}; ${fam.name} packages must be the same version`
      );
    }
    // What this package itself pulls in from a family. Runtime dependencies
    // only: a dev tool with its own React does not end up in the build.
    if (!pkg.dependencies?.[name]) continue;
    const wants = Object.keys({
      ...own?.dependencies,
      ...own?.peerDependencies,
    });
    for (const dep of wants) {
      const f = familyOf(dep);
      const want = f && leaders.get(f.name);
      if (!want) continue;
      const depDir = resolveFrom(dir, dep);
      const v = depDir ? readPkg(depDir)?.version : undefined;
      if (v && v !== want) {
        problems.add(
          `${name} uses ${dep} ${v}, the app has ${f.leader} ${want} — two ${f.name} versions in one build`
        );
      }
    }
  }
  return { ok: problems.size === 0, problems: [...problems], checked };
}

/**
 * The same check from the lockfile alone — no install needed. Every family
 * member pinned anywhere in the tree must be at the leader's one version;
 * two versions of the leader itself are the same problem.
 */
export type Misaligned = {
  family: Family;
  name: string;
  version: string;
  /** The leader's version — what this package has to be. */
  target: string;
};

/** Family members locked at a different version than their leader. */
export function misaligned(
  packages: Array<{ name: string; version: string }>,
  declared: string[]
): { leaders: Map<Family, string[]>; off: Misaligned[] } {
  const leaders = new Map<Family, string[]>();
  const off: Misaligned[] = [];
  for (const f of FAMILIES) {
    if (!declared.includes(f.leader)) continue;
    const versions = [
      ...new Set(
        packages.filter((p) => p.name === f.leader).map((p) => p.version)
      ),
    ].sort(semver.rcompare);
    if (!versions.length) continue;
    leaders.set(f, versions);
    const target = versions[0]!;
    for (const p of packages) {
      if (p.name === f.leader || !f.member(p.name) || p.version === target)
        continue;
      if (!f.wholeTree && !declared.includes(p.name)) continue;
      off.push({ family: f, name: p.name, version: p.version, target });
    }
  }
  return { leaders, off };
}

/**
 * The same check from the lockfile alone — no install needed. Family
 * members must be at the leader's one version (for Payload, React and
 * Lexical every copy in the tree; for Next.js what the app declares); two
 * versions of the leader itself are the same problem.
 */
export function checkLocked(
  packages: Array<{ name: string; version: string }>,
  declared: string[]
): ReturnType<typeof checkInstalled> {
  const { leaders, off } = misaligned(packages, declared);
  const problems: string[] = [];
  const checked: string[] = [];
  for (const [f, versions] of leaders) {
    checked.push(`${f.name} ${versions[0]}`);
    if (versions.length > 1 && f.wholeTree)
      problems.push(
        `${f.leader} is locked at ${versions.join(" and ")} — two ${f.name} versions in one build`
      );
  }
  for (const m of off)
    problems.push(
      `${m.name} ${m.version} — ${m.family.leader} is ${m.target}; ${m.family.name} packages must be the same version`
    );
  return {
    ok: problems.length === 0,
    problems: [...new Set(problems)],
    checked,
  };
}

/** Log section and PR line for a version check. */
export function describeCheck(r: ReturnType<typeof checkInstalled>): {
  log: string;
  line: string | null;
} {
  if (!r.checked.length)
    return {
      log: "[versions]\nno Payload, Next.js, React or Lexical — nothing to match",
      line: null,
    };
  return r.ok
    ? {
        log: `[versions]\nmatching: ${r.checked.join(", ")}`,
        line: `- Versions: ✅ ${r.checked.join(", ")} — all packages match`,
      }
    : {
        log: `[versions]\nMISMATCH — this breaks the build/deploy:\n${r.problems.map((p) => `  ${p}`).join("\n")}`,
        line: `- Versions: ❌ ${r.problems.length} mismatch${r.problems.length === 1 ? "" : "es"} — ${r.problems[0]}`,
      };
}
