import { db, servers } from "db";
import {
  hubInfo,
  judgeImage,
  parseImageRef,
  type ImageVerdict,
} from "../lib/registry";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";

const INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastRun = 0;

type Container = {
  name?: string | null;
  image?: string | null;
  imageCreated?: string | null;
  imageDigest?: string | null;
};
type Report = {
  containers?: Container[] | null;
  trivy?: {
    targets?: Array<{
      kind?: string;
      target?: string;
      severities?: Record<string, number> | null;
    }>;
  } | null;
};

export type ImageStatus = {
  image: string;
  containers: string[];
  created: string | null;
  verdict: ImageVerdict;
};

/** Every image a server runs, judged against Docker Hub. */
export async function imageStatuses(
  lastReport: unknown
): Promise<ImageStatus[]> {
  const report = (lastReport ?? {}) as Report;
  const byImage = new Map<string, { containers: string[]; c: Container }>();
  for (const c of report.containers ?? []) {
    if (!c.image) continue;
    const e = byImage.get(c.image) ?? { containers: [], c };
    e.containers.push(c.name ?? c.image);
    byImage.set(c.image, e);
  }
  const out: ImageStatus[] = [];
  for (const [image, { containers, c }] of byImage) {
    const ref = parseImageRef(image);
    const info = ref ? await hubInfo(ref) : null;
    out.push({
      image,
      containers,
      created: c.imageCreated ?? null,
      verdict: judgeImage(
        { digest: c.imageDigest ?? null, created: c.imageCreated ?? null },
        info
      ),
    });
  }
  return out;
}

/** Image CVEs by severity, from the last Trivy scan. */
function cvesOf(report: Report, image: string): Record<string, number> {
  const t = report.trivy?.targets?.find(
    (x) => x.kind === "image" && x.target === image
  );
  return t?.severities ?? {};
}

export function imageFindings(
  statuses: ImageStatus[],
  report: Report
): FindingInput[] {
  const out: FindingInput[] = [];
  for (const s of statuses) {
    const cves = cvesOf(report, s.image);
    const serious = (cves.critical ?? 0) + (cves.high ?? 0);
    const used = s.containers.slice(0, 3).join(", ");
    const cveNote = serious
      ? ` Its ${serious} critical/high vulnerabilities stay until it is replaced.`
      : "";
    if (s.verdict.status === "unmaintained") {
      out.push({
        fingerprint: `image-unmaintained|${s.image}`,
        severity: (cves.critical ?? 0) > 0 ? "high" : "medium",
        title: `Image no longer maintained: ${s.image}`,
        detail: `No new image in this Docker Hub repository since ${s.verdict.since.slice(0, 10)}. A restart or redeploy runs the same old build again.${cveNote} Replace it with a maintained image, or drop the service. Used by ${used}.`,
        target: s.image,
      });
    } else if (s.verdict.status === "outdated") {
      out.push({
        fingerprint: `image-outdated|${s.image}`,
        severity: serious ? "medium" : "low",
        title: `Newer build available: ${s.image}`,
        detail: `The tag was pushed again${s.verdict.tagUpdated ? ` on ${s.verdict.tagUpdated.slice(0, 10)}` : ""}, after the running image was built. Pull it and recreate the container (docker pull ${s.image}, then redeploy) to get the fixes. Used by ${used}.`,
        target: s.image,
      });
    }
  }
  return out;
}

/** Once a day: every server's images, as findings (source "registry"). */
export async function checkDueImages(): Promise<void> {
  if (Date.now() - lastRun < INTERVAL_MS) return;
  lastRun = Date.now();
  const rows = await db
    .select({ id: servers.id, lastReport: servers.lastReport })
    .from(servers);
  for (const row of rows) {
    if (!row.lastReport) continue;
    const statuses = await imageStatuses(row.lastReport);
    // Docker Hub not reachable for any image: keep what is open.
    if (
      statuses.length &&
      statuses.every((s) => s.verdict.status === "unknown")
    )
      continue;
    await syncAndNotify(
      row.id,
      "registry",
      imageFindings(statuses, row.lastReport as Report)
    );
  }
}
