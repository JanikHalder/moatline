import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, repositories, serverScanRuns, servers } from "db";
import { run } from "../lib/run";
import { validateLiveUrl } from "../lib/live-check";
import { resolveAddress, type NetworkState } from "./network-check";
import {
  normalizeSeverity,
  syncAndNotify,
  type FindingInput,
} from "../lib/server-findings";

const NUCLEI_BIN = process.env.NUCLEI_BIN || "nuclei";
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_TARGETS = 50;

/**
 * Template classes that are never run against our own production:
 *
 * - dos / fuzz / intrusive / brute-force tags: they can take a service down,
 *   lock accounts or write data. This is monitoring, not a pentest.
 * - `code`, `file`, `headless`, `javascript` protocols: they execute code or
 *   a browser on *this* host, or touch the local filesystem. The API process
 *   holds the organization secrets; it does not run third-party scripts.
 */
const EXCLUDED_TAGS = [
  "dos",
  "fuzz",
  "fuzzing",
  "intrusive",
  "brute-force",
  "bruteforce",
  "default-login",
];
const EXCLUDED_TYPES = ["code", "file", "headless", "javascript"];

/**
 * Arguments for one run. Exported for tests: these flags *are* the safety
 * policy, so they deserve to be pinned down.
 */
export function nucleiArgs(opts: {
  targetsFile: string;
  outputFile: string;
  allowLocalNetwork: boolean;
  interactsh: boolean;
}): string[] {
  const args = [
    "-l",
    opts.targetsFile,
    "-jsonl",
    "-o",
    opts.outputFile,
    // Request/response pairs can contain cookies or tokens from the scanned
    // app; the finding itself is enough.
    "-omit-raw",
    "-omit-template",
    "-silent",
    "-no-color",
    "-disable-update-check",
    "-severity",
    "low,medium,high,critical",
    "-exclude-tags",
    EXCLUDED_TAGS.join(","),
    "-exclude-type",
    EXCLUDED_TYPES.join(","),
    // Gentle on our own servers: a monitoring scan must never be the reason a
    // site is slow.
    "-rate-limit",
    "30",
    "-concurrency",
    "10",
    "-bulk-size",
    "10",
    "-timeout",
    "10",
    "-retries",
    "1",
    "-max-host-error",
    "30",
    // Progress as JSON lines on stderr, so the UI can show more than
    // "running" for the quarter of an hour a scan takes.
    "-stats",
    "-stats-json",
    "-stats-interval",
    "15",
  ];
  // Out-of-band checks report to a third-party interaction server
  // (oast.fun etc.), which then learns which hosts we scan. Off unless asked.
  if (!opts.interactsh) args.push("-no-interactsh");
  // Redirects and DNS can point a public hostname at an internal address.
  // Unless internal targets are explicitly allowed, nuclei itself refuses
  // to connect there — the URL check alone only sees the hostname.
  if (!opts.allowLocalNetwork) args.push("-restrict-local-network-access");
  return args;
}

function allowLocalNetwork(): boolean {
  return (
    process.env.ALLOW_PRIVATE_LIVE_URLS === "true" ||
    process.env.ALLOW_TAILNET_LIVE_URLS === "true"
  );
}

type NucleiResult = {
  "template-id"?: string;
  "matcher-name"?: string;
  "matched-at"?: string;
  host?: string;
  info?: {
    name?: string;
    severity?: string;
    description?: string;
    reference?: string[] | string | null;
    remediation?: string;
  };
  "extracted-results"?: string[];
};

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
}

export type NucleiProgress = {
  percent: number;
  requests: number;
  total: number;
  rps: number;
  matched: number;
  errors: number;
  duration: string;
  updatedAt: string;
};

/** One `-stats-json` line, or null for anything else. */
export function parseNucleiStats(line: string): NucleiProgress | null {
  const t = line.trim();
  if (!t.startsWith("{") || !t.includes('"percent"')) return null;
  try {
    const o = JSON.parse(t) as Record<string, string>;
    const n = (k: string) => (Number.isFinite(Number(o[k])) ? Number(o[k]) : 0);
    return {
      percent: Math.min(100, n("percent")),
      requests: n("requests"),
      total: n("total"),
      rps: n("rps"),
      matched: n("matched"),
      errors: n("errors"),
      duration: o.duration ?? "",
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Parse nuclei's JSONL output into findings. Unparseable lines are skipped. */
export function parseNucleiOutput(
  jsonl: string,
  repoByHost: Map<string, string> = new Map()
): FindingInput[] {
  const out: FindingInput[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let r: NucleiResult;
    try {
      r = JSON.parse(trimmed) as NucleiResult;
    } catch {
      continue;
    }
    const templateId = r["template-id"];
    if (!templateId) continue;
    const matchedAt = r["matched-at"] ?? r.host ?? "";
    const refs = r.info?.reference;
    const reference = Array.isArray(refs) ? refs[0] : (refs ?? null);
    const extracted = r["extracted-results"]?.slice(0, 5).join(", ");
    const host = hostOf(matchedAt) ?? hostOf(r.host);
    out.push({
      fingerprint: [templateId, r["matcher-name"] ?? "", matchedAt].join("|"),
      severity: normalizeSeverity(r.info?.severity),
      title: r.info?.name ?? templateId,
      detail:
        [
          r.info?.description,
          extracted ? `Extracted: ${extracted}` : null,
          r.info?.remediation ? `Remediation: ${r.info.remediation}` : null,
          `Template: ${templateId}${r["matcher-name"] ? ` (${r["matcher-name"]})` : ""}`,
        ]
          .filter(Boolean)
          .join("\n") || null,
      target: matchedAt || null,
      reference,
      repositoryId: host ? (repoByHost.get(host) ?? null) : null,
    });
  }
  return out;
}

/**
 * What a server's Nuclei scan covers: the live URLs of the applications on it
 * (that is what the outside world reaches) plus any extra targets configured
 * on the server. Each target passes the same SSRF check as live URLs.
 */
export async function resolveNucleiTargets(serverId: string): Promise<{
  targets: string[];
  rejected: Array<{ target: string; reason: string }>;
  repoByHost: Map<string, string>;
}> {
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);
  if (!server) return { targets: [], rejected: [], repoByHost: new Map() };
  const repos = await db
    .select({ id: repositories.id, liveUrl: repositories.liveUrl })
    .from(repositories)
    .where(
      and(eq(repositories.serverId, serverId), isNotNull(repositories.liveUrl))
    );

  const repoByHost = new Map<string, string>();
  const candidates: string[] = [];
  for (const r of repos) {
    if (!r.liveUrl) continue;
    try {
      const u = new URL(r.liveUrl);
      candidates.push(u.origin);
      repoByHost.set(u.hostname, r.id);
    } catch {
      // Invalid URLs were refused when they were saved; nothing to scan.
    }
  }
  candidates.push(...(server.nucleiTargets ?? []));

  const targets: string[] = [];
  const rejected: Array<{ target: string; reason: string }> = [];
  for (const t of [...new Set(candidates.map((c) => c.trim()))]) {
    if (!t) continue;
    const valid = validateLiveUrl(t);
    if (valid.ok) targets.push(t);
    else rejected.push({ target: t, reason: valid.reason });
  }

  // The server's own address: every port the external check found open, as
  // host:port, so network and TLS templates run against the services
  // themselves and not only against the websites in front of them.
  if (server.address) {
    const resolved = await resolveAddress(server.address);
    if (!resolved.ok) {
      rejected.push({ target: server.address, reason: resolved.reason });
    } else {
      const state = server.networkState as NetworkState | null;
      const host = server.address.includes(":")
        ? `[${server.address}]`
        : server.address;
      const open = state?.ports.filter((p) => p.open).map((p) => p.port) ?? [];
      for (const port of open.length ? open : [80, 443]) {
        targets.push(`${host}:${port}`);
      }
    }
  }
  return {
    targets: [...new Set(targets)].slice(0, MAX_TARGETS),
    rejected,
    repoByHost,
  };
}

// Nuclei is heavy (hundreds of templates × targets). One run at a time per
// API process; further runs queue up behind it.
let queue: Promise<unknown> = Promise.resolve();

/** Create a run row and queue it. Returns the run id. */
export async function startNucleiRun(serverId: string): Promise<string> {
  const [active] = await db
    .select({ id: serverScanRuns.id })
    .from(serverScanRuns)
    .where(
      and(
        eq(serverScanRuns.serverId, serverId),
        inArray(serverScanRuns.status, ["pending", "running"])
      )
    )
    .limit(1);
  if (active) return active.id;
  const [row] = await db
    .insert(serverScanRuns)
    .values({ serverId, tool: "nuclei", status: "pending" })
    .returning({ id: serverScanRuns.id });
  const runId = row!.id;
  queue = queue
    .then(() => executeNucleiRun(runId))
    .catch((e) => console.error("[nuclei] run failed:", e));
  return runId;
}

async function finish(
  runId: string,
  patch: Partial<typeof serverScanRuns.$inferInsert>
): Promise<void> {
  await db
    .update(serverScanRuns)
    .set({ finishedAt: new Date(), ...patch })
    .where(eq(serverScanRuns.id, runId));
}

let templatesCheckedAt = 0;

/** Keep templates current, at most once a day. New CVE templates land daily. */
async function updateTemplates(log: string[]): Promise<void> {
  if (Date.now() - templatesCheckedAt < 24 * 60 * 60 * 1000) return;
  templatesCheckedAt = Date.now();
  const res = await run(NUCLEI_BIN, ["-update-templates", "-silent"], {
    cwd: os.tmpdir(),
    timeout: 5 * 60 * 1000,
    scrubSecrets: true,
  });
  if (!res.ok) {
    log.push(
      `[templates] update failed, using the installed templates: ${res.stderr.slice(0, 500)}`
    );
  }
}

export async function executeNucleiRun(runId: string): Promise<void> {
  const [runRow] = await db
    .select()
    .from(serverScanRuns)
    .where(eq(serverScanRuns.id, runId))
    .limit(1);
  if (!runRow) return;
  const log: string[] = [];
  const { targets, rejected, repoByHost } = await resolveNucleiTargets(
    runRow.serverId
  );
  for (const r of rejected) log.push(`[skipped] ${r.target}: ${r.reason}`);
  if (targets.length === 0) {
    await finish(runId, {
      status: "failed",
      targets: [],
      errorMessage:
        "Nothing to scan: link an application with a live URL to this server, or add a target.",
      log: log.join("\n") || null,
    });
    return;
  }

  await db
    .update(serverScanRuns)
    .set({ status: "running", targets, startedAt: new Date() })
    .where(eq(serverScanRuns.id, runId));

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pc-nuclei-"));
  try {
    await updateTemplates(log);
    const targetsFile = path.join(dir, "targets.txt");
    const outputFile = path.join(dir, "results.jsonl");
    await fs.writeFile(targetsFile, targets.join("\n") + "\n", { mode: 0o600 });
    let pending = "";
    let lastWrite = 0;
    const onOutput = (chunk: string, stream: "stdout" | "stderr") => {
      if (stream !== "stderr") return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const progress = parseNucleiStats(line);
        if (!progress || Date.now() - lastWrite < 10_000) continue;
        lastWrite = Date.now();
        void db
          .update(serverScanRuns)
          .set({ progress })
          .where(eq(serverScanRuns.id, runId))
          .catch(() => {});
      }
    };
    const res = await run(
      NUCLEI_BIN,
      nucleiArgs({
        targetsFile,
        outputFile,
        allowLocalNetwork: allowLocalNetwork(),
        interactsh: process.env.NUCLEI_INTERACTSH === "true",
      }),
      {
        cwd: dir,
        timeout: RUN_TIMEOUT_MS,
        // Nuclei needs no credentials of ours; keep them out of its reach.
        scrubSecrets: true,
        maxBuffer: 2 * 1024 * 1024,
        onOutput,
      }
    );
    const output = await fs.readFile(outputFile, "utf8").catch(() => "");
    // Stats lines are progress, not log.
    const stderr = res.stderr
      .split("\n")
      .filter((l) => !parseNucleiStats(l))
      .join("\n")
      .trim();
    if (stderr) log.push(stderr.slice(-4000));
    if (!res.ok) {
      // A failed run proves nothing about what is fixed — leave the previous
      // findings open instead of resolving them all.
      await finish(runId, {
        status: "failed",
        errorMessage: res.timedOut
          ? "Nuclei did not finish within 45 minutes."
          : `nuclei exited with ${res.status ?? "an error"}${res.stderr.includes("not found on PATH") ? " – is nuclei installed on the API host?" : ""}`,
        log: log.join("\n").slice(-20000) || null,
      });
      return;
    }
    const findings = parseNucleiOutput(output, repoByHost);
    await syncAndNotify(runRow.serverId, "nuclei", findings);
    await finish(runId, {
      status: "success",
      progress: null,
      findingCount: findings.length,
      log: log.join("\n").slice(-20000) || null,
    });
  } catch (e) {
    await finish(runId, {
      status: "failed",
      errorMessage: e instanceof Error ? e.message : String(e),
      log: log.join("\n").slice(-20000) || null,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Last run per server, for list views. */
export async function latestNucleiRun(serverId: string) {
  const [row] = await db
    .select()
    .from(serverScanRuns)
    .where(eq(serverScanRuns.serverId, serverId))
    .orderBy(desc(serverScanRuns.startedAt))
    .limit(1);
  return row ?? null;
}
