import { and, eq, isNotNull } from "drizzle-orm";
import { db, repositories } from "db";
import { validateLiveUrl } from "../lib/live-check";
import { notify } from "../lib/notify";
import { usesPayload } from "./deploy";

export type ProbeSeverity = "critical" | "high" | "medium" | "low";

export type ProbeFinding = {
  id: string;
  severity: ProbeSeverity;
  title: string;
  detail: string;
  url: string;
};

export type SiteProbe = {
  checkedAt: string;
  origin: string;
  payload: boolean;
  findings: ProbeFinding[];
};

type Answer = {
  status: number;
  headers: Headers;
  body: string;
  contentType: string;
};

const TIMEOUT_MS = 10_000;
const MAX_BODY = 8 * 1024;

/**
 * One GET, like any visitor's. Never a login attempt, never a POST — these
 * checks look at what is openly reachable, they do not try to break in.
 */
async function get(
  url: string,
  redirect: RequestRedirect = "manual"
): Promise<Answer | null> {
  try {
    const res = await fetch(url, {
      redirect,
      headers: { "user-agent": "moatline/site-probe" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.text().catch(() => "")).slice(0, MAX_BODY);
    return {
      status: res.status,
      headers: res.headers,
      body,
      contentType: res.headers.get("content-type") ?? "",
    };
  } catch {
    return null;
  }
}

function docs(a: Answer | null): unknown[] | null {
  if (!a || a.status !== 200 || !a.contentType.includes("json")) return null;
  try {
    const parsed = JSON.parse(a.body) as { docs?: unknown };
    return Array.isArray(parsed.docs) ? parsed.docs : null;
  } catch {
    return null;
  }
}

/**
 * What the site exposes, judged from its answers. Pure: takes the answers,
 * returns findings — the fetching is in probeSite.
 */
export function judgeSite(
  origin: string,
  a: {
    root: Answer | null;
    plainHttp: Answer | null;
    env: Answer | null;
    envLocal: Answer | null;
    git: Answer | null;
    seed?: Answer | null;
    playground?: Answer | null;
    users?: Answer | null;
    submissions?: Answer | null;
  }
): ProbeFinding[] {
  const out: ProbeFinding[] = [];
  const at = (path: string) => `${origin}${path}`;

  for (const [path, ans] of [
    ["/.env", a.env],
    ["/.env.local", a.envLocal],
  ] as const) {
    if (ans?.status === 200 && /^[A-Z][A-Z0-9_]*=/m.test(ans.body))
      out.push({
        id: `env:${path}`,
        severity: "critical",
        title: `${path} is downloadable`,
        detail:
          "The environment file with database URL, secrets and API keys is served to anyone. Remove it from the image (.dockerignore) and rotate every secret in it — assume they are known.",
        url: at(path),
      });
  }
  if (a.git?.status === 200 && /^ref:\s/m.test(a.git.body))
    out.push({
      id: "git",
      severity: "high",
      title: "The .git directory is reachable",
      detail:
        "The repository history can be downloaded, including files deleted later. Exclude .git from the image (.dockerignore).",
      url: at("/.git/HEAD"),
    });

  if (a.seed && (a.seed.status === 405 || a.seed.status === 200))
    out.push({
      id: "payload:seed",
      severity: "high",
      title: "The Payload seed endpoint is still deployed",
      detail:
        "/next/seed answers (it should be a 404). Seeding creates demo content and clears collections. Delete the route — removing the admin link is not enough.",
      url: at("/next/seed"),
    });
  if (
    a.playground?.status === 200 &&
    /graphql|playground/i.test(a.playground.body)
  )
    out.push({
      id: "payload:playground",
      severity: "medium",
      title: "The GraphQL playground is open in production",
      detail:
        "It documents the whole schema to anyone. Set graphQL.disablePlaygroundInProduction (Payload's default) or disable GraphQL if unused.",
      url: at("/api/graphql-playground"),
    });
  const users = docs(a.users ?? null);
  if (users && users.length > 0)
    out.push({
      id: "payload:users",
      severity: "critical",
      title: "User accounts can be listed without logging in",
      detail:
        "/api/users returns documents to an anonymous request — emails and roles of every admin. Restrict the users collection's read access to authenticated users.",
      url: at("/api/users?limit=1"),
    });
  const subs = docs(a.submissions ?? null);
  if (subs && subs.length > 0)
    out.push({
      id: "payload:form-submissions",
      severity: "critical",
      title: "Form submissions can be read without logging in",
      detail:
        "/api/form-submissions returns what visitors sent — personal data (GDPR). Restrict read access to authenticated users.",
      url: at("/api/form-submissions?limit=1"),
    });

  if (
    a.plainHttp &&
    a.plainHttp.status >= 200 &&
    a.plainHttp.status < 300 &&
    origin.startsWith("https://")
  )
    out.push({
      id: "http",
      severity: "medium",
      title: "Plain HTTP is served instead of redirecting to HTTPS",
      detail:
        "http:// answers with the page instead of a redirect — logins and form data can travel unencrypted. Enable the HTTPS redirect in Dokploy (domain settings) or Cloudflare.",
      url: origin.replace("https://", "http://"),
    });

  const h = a.root?.headers;
  if (h) {
    const csp = h.get("content-security-policy") ?? "";
    if (origin.startsWith("https://") && !h.get("strict-transport-security"))
      out.push({
        id: "header:hsts",
        severity: "medium",
        title: "No Strict-Transport-Security header",
        detail:
          "Browsers may still try plain HTTP first. Send `Strict-Transport-Security: max-age=31536000; includeSubDomains`.",
        url: origin,
      });
    if (!h.get("x-frame-options") && !/frame-ancestors/i.test(csp))
      out.push({
        id: "header:framing",
        severity: "medium",
        title: "The site can be framed by other sites",
        detail:
          "Neither X-Frame-Options nor a CSP frame-ancestors rule — clickjacking, including on /admin. Send `X-Frame-Options: SAMEORIGIN` or `frame-ancestors 'self'`.",
        url: origin,
      });
    if (!h.get("x-content-type-options"))
      out.push({
        id: "header:nosniff",
        severity: "low",
        title: "No X-Content-Type-Options header",
        detail: "Send `X-Content-Type-Options: nosniff`.",
        url: origin,
      });
    if (!csp)
      out.push({
        id: "header:csp",
        severity: "low",
        title: "No Content-Security-Policy",
        detail:
          "A CSP limits what an injected script can do. Start with a report-only policy.",
        url: origin,
      });
    const powered = h.get("x-powered-by");
    if (powered)
      out.push({
        id: "header:powered-by",
        severity: "low",
        title: `The server announces itself (X-Powered-By: ${powered})`,
        detail: "Set `poweredByHeader: false` in next.config.",
        url: origin,
      });
  }
  return out;
}

/** Look at a site from outside and record what it exposes. */
export async function probeSite(
  repositoryId: string
): Promise<SiteProbe | null> {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  if (!repo?.liveUrl) return null;
  let origin: string;
  try {
    origin = new URL(repo.liveUrl).origin;
  } catch {
    return null;
  }
  if (!validateLiveUrl(origin).ok) return null;
  const payload = await usesPayload(repo.id).catch(() => false);
  const at = (p: string) => `${origin}${p}`;
  const [
    root,
    plainHttp,
    env,
    envLocal,
    git,
    seed,
    playground,
    users,
    submissions,
  ] = await Promise.all([
    get(at("/"), "follow"),
    origin.startsWith("https://")
      ? get(origin.replace("https://", "http://") + "/")
      : Promise.resolve(null),
    get(at("/.env")),
    get(at("/.env.local")),
    get(at("/.git/HEAD")),
    payload ? get(at("/next/seed")) : Promise.resolve(null),
    payload ? get(at("/api/graphql-playground")) : Promise.resolve(null),
    payload ? get(at("/api/users?limit=1")) : Promise.resolve(null),
    payload ? get(at("/api/form-submissions?limit=1")) : Promise.resolve(null),
  ]);
  const findings = judgeSite(origin, {
    root,
    plainHttp,
    env,
    envLocal,
    git,
    seed,
    playground,
    users,
    submissions,
  });
  const probe: SiteProbe = {
    checkedAt: new Date().toISOString(),
    origin,
    payload,
    findings,
  };
  const before = new Set(
    ((repo.siteProbe as SiteProbe | null)?.findings ?? []).map((f) => f.id)
  );
  await db
    .update(repositories)
    .set({ siteProbe: probe })
    .where(eq(repositories.id, repo.id));
  const fresh = findings.filter(
    (f) =>
      (f.severity === "critical" || f.severity === "high") && !before.has(f.id)
  );
  if (fresh.length) {
    await notify(repo.organizationId, {
      type: "workflow_failed",
      title: `${repo.name}: ${fresh[0]!.title}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ""}`,
      message: fresh.map((f) => `${f.title} — ${f.detail}`).join("\n"),
      url: fresh[0]!.url,
    }).catch(() => {});
  }
  return probe;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every live site once a day. */
export async function runDueSiteProbes(): Promise<void> {
  const rows = await db
    .select({ id: repositories.id, siteProbe: repositories.siteProbe })
    .from(repositories)
    .where(and(isNotNull(repositories.liveUrl)));
  for (const r of rows) {
    const last = (r.siteProbe as SiteProbe | null)?.checkedAt;
    if (last && Date.now() - Date.parse(last) < DAY_MS) continue;
    await probeSite(r.id).catch((e) =>
      console.error("[site-probe] failed:", e)
    );
  }
}
