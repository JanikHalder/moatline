import fs from "node:fs";
import os from "node:os";

/**
 * Security fixes and update runs install, build and test customer repos —
 * a `next build` alone takes gigabytes and every core. They run one at a
 * time (HEAVY_JOB_CONCURRENCY), queued in order, so a scheduled scan of
 * many repos cannot start ten builds at once.
 */
const limit = Math.max(1, Number(process.env.HEAVY_JOB_CONCURRENCY) || 1);
let active = 0;
/** Longer than any install + build may take (their own timeouts are 5 min each). */
const MAX_HOLD_MS =
  Math.max(1, Number(process.env.HEAVY_JOB_MAX_MINUTES) || 40) * 60 * 1000;
const waiting: Array<() => void> = [];

export function heavyJobsWaiting(): number {
  return waiting.length;
}

export async function withHeavySlot<T>(
  job: () => Promise<T>,
  onQueued?: (ahead: number) => void | Promise<void>
): Promise<T> {
  if (active < limit) {
    active++;
  } else {
    // The finishing job hands its slot straight over.
    const turn = new Promise<void>((resolve) => waiting.push(resolve));
    await onQueued?.(waiting.length);
    await turn;
  }
  // A job that never settles must not hold the slot forever — everything
  // queued behind it would wait with it. After the cap the slot moves on;
  // the stuck job keeps running and is reported.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  const cap = setTimeout(() => {
    console.error(
      `[heavy-jobs] a job held the build slot for ${Math.round(MAX_HOLD_MS / 60000)} min — releasing it`
    );
    release();
  }, MAX_HOLD_MS);
  cap.unref();
  try {
    return await job();
  } finally {
    clearTimeout(cap);
    release();
  }
}

function readNumber(path: string): number | null {
  try {
    const v = fs.readFileSync(path, "utf8").trim();
    return /^\d+$/.test(v) ? Number(v) : null;
  } catch {
    return null;
  }
}

/**
 * Memory this process may still use: the container's cgroup limit when it
 * has one (Dokploy resource limits), else what the host has available.
 */
export function availableMemoryMb(): number {
  const max = readNumber("/sys/fs/cgroup/memory.max");
  const current = readNumber("/sys/fs/cgroup/memory.current");
  const host = os.freemem() / 1024 / 1024;
  if (max != null && current != null) {
    return Math.min(host, (max - current) / 1024 / 1024);
  }
  return host;
}
