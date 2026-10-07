import { spawn } from "node:child_process";
import fs from "node:fs";
import { untrustedRepoEnv } from "./cloud";

export type RunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  /** True when the command was killed for exceeding its timeout. */
  timedOut: boolean;
};

/**
 * Env var names that must never leak into child processes running untrusted
 * repo code (npm install / build / audit fix execute arbitrary lifecycle
 * scripts from the target repo). Matched case-insensitively by substring.
 */
const SECRET_ENV_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|_KEY$|^SECRETS_KEY$|DATABASE_URL|CONNECTION_STRING)/i;

/** A copy of `base` with secret-looking variables removed. */
export function scrubbedEnv(
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (SECRET_ENV_PATTERN.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Heap cap for repo builds, installs and tests (MB): BUILD_MEMORY_MB. */
export function buildMemoryMb(): number {
  return Math.max(512, Number(process.env.BUILD_MEMORY_MB) || 2048);
}

const IONICE = ["/usr/bin/ionice", "/bin/ionice"].find((p) => fs.existsSync(p));
const NICE = ["/usr/bin/nice", "/bin/nice"].find((p) => fs.existsSync(p));

/**
 * Untrusted repo code (install, build, tests) runs at the lowest CPU and
 * disk priority with a capped Node heap: a `next build` must never starve
 * the API, the database or the other apps on this server.
 */
export function lowPriority(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv
): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const cap = `--max-old-space-size=${buildMemoryMb()}`;
  const nodeOptions = env.NODE_OPTIONS?.includes("--max-old-space-size")
    ? env.NODE_OPTIONS
    : [env.NODE_OPTIONS, cap].filter(Boolean).join(" ");
  const nextEnv = {
    ...env,
    NODE_OPTIONS: nodeOptions,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (process.platform !== "linux") return { cmd, args, env: nextEnv };
  const prefix: string[] = [];
  if (IONICE) prefix.push(IONICE, "-c3");
  if (NICE) prefix.push(NICE, "-n", "15");
  if (!prefix.length) return { cmd, args, env: nextEnv };
  return {
    cmd: prefix[0]!,
    args: [...prefix.slice(1), cmd, ...args],
    env: nextEnv,
  };
}

export type RunOptions = {
  cwd: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  scrubSecrets?: boolean;
  maxBuffer?: number;
  /**
   * Called with each chunk as it arrives. Lets a long command (npm install,
   * build) report progress while it is still running.
   */
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
};

/**
 * Run a command and capture its output. Never throws, never rejects.
 *
 * Asynchronous on purpose: these commands take minutes (`npm install`,
 * `npm run build`), and a synchronous spawn would block the event loop for
 * their whole duration — the API would answer no request at all while a scan
 * or an update run is in progress, which is exactly when the UI is polling
 * for progress.
 *
 * Set `scrubSecrets: true` for any command that executes untrusted repo code
 * (npm install / npm run build / npm audit fix / npx). Git commands can keep
 * the full env — the push credential is embedded in the remote URL, not read
 * from the environment.
 */
/**
 * A repository's `packageManager: "pnpm@10.22.0"` makes pnpm download and
 * switch to that exact version first — which fails in a container without
 * that version ("Failed to switch pnpm to v10.22.0"). The installed pnpm
 * reads and writes the same lockfile; use it. Corepack likewise must not
 * refuse a mismatching manager.
 */
export const PACKAGE_MANAGER_ENV: NodeJS.ProcessEnv = {
  npm_config_manage_package_manager_versions: "false",
  pnpm_config_manage_package_manager_versions: "false",
  COREPACK_ENABLE_STRICT: "0",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
};

export function run(
  cmd: string,
  args: string[],
  opts: RunOptions
): Promise<RunResult> {
  const baseEnv = {
    ...(opts.scrubSecrets ? scrubbedEnv() : process.env),
    ...PACKAGE_MANAGER_ENV,
  };
  const maxBuffer = opts.maxBuffer ?? 20 * 1024 * 1024;
  const timeout = opts.timeout ?? 60_000;
  // scrubSecrets marks untrusted repo code — the heavy commands.
  // On the cloud the repository is a stranger's: its package-manager
  // configuration must not run code here (see lib/cloud) — last, so no
  // caller's env can undo it.
  const spec = opts.scrubSecrets
    ? lowPriority(cmd, args, {
        ...baseEnv,
        ...opts.env,
        ...untrustedRepoEnv(),
      })
    : { cmd, args, env: { ...baseEnv, ...opts.env } };

  return new Promise<RunResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.cmd, spec.args, {
        cwd: opts.cwd,
        env: spec.env,
        // Own process group, so a timeout ends the build's workers too —
        // killing only npm leaves `next build` workers eating memory.
        detached: process.platform !== "win32",
      });
    } catch (e) {
      resolve({
        ok: false,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        status: null,
        timedOut: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const collect = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      opts.onOutput?.(text, stream);
      if (stream === "stdout") {
        if (stdout.length < maxBuffer) stdout += text;
      } else if (stderr.length < maxBuffer) {
        stderr += text;
      }
    };
    child.stdout?.on("data", collect("stdout"));
    child.stderr?.on("data", collect("stderr"));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid && process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    }, timeout);

    const settle = (status: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let err = stderr.trim();
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const detail =
          code === "ENOENT" ? `${cmd} not found on PATH` : error.message;
        err = err ? `${err}\n${detail}` : detail;
      }
      if (timedOut) {
        const detail = `${cmd} timed out after ${timeout} ms`;
        err = err ? `${err}\n${detail}` : detail;
      }
      resolve({
        ok: status === 0 && !error && !timedOut,
        stdout: stdout.trim(),
        stderr: err,
        status,
        timedOut,
      });
    };

    child.on("error", (error) => settle(null, error));
    child.on("close", (code) => settle(code));
  });
}

export function appendLog(
  log: string[],
  label: string,
  stdout: string,
  stderr: string
): void {
  if (stdout) log.push(`[${label}]\n${stdout}`);
  if (stderr) log.push(`[${label} stderr]\n${stderr}`);
}
