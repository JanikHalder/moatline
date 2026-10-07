/**
 * Is an image still maintained? Asks Docker Hub — public data, no account —
 * when the repository last got any new image and what the tag points to now.
 * Other registries (ghcr.io, quay.io …) are not asked.
 */

export type ImageRef = { namespace: string; repo: string; tag: string };

/** "postgres:16" → library/postgres:16; null for other registries or digests. */
export function parseImageRef(image: string): ImageRef | null {
  if (!image || image.includes("@")) return null;
  let rest = image.trim();
  const first = rest.split("/")[0]!;
  const hasRegistry =
    rest.includes("/") &&
    (first.includes(".") || first.includes(":") || first === "localhost");
  if (hasRegistry) {
    if (first !== "docker.io" && first !== "registry-1.docker.io") return null;
    rest = rest.slice(first.length + 1);
  }
  const colon = rest.lastIndexOf(":");
  const name = colon > rest.lastIndexOf("/") ? rest.slice(0, colon) : rest;
  const tag = colon > rest.lastIndexOf("/") ? rest.slice(colon + 1) : "latest";
  const parts = name.split("/");
  if (parts.length > 2 || !parts.every((p) => /^[a-z0-9._-]+$/.test(p)))
    return null;
  const [namespace, repo] =
    parts.length === 1 ? ["library", parts[0]!] : [parts[0]!, parts[1]!];
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(tag)) return null;
  return { namespace, repo, tag };
}

export type HubInfo = {
  /** Newest push to any tag of the repository. */
  repoUpdated: string | null;
  /** Newest push to this tag, and the digest it points to now. */
  tagUpdated: string | null;
  tagDigest: string | null;
};

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; info: HubInfo | null }>();

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Docker Hub's view of an image, cached for a day. null: unknown there. */
export async function hubInfo(ref: ImageRef): Promise<HubInfo | null> {
  const key = `${ref.namespace}/${ref.repo}:${ref.tag}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;
  const base = `https://hub.docker.com/v2/repositories/${ref.namespace}/${ref.repo}`;
  const repo = await getJson(base);
  let info: HubInfo | null = null;
  if (repo) {
    const tag = await getJson(`${base}/tags/${encodeURIComponent(ref.tag)}`);
    info = {
      repoUpdated: str(repo.last_updated),
      tagUpdated: str(tag?.tag_last_pushed) ?? str(tag?.last_updated),
      tagDigest: str(tag?.digest),
    };
  }
  cache.set(key, { at: Date.now(), info });
  return info;
}

const DAY = 24 * 60 * 60 * 1000;
export const UNMAINTAINED_AFTER_DAYS = 365;

export type ImageVerdict =
  /** No new image in the whole repository for over a year. */
  | { status: "unmaintained"; since: string }
  /** The tag points to a newer build than the one running. */
  | { status: "outdated"; tagUpdated: string | null }
  | { status: "current" }
  | { status: "unknown" };

export function judgeImage(
  running: { digest: string | null; created: string | null },
  info: HubInfo | null,
  now = Date.now()
): ImageVerdict {
  if (!info) return { status: "unknown" };
  const repoAt = info.repoUpdated ? Date.parse(info.repoUpdated) : NaN;
  if (Number.isFinite(repoAt) && now - repoAt > UNMAINTAINED_AFTER_DAYS * DAY)
    return { status: "unmaintained", since: info.repoUpdated! };
  if (running.digest && info.tagDigest && running.digest !== info.tagDigest) {
    // A digest mismatch alone can be an arch-specific digest; only call it
    // outdated when the tag was pushed after this image was built.
    const built = running.created ? Date.parse(running.created) : NaN;
    const pushed = info.tagUpdated ? Date.parse(info.tagUpdated) : NaN;
    if (
      !Number.isFinite(built) ||
      !Number.isFinite(pushed) ||
      pushed > built + DAY
    )
      return { status: "outdated", tagUpdated: info.tagUpdated };
  }
  return running.digest ? { status: "current" } : { status: "unknown" };
}
