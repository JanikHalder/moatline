import { dockerApi, hasDockerSocket } from "../lib/docker-engine";
import { isOlderVersion } from "../lib/version";

/**
 * Updates for self-hosted instances, the way Dokploy does it: the instance
 * knows its version, asks GitHub for the newest release, and — when the
 * Docker socket is mounted and SELF_UPDATE=true — pulls the new images and
 * recreates its compose project with one click. Mounting the socket gives
 * root on the host; that is why it is opt-in.
 */

/** Set at image build (APP_VERSION build argument); "dev" otherwise. */
export const currentVersion = () => process.env.APP_VERSION?.trim() || "dev";

const REPO = () => process.env.UPDATE_REPO?.trim() || "JanikHalder/moatline";
const TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; release: Release | null } | null = null;

export type Release = {
  version: string;
  url: string;
  notes: string;
  publishedAt: string | null;
};

/** The newest GitHub release, cached for six hours. null: none, or private. */
export async function latestRelease(): Promise<Release | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.release;
  let release: Release | null = null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO()}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (res.ok) {
      const r = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
        published_at?: string;
      };
      const version = r.tag_name?.replace(/^v/, "");
      if (version && /^\d+\.\d+\.\d+/.test(version))
        release = {
          version,
          url: r.html_url ?? `https://github.com/${REPO()}/releases`,
          notes: (r.body ?? "").slice(0, 4000),
          publishedAt: r.published_at ?? null,
        };
    }
  } catch {
    release = null;
  }
  cache = { at: Date.now(), release };
  return release;
}

export type InstallMode =
  /** Plain docker compose with the socket and SELF_UPDATE=true: a button. */
  | "button"
  /** Plain docker compose, no socket: a command to run. */
  | "compose"
  /** Installed as a Dokploy or Coolify template: update there. */
  | "dokploy"
  | "coolify"
  | "unknown";

type Self = {
  mode: InstallMode;
  project: string | null;
  workingDir: string | null;
  /** Why one-click updates are not available although asked for. */
  hint?: "no-socket-permission" | "self-update-off" | null;
};

/** How this instance was installed — read from its own container's labels. */
export async function installMode(): Promise<Self> {
  if (!hasDockerSocket())
    return {
      mode: process.env.HOSTNAME ? "compose" : "unknown",
      project: null,
      workingDir: null,
    };
  try {
    const self = await dockerApi<{
      Config?: { Labels?: Record<string, string> };
    }>(
      "GET",
      `/containers/${encodeURIComponent(process.env.HOSTNAME ?? "")}/json`,
      undefined,
      10_000
    );
    const labels = self.data?.Config?.Labels ?? {};
    const project = labels["com.docker.compose.project"] ?? null;
    const workingDir = labels["com.docker.compose.project.working_dir"] ?? null;
    if (labels["coolify.managed"] === "true")
      return { mode: "coolify", project, workingDir };
    if (workingDir?.startsWith("/etc/dokploy"))
      return { mode: "dokploy", project, workingDir };
    if (!project || !workingDir)
      return { mode: "unknown", project, workingDir };
    const on = process.env.SELF_UPDATE === "true";
    return {
      mode: on ? "button" : "compose",
      project,
      workingDir,
      hint: on ? null : "self-update-off",
    };
  } catch (e) {
    // The socket is there but this (non-root) user may not use it.
    const denied = (e as NodeJS.ErrnoException)?.code === "EACCES";
    return {
      mode: denied ? "compose" : "unknown",
      project: null,
      workingDir: null,
      hint: denied ? "no-socket-permission" : null,
    };
  }
}

export type UpdateStatus = {
  current: string;
  latest: Release | null;
  available: boolean;
  mode: InstallMode;
  hint: Self["hint"];
};

export async function updateStatus(): Promise<UpdateStatus> {
  const [latest, self] = await Promise.all([latestRelease(), installMode()]);
  const current = currentVersion();
  return {
    current,
    latest,
    // Images from main carry "main", development "dev": only releases compare.
    available:
      !!latest &&
      /^\d+\.\d+\.\d+/.test(current) &&
      isOlderVersion(current, latest.version),
    mode: self.mode,
    hint: self.hint ?? null,
  };
}

/**
 * The shell the helper container runs. The new images are pulled first and
 * the version is written to .env only after that worked — a failed pull
 * must not leave .env pointing at images that do not exist. Everything is
 * logged to .pc-update.log next to the compose file.
 */
export function updateScript(
  project: string,
  workingDir: string,
  version: string
): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    `cd ${q(workingDir)}`,
    `exec >> .pc-update.log 2>&1`,
    `echo "== $(date -u) update to ${version}"`,
    `PC_VERSION=${version} docker compose -p ${q(project)} pull`,
    `touch .env`,
    `if grep -q '^PC_VERSION=' .env; then sed -i 's/^PC_VERSION=.*/PC_VERSION=${version}/' .env; else echo 'PC_VERSION=${version}' >> .env; fi`,
    `docker compose -p ${q(project)} up -d`,
    `echo "== done"`,
  ].join(" && ");
}

/**
 * Start the update: a short-lived docker:cli container does it, because
 * this container is about to be replaced and cannot finish the job itself.
 */
export async function startUpdate(): Promise<
  { ok: true; version: string } | { ok: false; error: string }
> {
  const status = await updateStatus();
  if (!status.available || !status.latest)
    return { ok: false, error: "No newer release." };
  const self = await installMode();
  if (self.mode !== "button" || !self.project || !self.workingDir)
    return {
      ok: false,
      error:
        "One-click updates need the Docker socket mounted and SELF_UPDATE=true.",
    };
  const version = status.latest.version;
  if (!/^\d+\.\d+\.\d+[\w.-]*$/.test(version))
    return { ok: false, error: "Unexpected version." };
  const image = "docker:27-cli";
  const pull = await dockerApi(
    "POST",
    `/images/create?fromImage=docker&tag=27-cli`
  );
  if (pull.status >= 400)
    return {
      ok: false,
      error: `Could not pull ${image}: ${pull.text.slice(0, 200)}`,
    };
  const created = await dockerApi<{ Id?: string }>(
    "POST",
    `/containers/create?name=moatline-updater-${Date.now()}`,
    {
      Image: image,
      Cmd: ["sh", "-c", updateScript(self.project, self.workingDir, version)],
      HostConfig: {
        AutoRemove: true,
        Binds: [
          "/var/run/docker.sock:/var/run/docker.sock",
          `${self.workingDir}:${self.workingDir}`,
        ],
      },
    }
  );
  if (!created.data?.Id)
    return {
      ok: false,
      error: `Could not create the updater: ${created.text.slice(0, 200)}`,
    };
  const started = await dockerApi(
    "POST",
    `/containers/${created.data.Id}/start`
  );
  if (started.status >= 400)
    return {
      ok: false,
      error: `Could not start the updater: ${started.text.slice(0, 200)}`,
    };
  return { ok: true, version };
}
