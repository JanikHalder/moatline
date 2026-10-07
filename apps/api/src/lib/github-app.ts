import { createSign } from "node:crypto";

/**
 * A GitHub App of the organization's own, created with GitHub's manifest
 * flow: Moatline describes the app, GitHub shows it pre-filled, the person
 * confirms, and GitHub hands back its credentials once. Repository access
 * then comes from short-lived installation tokens (one hour) instead of a
 * personal token that outlives whoever created it.
 */

const API = "https://api.github.com";

export type AppCredentials = {
  id: number;
  slug: string;
  name: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string | null;
};

/** What the app may do: exactly what scans, fix PRs and merges need. */
export const APP_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  workflows: "write",
  checks: "read",
  statuses: "read",
  metadata: "read",
} as const;

/** The manifest GitHub pre-fills the new app with. */
export function appManifest(opts: {
  /** The web app's public URL, e.g. https://moatline.example.com */
  appUrl: string;
  name: string;
}) {
  const base = opts.appUrl.replace(/\/+$/, "");
  return {
    name: opts.name,
    url: base,
    redirect_url: `${base}/api/github-app/callback`,
    setup_url: `${base}/api/github-app/installed`,
    setup_on_update: true,
    // Moatline asks GitHub; it needs no events pushed to it.
    hook_attributes: { url: `${base}/api/github-app/webhook`, active: false },
    public: false,
    default_permissions: APP_PERMISSIONS,
    default_events: [],
  };
}

/** Where the browser posts the manifest: a personal account or an organization. */
export function manifestAction(state: string, githubOrg?: string | null) {
  const org = githubOrg?.trim();
  const path = org
    ? `/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : "/settings/apps/new";
  return `https://github.com${path}?state=${encodeURIComponent(state)}`;
}

/** Exchange the one-time code from the redirect for the app's credentials. */
export async function convertManifest(
  code: string
): Promise<{ ok: true; app: AppCredentials } | { ok: false; error: string }> {
  const res = await fetch(
    `${API}/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    }
  ).catch(() => null);
  if (!res) return { ok: false, error: "GitHub did not answer." };
  if (!res.ok)
    return {
      ok: false,
      error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`,
    };
  const d = (await res.json()) as {
    id: number;
    slug: string;
    name: string;
    html_url: string;
    client_id: string;
    client_secret: string;
    pem: string;
    webhook_secret?: string | null;
  };
  return {
    ok: true,
    app: {
      id: d.id,
      slug: d.slug,
      name: d.name,
      htmlUrl: d.html_url,
      clientId: d.client_id,
      clientSecret: d.client_secret,
      privateKey: d.pem,
      webhookSecret: d.webhook_secret ?? null,
    },
  };
}

const b64url = (v: string | Buffer) =>
  Buffer.from(v)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

/** The app's own JWT (RS256, ten minutes at most, a minute of clock skew). */
export function appJwt(
  app: Pick<AppCredentials, "id" | "privateKey">,
  now = Date.now()
): string {
  const iat = Math.floor(now / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ iat, exp: iat + 9 * 60, iss: String(app.id) })
  );
  const sign = createSign("RSA-SHA256");
  sign.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(sign.sign(app.privateKey))}`;
}

async function asApp<T>(
  app: Pick<AppCredentials, "id" | "privateKey">,
  method: "GET" | "POST",
  path: string
): Promise<
  { ok: true; data: T } | { ok: false; status: number; error: string }
> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${appJwt(app)}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, error: "GitHub did not answer." };
  if (!res.ok)
    return {
      ok: false,
      status: res.status,
      error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`,
    };
  return { ok: true, data: (await res.json()) as T };
}

export type Installation = { id: number; account: string; type: string };

/** Every account the app is installed on. */
export async function listInstallations(
  app: Pick<AppCredentials, "id" | "privateKey">
): Promise<{ ok: true; list: Installation[] } | { ok: false; error: string }> {
  const r = await asApp<
    Array<{ id: number; account?: { login?: string; type?: string } | null }>
  >(app, "GET", "/app/installations?per_page=100");
  if (!r.ok) return r;
  return {
    ok: true,
    list: r.data.map((i) => ({
      id: i.id,
      account: i.account?.login ?? "?",
      type: i.account?.type ?? "User",
    })),
  };
}

const tokens = new Map<number, { token: string; expires: number }>();

/** A token for one installation, reused until five minutes before it ends. */
export async function installationToken(
  app: Pick<AppCredentials, "id" | "privateKey">,
  installationId: number
): Promise<string | null> {
  const hit = tokens.get(installationId);
  if (hit && hit.expires - Date.now() > 5 * 60 * 1000) return hit.token;
  const r = await asApp<{ token: string; expires_at: string }>(
    app,
    "POST",
    `/app/installations/${installationId}/access_tokens`
  );
  if (!r.ok) {
    console.error(
      `[github-app] No token for installation ${installationId}: ${r.error}`
    );
    return null;
  }
  tokens.set(installationId, {
    token: r.data.token,
    expires: Date.parse(r.data.expires_at),
  });
  return r.data.token;
}

/** The installation that covers a repository owner, if any. */
export function installationFor(
  installations: Installation[],
  owner: string | null | undefined
): Installation | null {
  if (owner) {
    const o = owner.toLowerCase();
    return installations.find((i) => i.account.toLowerCase() === o) ?? null;
  }
  return installations.length === 1 ? installations[0]! : null;
}
