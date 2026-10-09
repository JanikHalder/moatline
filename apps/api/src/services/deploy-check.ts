import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextStandaloneVerdict } from "../lib/next-standalone";
import { verdictNextStandalone } from "../lib/next-standalone";

export type DeployFinding = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** Relative path under docs/ — agent handoff includes this file. */
  howto: "next-standalone.md";
};

export type DeployCheck = {
  checkedAt: string;
  next: NextStandaloneVerdict;
  findings: DeployFinding[];
};

const HOWTO = "next-standalone.md";

/** Turn a standalone verdict into findings (empty when Next is fine). */
export function deployFindingsFromVerdict(
  v: NextStandaloneVerdict
): DeployFinding[] {
  const out: DeployFinding[] = [];
  if (v.missing) {
    out.push({
      id: "next:standalone",
      severity: "high",
      title: "Next.js is not built as standalone",
      detail:
        "Without `output: 'standalone'` Dokploy/Railpack images often stay 1.5–3 GB each and fill the host. Set standalone and start `node .next/standalone/server.js` (or copy it in a Dockerfile).",
      howto: HOWTO,
    });
  } else if (v.startMismatch) {
    out.push({
      id: "next:standalone-start",
      severity: "medium",
      title: "Standalone is set, but start still uses `next start`",
      detail:
        "`output: 'standalone'` is on, yet `package.json` start does not run `.next/standalone/server.js` and there is no Dockerfile COPY of standalone. Railpack will keep a large image — point start at the standalone server (or use a multi-stage Dockerfile).",
      howto: HOWTO,
    });
  }
  return out;
}

export function buildDeployCheck(
  pkg: Parameters<typeof verdictNextStandalone>[0]["pkg"],
  nextConfig: string | null,
  dockerfile: string | null,
  now = new Date()
): DeployCheck {
  const next = verdictNextStandalone({ pkg, nextConfig, dockerfile });
  return {
    checkedAt: now.toISOString(),
    next,
    findings: deployFindingsFromVerdict(next),
  };
}

/** Markdown howto shipped with findings.md for coding agents. */
export function readStandaloneHowto(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../../docs/next-standalone.md"),
    path.resolve(here, "../../../docs/next-standalone.md"),
    path.resolve(process.cwd(), "docs/next-standalone.md"),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  return [
    "# Fix: Next.js standalone",
    "",
    "Set `output: 'standalone'` in next.config and start with",
    "`node .next/standalone/server.js` (Railpack) or copy `.next/standalone`",
    "in a multi-stage Dockerfile. See Moatline docs/next-standalone.md.",
  ].join("\n");
}
