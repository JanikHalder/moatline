export type LiveCheckResult = {
  /** The URL answered like a running application (see `isLiveStatus`). */
  ok: boolean;
  httpStatus: number | null;
  /** Commit the target reports about itself, when it reports one at all. */
  commit: string | null;
  /** Its `checks` object (configuration self-report), when it has one. */
  checks?: LiveChecks | null;
  durationMs: number;
  error: string | null;
};

const DEFAULT_TIMEOUT_MS = 10_000;
/** Enough to reach a health payload; a full HTML page is not read to the end. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Keys a health endpoint might use for "which build is this". Checked in
 * order, top level only — guessing deeper would happily pick up a dependency
 * version and present it as the deployed commit.
 */
const COMMIT_KEYS = [
  "commit",
  "commitSha",
  "commit_sha",
  "sha",
  "gitCommit",
  "git_commit",
  "revision",
  "version",
] as const;

/**
 * A deploy that half-worked answers 502/503 through the proxy, while an app
 * that is up but rejects an anonymous request answers 401/403. Only the former
 * means "not live", so anything below 500 counts as up.
 */
export function isLiveStatus(status: number): boolean {
  return status > 0 && status < 500;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

/**
 * A Tailscale address: the `100.64.0.0/10` range Tailscale assigns, its
 * `fd7a:115c:a1e0::/48` IPv6 block, and MagicDNS names under `*.ts.net`.
 *
 * Kept apart from the general private-network case on purpose. A tailnet is
 * not the API host's local network — reaching it takes an explicit identity
 * (the API container must be a node on the tailnet) and the ACLs there decide
 * what it may touch. Treating it like a LAN address would be both too strict
 * for teams whose servers only exist on the tailnet, and too vague about what
 * is actually being allowed.
 */
export function isTailnetHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host.endsWith(".ts.net")) return true;
  if (host.startsWith("fd7a:115c:a1e0")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  // 100.64.0.0/10 – the second octet runs from 64 to 127.
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * Hosts that only exist from the server's point of view. Probing them would
 * turn this feature into a port scanner for anyone who can edit a repository,
 * and cloud metadata endpoints hand out credentials to whoever asks.
 *
 * Self-hosted setups that deploy onto the same private network need this, so
 * ALLOW_PRIVATE_LIVE_URLS=true lifts the restriction knowingly. The check is
 * on the literal hostname: a name that resolves to a private address still
 * gets through, which is why the flag exists rather than a promise of safety.
 */
function isPrivateHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  if (
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  )
    return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 is CGNAT space. It is not a LAN, and on a tailnet it is the
  // normal address of a server – handled by isTailnetHost, not here.
  return false;
}

export type UrlRejection = { ok: false; reason: string };
export type UrlAcceptance = { ok: true };

/**
 * Validates a URL a user typed into the live-URL field. Returns the reason
 * instead of a bare false, because "why not?" is the whole question when a
 * perfectly reasonable-looking address is refused.
 */
export function validateLiveUrl(url: string): UrlAcceptance | UrlRejection {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return {
      ok: false,
      reason: "Only http:// and https:// URLs can be checked.",
    };
  }
  if (!u.hostname) return { ok: false, reason: "The URL has no host." };
  if (isTailnetHost(u.hostname)) {
    if (
      process.env.ALLOW_TAILNET_LIVE_URLS === "true" ||
      process.env.ALLOW_PRIVATE_LIVE_URLS === "true"
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        "This is a Tailscale address. Set ALLOW_TAILNET_LIVE_URLS=true on the API — and make sure the API itself is a node on that tailnet, otherwise the check can only ever time out.",
    };
  }
  if (
    isPrivateHost(u.hostname) &&
    process.env.ALLOW_PRIVATE_LIVE_URLS !== "true"
  ) {
    return {
      ok: false,
      reason:
        "Private, loopback and link-local addresses are refused. Set ALLOW_PRIVATE_LIVE_URLS=true on the API to allow them.",
    };
  }
  return { ok: true };
}

/** What a health endpoint may report under `checks`: flags and times, never secrets. */
export type LiveChecks = Record<string, boolean | number | string | null>;

/**
 * The `checks` object of a health payload, e.g.
 * `{ "email": true, "storage": false, "lastMailOk": "2026-…" }`. Only short
 * keys and scalar values survive — anything else is not a check result and
 * must not end up in the database or the UI.
 */
export function extractChecks(
  body: string,
  contentType: string
): LiveChecks | null {
  if (!contentType.includes("json")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const raw = (parsed as { checks?: unknown } | null)?.checks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: LiveChecks = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(
    0,
    30
  )) {
    if (!/^[A-Za-z][\w.-]{0,40}$/.test(k)) continue;
    if (typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string" && v.length <= 100) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function extractCommit(body: string, contentType: string): string | null {
  if (!contentType.includes("json")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of COMMIT_KEYS) {
    const value = obj[key];
    // Long values are prose, not a build identifier – ignore them rather than
    // filling the UI with a paragraph.
    if (typeof value === "string" && value.trim() && value.length <= 64) {
      return value.trim();
    }
  }
  return null;
}

/**
 * GET the URL once and describe what came back. Never throws: a check that
 * fails is a result ("down"), not an error the caller has to handle.
 */
export async function checkLiveUrl(
  url: string,
  opts?: { timeoutMs?: number }
): Promise<LiveCheckResult> {
  const started = Date.now();
  const valid = validateLiveUrl(url);
  if (!valid.ok) {
    return {
      ok: false,
      httpStatus: null,
      commit: null,
      durationMs: 0,
      error: valid.reason,
    };
  }

  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/html;q=0.9, */*;q=0.8",
        "user-agent": "moatline/live-check",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    // A health payload is tiny. Anything huge is a page (or a target trying to
    // be one) and is not read at all — it still answered, which is the point.
    const declared = Number(res.headers.get("content-length") ?? "0");
    const body =
      declared > MAX_BODY_BYTES
        ? ""
        : (await res.text().catch(() => "")).slice(0, MAX_BODY_BYTES);
    const ok = isLiveStatus(res.status);
    return {
      ok,
      httpStatus: res.status,
      commit: extractCommit(body, contentType),
      checks: extractChecks(body, contentType),
      durationMs: Date.now() - started,
      error: ok ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      httpStatus: null,
      commit: null,
      durationMs: Date.now() - started,
      error: aborted
        ? `No answer within ${Math.round(timeoutMs / 1000)}s`
        : e instanceof Error
          ? e.message
          : "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}
