import dns from "node:dns/promises";
import tls from "node:tls";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, domains, repositories } from "db";
import { notify } from "../lib/notify";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DomainState = {
  /** Certificate of the site (www/apex as served on 443). */
  cert: {
    ok: boolean;
    validTo: string | null;
    daysLeft: number | null;
    issuer: string | null;
    error: string | null;
  };
  /**
   * Port 80 from outside, where Let's Encrypt's HTTP-01 challenge arrives.
   * null when not checked (no Let's Encrypt certificate).
   */
  acme?: { reachable: boolean; error: string | null } | null;
  /** Registration expiry from RDAP, when the registry publishes it. */
  registration: { expires: string | null; daysLeft: number | null };
  mail: {
    mx: string[];
    spf: string | null;
    dmarc: string | null;
    dmarcPolicy: string | null;
    /** Selectors of common providers that have a DKIM key published. */
    dkim: string[];
  };
  problems: Array<{
    id: string;
    severity: "high" | "medium" | "low";
    text: string;
  }>;
};

/**
 * Second-level suffixes where the registrable domain has three labels
 * (shop.co.at → shop.co.at, not co.at). Enough for the agency's markets.
 */
const SECOND_LEVEL = new Set([
  "co.at",
  "or.at",
  "ac.at",
  "gv.at",
  "co.uk",
  "org.uk",
  "com.au",
  "co.nz",
  "com.br",
]);

/** shop.example.co.at → example.co.at; www.kunde.de → kunde.de. */
export function registrableDomain(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  const labels = h.split(".");
  const last2 = labels.slice(-2).join(".");
  if (SECOND_LEVEL.has(last2) && labels.length >= 3)
    return labels.slice(-3).join(".");
  return last2;
}

function certOf(host: string): Promise<DomainState["cert"]> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: 10_000 },
      () => {
        const c = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();
        if (!c?.valid_to) {
          resolve({
            ok: false,
            validTo: null,
            daysLeft: null,
            issuer: null,
            error: "no certificate",
          });
          return;
        }
        const validTo = new Date(c.valid_to);
        resolve({
          ok: authorized,
          validTo: validTo.toISOString(),
          daysLeft: Math.floor((validTo.getTime() - Date.now()) / DAY_MS),
          issuer:
            (Array.isArray(c.issuer?.O) ? c.issuer.O[0] : c.issuer?.O) ??
            (Array.isArray(c.issuer?.CN) ? c.issuer.CN[0] : c.issuer?.CN) ??
            null,
          error: authorized
            ? null
            : String(socket.authorizationError ?? "not trusted"),
        });
      }
    );
    socket.on("error", (e) =>
      resolve({
        ok: false,
        validTo: null,
        daysLeft: null,
        issuer: null,
        error: e.message,
      })
    );
    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        ok: false,
        validTo: null,
        daysLeft: null,
        issuer: null,
        error: "no answer on port 443",
      });
    });
  });
}

let bootstrap: { at: number; services: Array<[string[], string[]]> } | null =
  null;

/** RDAP server of a TLD from IANA's bootstrap file (cached a day). */
async function rdapBase(tld: string): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.at > DAY_MS) {
    const res = await fetch("https://data.iana.org/rdap/dns.json", {
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      services?: Array<[string[], string[]]>;
    } | null;
    if (!body?.services) return null;
    bootstrap = { at: Date.now(), services: body.services };
  }
  const hit = bootstrap.services.find(([tlds]) => tlds.includes(tld));
  return hit?.[1].find((u) => u.startsWith("https://")) ?? null;
}

/**
 * Registration expiry via RDAP, asked of the registry itself. Not every
 * registry has RDAP or publishes the date (.at does neither) — then unknown.
 */
async function registrationOf(
  domain: string
): Promise<DomainState["registration"]> {
  try {
    const base = await rdapBase(domain.split(".").pop()!);
    if (!base) return { expires: null, daysLeft: null };
    const res = await fetch(`${base.replace(/\/?$/, "/")}domain/${domain}`, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { expires: null, daysLeft: null };
    const body = (await res.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>;
    };
    const ev = body.events?.find((e) => e.eventAction === "expiration");
    if (!ev?.eventDate) return { expires: null, daysLeft: null };
    const at = new Date(ev.eventDate);
    return {
      expires: at.toISOString(),
      daysLeft: Math.floor((at.getTime() - Date.now()) / DAY_MS),
    };
  } catch {
    return { expires: null, daysLeft: null };
  }
}

const txt = async (name: string): Promise<string[]> =>
  (await dns.resolveTxt(name).catch(() => [] as string[][])).map((r) =>
    r.join("")
  );

/** Selectors of Resend, Google, Microsoft 365, Mailgun, SendGrid, generic. */
const DKIM_SELECTORS = [
  "resend",
  "google",
  "selector1",
  "selector2",
  "k1",
  "mailo",
  "s1",
  "s2",
  "default",
  "dkim",
  "mail",
];

async function mailOf(domain: string): Promise<DomainState["mail"]> {
  const [mx, root, dmarc] = await Promise.all([
    dns.resolveMx(domain).catch(() => []),
    txt(domain),
    txt(`_dmarc.${domain}`),
  ]);
  // A published key: a TXT with a non-empty p= (an empty one is revoked),
  // or a CNAME to the provider's key (Resend, Microsoft, SendGrid do that).
  const hasKey = async (sel: string) => {
    const name = `${sel}._domainkey.${domain}`;
    const [records, cnames] = await Promise.all([
      txt(name),
      dns.resolveCname(name).catch(() => [] as string[]),
    ]);
    return (
      records.some((r) => /(?:^|;)\s*p=[A-Za-z0-9+/]{20,}/.test(r)) ||
      cnames.some((c) => /domainkey|dkim/i.test(c))
    );
  };
  // A wildcard answers for any selector — then the list says nothing.
  const wildcard = await hasKey(
    `pc-${Math.random().toString(36).slice(2, 10)}`
  );
  const dkim: string[] = [];
  if (!wildcard)
    await Promise.all(
      DKIM_SELECTORS.map(async (sel) => {
        if (await hasKey(sel)) dkim.push(sel);
      })
    );
  const dmarcRec = dmarc.find((r) => /^v=DMARC1/i.test(r)) ?? null;
  return {
    // "Null MX" (an empty exchange, RFC 7505) means: this domain takes no mail.
    mx: mx
      .filter((m) => m.exchange && m.exchange !== ".")
      .sort((a, b) => a.priority - b.priority)
      .map((m) => m.exchange),
    spf: root.find((r) => /^v=spf1/i.test(r)) ?? null,
    dmarc: dmarcRec,
    dmarcPolicy: dmarcRec?.match(/;\s*p=(\w+)/i)?.[1]?.toLowerCase() ?? null,
    dkim: dkim.sort(),
  };
}

/** Certificates Traefik, Caddy and co. get from Let's Encrypt. */
export const isLetsEncrypt = (issuer: string | null) =>
  !!issuer && /let'?s\s*encrypt|^(R\d+|E\d+)$/i.test(issuer);

/**
 * Whether port 80 answers for the challenge path. Any HTTP answer — a 404,
 * a redirect — means Let's Encrypt gets through; a refused or silent port
 * means renewals fail without a sound until the certificate runs out.
 */
async function acmeOf(
  host: string
): Promise<{ reachable: boolean; error: string | null }> {
  try {
    const res = await fetch(
      `http://${host}/.well-known/acme-challenge/moatline-check`,
      { redirect: "manual", signal: AbortSignal.timeout(8000) }
    );
    await res.body?.cancel().catch(() => {});
    return { reachable: true, error: null };
  } catch (e) {
    const err = e as { cause?: { code?: string }; name?: string };
    const why =
      err.name === "TimeoutError"
        ? "no answer within 8 s"
        : (err.cause?.code ?? "not reachable");
    return { reachable: false, error: why };
  }
}

/** What is wrong, worst first. Pure, for testing. */
export function domainProblems(
  s: Omit<DomainState, "problems">
): DomainState["problems"] {
  const out: DomainState["problems"] = [];
  const c = s.cert;
  if (c.error && c.daysLeft == null)
    out.push({
      id: "cert",
      severity: "high",
      text: `No valid certificate: ${c.error}`,
    });
  else if (!c.ok)
    out.push({
      id: "cert",
      severity: "high",
      text: `Certificate not trusted: ${c.error}`,
    });
  else if (c.daysLeft != null && c.daysLeft < 14)
    out.push({
      id: "cert-expiry",
      severity: c.daysLeft < 5 ? "high" : "medium",
      text: `Certificate expires in ${c.daysLeft} days — automatic renewal (Traefik/Let's Encrypt) is not working`,
    });
  if (s.acme && !s.acme.reachable && c.ok)
    out.push({
      id: "acme-port80",
      severity: c.daysLeft != null && c.daysLeft < 30 ? "high" : "medium",
      text: `Port 80 is not reachable from outside (${s.acme.error}) — Let's Encrypt cannot renew the certificate${c.daysLeft != null ? `, which expires in ${c.daysLeft} days` : ""}. Open port 80 in the firewall (Traefik redirects it to HTTPS anyway).`,
    });
  const r = s.registration;
  if (r.daysLeft != null && r.daysLeft < 30)
    out.push({
      id: "registration",
      severity: r.daysLeft < 7 ? "high" : "medium",
      text: `Domain registration expires in ${r.daysLeft} days`,
    });
  const m = s.mail;
  if (m.mx.length) {
    if (!m.spf)
      out.push({
        id: "spf",
        severity: "medium",
        text: "No SPF record — mail from this domain lands in spam or is rejected",
      });
    if (!m.dmarc)
      out.push({
        id: "dmarc",
        severity: "medium",
        text: "No DMARC record — Gmail and Microsoft reject or junk bulk mail without one",
      });
    else if (m.dmarcPolicy === "none")
      out.push({
        id: "dmarc-none",
        severity: "low",
        text: "DMARC policy is p=none — reports only, spoofed mail is not stopped",
      });
    if (!m.dkim.length)
      out.push({
        id: "dkim",
        severity: "low",
        text: "No DKIM key found for common selectors (Resend, Google, Microsoft …) — check the sending service's DNS setup",
      });
  }
  return out;
}

export async function checkDomain(name: string): Promise<DomainState> {
  const [cert, registration, mail] = await Promise.all([
    certOf(name),
    registrationOf(name),
    mailOf(name),
  ]);
  // A domain often serves only www: try it when the apex has no cert.
  const www = cert.daysLeft == null;
  const certFinal = www ? await certOf(`www.${name}`) : cert;
  // Only where renewal goes through port 80 — DNS challenges do not.
  const acme = isLetsEncrypt(certFinal.issuer)
    ? await acmeOf(www ? `www.${name}` : name)
    : null;
  const base = { cert: certFinal, registration, mail, acme };
  return { ...base, problems: domainProblems(base) };
}

/** Domains of every live URL, created on first sight with the repo's client. */
export async function syncDomainsForOrg(organizationId: string): Promise<void> {
  const repos = await db
    .select({ liveUrl: repositories.liveUrl, clientId: repositories.clientId })
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        isNotNull(repositories.liveUrl)
      )
    );
  for (const r of repos) {
    let host: string;
    try {
      host = new URL(r.liveUrl!).hostname;
    } catch {
      continue;
    }
    const name = registrableDomain(host);
    if (!name) continue;
    await db
      .insert(domains)
      .values({ organizationId, name, clientId: r.clientId, source: "auto" })
      .onConflictDoNothing();
  }
}

export async function checkAndStore(
  domainId: string
): Promise<DomainState | null> {
  const [d] = await db.select().from(domains).where(eq(domains.id, domainId));
  if (!d) return null;
  const state = await checkDomain(d.name);
  const before = new Set(
    ((d.state as DomainState | null)?.problems ?? []).map((p) => p.id)
  );
  await db
    .update(domains)
    .set({ state, checkedAt: new Date() })
    .where(eq(domains.id, d.id));
  const fresh = state.problems.filter(
    (p) => p.severity !== "low" && !before.has(p.id)
  );
  if (fresh.length)
    await notify(d.organizationId, {
      type: "workflow_failed",
      title: `${d.name}: ${fresh[0]!.text}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ""}`,
      message: fresh.map((p) => p.text).join("\n"),
    }).catch(() => {});
  return state;
}

/** Daily: discover domains from live URLs, check each. */
export async function runDueDomainChecks(): Promise<void> {
  const orgs = await db
    .selectDistinct({ organizationId: repositories.organizationId })
    .from(repositories)
    .where(isNotNull(repositories.liveUrl));
  for (const o of orgs)
    await syncDomainsForOrg(o.organizationId).catch(() => {});
  const all = await db
    .select({ id: domains.id, checkedAt: domains.checkedAt })
    .from(domains);
  for (const d of all) {
    if (d.checkedAt && Date.now() - d.checkedAt.getTime() < DAY_MS) continue;
    await checkAndStore(d.id).catch((e) =>
      console.error("[domains] check failed:", e)
    );
  }
}
