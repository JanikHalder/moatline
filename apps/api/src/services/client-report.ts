import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import {
  clients,
  db,
  deployRuns,
  incidents,
  domains,
  organization,
  perfRuns,
  repositories,
  scans,
  servers,
  updateRuns,
  vulnerabilities,
} from "db";
import type { DomainState } from "./domain-check";
import type { SiteProbe } from "./site-probe";
import { uptimeOf } from "./incidents";

export type Lang = "de" | "en";

/** Everything the client reads, in their language. */
const T = {
  de: {
    title: "Wartungsbericht",
    printHint: "Zum Speichern als PDF: Drucken → „Als PDF speichern“.",
    createdBy: (org: string, d: string) => `erstellt von ${org} am ${d}`,
    yourAgency: "Ihrer Agentur",
    kpiFixed: "Sicherheitslücken geschlossen",
    kpiUpdates: "Updates eingespielt",
    kpiDeploys: "Deployments",
    kpiOpen: "offene kritische/hohe Lücken",
    websites: "Websites",
    siteHeads: [
      "Website",
      "Status",
      "Verfügbarkeit",
      "Lücken geschlossen",
      "Offen",
      "Updates",
      "Deploys",
      "Performance (mobil)",
      "Sicherheits-Check",
    ],
    noSites: "Keine Websites zugeordnet.",
    online: "online",
    down: "nicht erreichbar",
    none: "keine",
    openCves: (c: number, h: number) => `${c} kritisch, ${h} hoch`,
    rolledBack: (n: number) => `${n} zurückgerollt`,
    outages: (n: number) => (n === 1 ? "1 Ausfall" : `${n} Ausfälle`),
    monitoring:
      "Überwachung: Erreichbarkeit alle 5 Minuten (bei Ausfall jede Minute), Schwachstellen-Scan täglich, Sicherheits-Check und Lighthouse täglich sowie nach jedem Deployment.",
    domainsTitle: "Domains, Zertifikate &amp; E-Mail",
    domainHeads: [
      "Domain",
      "SSL-Zertifikat",
      "Registrierung",
      "E-Mail-Authentifizierung",
      "Hinweise",
    ],
    validUntil: (d: string) => `gültig bis ${d}`,
    until: (d: string) => `bis ${d}`,
    noMail: "kein Mail",
    servers: "Server",
    serverHeads: ["Server", "Agent", "Updates"],
    lastReport: (d: string) => `zuletzt gemeldet ${d}`,
    noAgent: "kein Agent",
    securityUpdates: (n: number) => `${n} Sicherheits-Updates offen`,
    period: (a: string, b: string) =>
      `Zeitraum: ${a} – ${b}. Automatisch erstellt mit Moatline.`,
    problem: (id: string, text: string) => {
      const n = text.match(/(\d+) days/)?.[1];
      const map: Record<string, string> = {
        cert: "Kein gültiges SSL-Zertifikat",
        "cert-expiry": `SSL-Zertifikat läuft in ${n} Tagen ab`,
        registration: `Domain-Registrierung läuft in ${n} Tagen ab`,
        spf: "Kein SPF-Eintrag — Mails landen im Spam",
        dmarc: "Kein DMARC-Eintrag",
        "dmarc-none": "DMARC nur im Beobachtungsmodus (p=none)",
        dkim: "Kein DKIM-Schlüssel gefunden",
      };
      return map[id] ?? text;
    },
  },
  en: {
    title: "Maintenance report",
    printHint: "To save as PDF: Print → “Save as PDF”.",
    createdBy: (org: string, d: string) => `prepared by ${org} on ${d}`,
    yourAgency: "your agency",
    kpiFixed: "vulnerabilities fixed",
    kpiUpdates: "updates applied",
    kpiDeploys: "deployments",
    kpiOpen: "open critical/high vulnerabilities",
    websites: "Websites",
    siteHeads: [
      "Website",
      "Status",
      "Uptime",
      "Fixed",
      "Open",
      "Updates",
      "Deploys",
      "Performance (mobile)",
      "Security check",
    ],
    noSites: "No websites assigned.",
    online: "online",
    down: "unreachable",
    none: "none",
    openCves: (c: number, h: number) => `${c} critical, ${h} high`,
    rolledBack: (n: number) => `${n} rolled back`,
    outages: (n: number) => (n === 1 ? "1 outage" : `${n} outages`),
    monitoring:
      "Monitoring: availability every 5 minutes (every minute during an outage), vulnerability scan daily, security check and Lighthouse daily and after every deployment.",
    domainsTitle: "Domains, certificates &amp; email",
    domainHeads: [
      "Domain",
      "SSL certificate",
      "Registration",
      "Email authentication",
      "Notes",
    ],
    validUntil: (d: string) => `valid until ${d}`,
    until: (d: string) => `until ${d}`,
    noMail: "no mail",
    servers: "Servers",
    serverHeads: ["Server", "Agent", "Updates"],
    lastReport: (d: string) => `last report ${d}`,
    noAgent: "no agent",
    securityUpdates: (n: number) => `${n} security updates pending`,
    period: (a: string, b: string) =>
      `Period: ${a} – ${b}. Generated automatically by Moatline.`,
    problem: (_id: string, text: string) => text,
  },
} satisfies Record<Lang, unknown>;

/** "2026-09" → [start, end) of that month, UTC. */
export function monthRange(month: string): [Date, Date] | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  return [new Date(Date.UTC(y, mo, 1)), new Date(Date.UTC(y, mo + 1, 1))];
}

const esc = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type SiteLine = {
  /** Share of the month the live URL answered; null without a live URL. */
  uptime: number | null;
  outages: number;
  name: string;
  url: string | null;
  live: string;
  cves: { critical: number; high: number; other: number };
  fixedThisMonth: number;
  updates: number;
  fixes: number;
  deploys: number;
  rolledBack: number;
  perf: number | null;
  lcpMs: number | null;
  siteIssues: number;
};

async function cveCounts(scanId: string | undefined) {
  if (!scanId) return null;
  const rows = await db
    .select({
      severity: vulnerabilities.severity,
      ghsa: vulnerabilities.ghsaId,
      pkg: vulnerabilities.packageName,
    })
    .from(vulnerabilities)
    .where(eq(vulnerabilities.scanId, scanId));
  return rows;
}

/**
 * The monthly maintenance report for one client, as printable HTML in
 * German: what was looked after, what was fixed, how the sites stand.
 */
export async function buildClientReport(
  clientId: string,
  organizationId: string,
  month: string
): Promise<string | null> {
  const range = monthRange(month);
  if (!range) return null;
  const [from, to] = range;
  const [client] = await db
    .select()
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.organizationId, organizationId))
    );
  if (!client) return null;
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId));
  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.clientId, clientId));
  const srv = await db
    .select()
    .from(servers)
    .where(eq(servers.clientId, clientId));
  const doms = await db
    .select()
    .from(domains)
    .where(eq(domains.clientId, clientId));
  const ids = repos.map((r) => r.id);

  const runs = ids.length
    ? await db
        .select()
        .from(updateRuns)
        .where(
          and(
            inArray(updateRuns.repositoryId, ids),
            gte(updateRuns.triggeredAt, from),
            lt(updateRuns.triggeredAt, to)
          )
        )
    : [];
  const deploys = ids.length
    ? await db
        .select()
        .from(deployRuns)
        .where(
          and(
            inArray(deployRuns.repositoryId, ids),
            gte(deployRuns.triggeredAt, from),
            lt(deployRuns.triggeredAt, to)
          )
        )
    : [];

  const sites: SiteLine[] = [];
  for (const r of repos) {
    const lastScan = async (before: Date) =>
      (
        await db
          .select({ id: scans.id })
          .from(scans)
          .where(
            and(
              eq(scans.repositoryId, r.id),
              eq(scans.status, "success"),
              lt(scans.startedAt, before)
            )
          )
          .orderBy(desc(scans.startedAt))
          .limit(1)
      )[0]?.id;
    const [startRows, endRows] = await Promise.all([
      cveCounts(await lastScan(from)),
      cveCounts(await lastScan(to)),
    ]);
    const key = (v: { ghsa: string | null; pkg: string }) =>
      `${v.pkg}|${v.ghsa}`;
    const endKeys = new Set((endRows ?? []).map(key));
    const fixed = startRows
      ? startRows.filter((v) => !endKeys.has(key(v))).length
      : 0;
    const [perf] = await db
      .select({ performance: perfRuns.performance, lcpMs: perfRuns.lcpMs })
      .from(perfRuns)
      .where(
        and(
          eq(perfRuns.repositoryId, r.id),
          eq(perfRuns.strategy, "mobile"),
          isNull(perfRuns.error),
          lt(perfRuns.createdAt, to)
        )
      )
      .orderBy(desc(perfRuns.createdAt))
      .limit(1);
    const mine = runs.filter((u) => u.repositoryId === r.id);
    const myDeploys = deploys.filter((d) => d.repositoryId === r.id);
    const outages = await db
      .select({
        startedAt: incidents.startedAt,
        resolvedAt: incidents.resolvedAt,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.repositoryId, r.id),
          eq(incidents.kind, "site_down"),
          lt(incidents.startedAt, to),
          or(isNull(incidents.resolvedAt), gte(incidents.resolvedAt, from))
        )
      );
    sites.push({
      uptime: r.liveUrl
        ? uptimeOf(outages, from.getTime(), Math.min(to.getTime(), Date.now()))
        : null,
      outages: outages.length,
      name: r.name,
      url: r.liveUrl ? new URL(r.liveUrl).origin : null,
      live: r.liveStatus ?? "unknown",
      cves: {
        critical: (endRows ?? []).filter((v) => v.severity === "critical")
          .length,
        high: (endRows ?? []).filter((v) => v.severity === "high").length,
        other: (endRows ?? []).filter(
          (v) => v.severity !== "critical" && v.severity !== "high"
        ).length,
      },
      fixedThisMonth: fixed,
      updates: mine.filter((u) => u.kind === "manual" && u.merged).length,
      fixes: mine.filter((u) => u.kind === "security" && u.merged).length,
      deploys: myDeploys.filter((d) => d.status === "succeeded").length,
      rolledBack: myDeploys.filter((d) => d.guard === "rolled_back").length,
      perf: perf?.performance ?? null,
      lcpMs: perf?.lcpMs ?? null,
      siteIssues: ((r.siteProbe as SiteProbe | null)?.findings ?? []).filter(
        (f) => f.severity === "critical" || f.severity === "high"
      ).length,
    });
  }

  const totals = sites.reduce(
    (a, s) => ({
      fixed: a.fixed + s.fixedThisMonth,
      updates: a.updates + s.updates,
      fixes: a.fixes + s.fixes,
      deploys: a.deploys + s.deploys,
      open: a.open + s.cves.critical + s.cves.high,
    }),
    { fixed: 0, updates: 0, fixes: 0, deploys: 0, open: 0 }
  );
  const lang: Lang = client.language === "en" ? "en" : "de";
  const t = T[lang];
  const date = (d: Date | string) =>
    new Date(d).toLocaleDateString(lang === "de" ? "de-AT" : "en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  const monthLabel = from.toLocaleDateString(
    lang === "de" ? "de-AT" : "en-GB",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }
  );

  const siteRows = sites
    .map(
      (s) => `<tr>
  <td><strong>${esc(s.name)}</strong>${s.url ? `<br><span class="muted">${esc(s.url)}</span>` : ""}</td>
  <td>${s.live === "up" ? t.online : s.live === "down" ? `<span class="bad">${t.down}</span>` : "—"}</td>
  <td>${s.uptime == null ? "—" : `<span class="${s.uptime >= 0.999 ? "ok" : s.uptime >= 0.99 ? "warn" : "bad"}">${(Math.floor(s.uptime * 10000) / 100).toFixed(2)} %</span>${s.outages ? `<br><span class="muted">${t.outages(s.outages)}</span>` : ""}`}</td>
  <td>${s.fixedThisMonth}</td>
  <td>${s.cves.critical + s.cves.high === 0 ? `<span class="ok">${t.none}</span>` : `<span class="bad">${t.openCves(s.cves.critical, s.cves.high)}</span>`}</td>
  <td>${s.updates + s.fixes}</td>
  <td>${s.deploys}${s.rolledBack ? ` <span class="muted">(${t.rolledBack(s.rolledBack)})</span>` : ""}</td>
  <td>${s.perf == null ? "—" : `<span class="${s.perf >= 90 ? "ok" : s.perf >= 50 ? "warn" : "bad"}">${s.perf}</span>${s.lcpMs != null ? `<br><span class="muted">LCP ${(s.lcpMs / 1000).toFixed(1)} s</span>` : ""}`}</td>
  <td>${s.siteIssues ? `<span class="bad">${s.siteIssues}</span>` : '<span class="ok">✓</span>'}</td>
</tr>`
    )
    .join("\n");

  const domainRows = doms
    .map((d) => {
      const st = d.state as DomainState | null;
      const certTxt =
        st?.cert.daysLeft != null ? t.validUntil(date(st.cert.validTo!)) : "—";
      const regTxt = st?.registration.expires
        ? t.until(date(st.registration.expires))
        : "—";
      const mail = st
        ? [
            st.mail.spf ? "SPF ✓" : "SPF ✗",
            st.mail.dkim.length ? "DKIM ✓" : "DKIM ?",
            st.mail.dmarc
              ? `DMARC ✓${st.mail.dmarcPolicy ? ` (${st.mail.dmarcPolicy})` : ""}`
              : "DMARC ✗",
          ].join(" · ")
        : "—";
      const issues = (st?.problems ?? []).filter((p) => p.severity !== "low");
      return `<tr><td><strong>${esc(d.name)}</strong></td><td>${esc(certTxt)}</td><td>${esc(regTxt)}</td><td>${esc(st?.mail.mx.length ? mail : t.noMail)}</td><td>${issues.length ? `<span class="bad">${esc(issues.map((p) => t.problem(p.id, p.text)).join("; "))}</span>` : '<span class="ok">✓</span>'}</td></tr>`;
    })
    .join("\n");

  const serverRows = srv
    .map((s) => {
      const lr = s.lastReport as {
        updates?: { pending?: number; security?: number } | null;
      } | null;
      return `<tr><td><strong>${esc(s.name)}</strong></td><td>${s.lastReportAt ? t.lastReport(date(s.lastReportAt)) : t.noAgent}</td><td>${lr?.updates ? t.securityUpdates(lr.updates.security ?? 0) : "—"}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<title>${t.title} ${esc(client.name)} — ${esc(monthLabel)}</title>
<style>
  body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;max-width:960px;margin:40px auto;padding:0 24px}
  h1{font-size:24px;margin:0} h2{font-size:17px;margin:32px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
  .muted{color:#666;font-size:12px} .ok{color:#15803d} .warn{color:#b45309} .bad{color:#b91c1c;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}
  th{font-weight:600;color:#444;background:#fafafa}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
  .kpi{border:1px solid #e5e5e5;border-radius:8px;padding:12px} .kpi b{display:block;font-size:22px}
  @media print{body{margin:0} .noprint{display:none}}
</style></head><body>
<p class="noprint muted">${t.printHint}</p>
<h1>${t.title} ${esc(monthLabel)}</h1>
<p>${esc(client.name)} · ${t.createdBy(esc(org?.name ?? t.yourAgency), date(new Date()))}</p>
<div class="kpis">
  <div class="kpi"><b>${totals.fixed}</b>${t.kpiFixed}</div>
  <div class="kpi"><b>${totals.updates + totals.fixes}</b>${t.kpiUpdates}</div>
  <div class="kpi"><b>${totals.deploys}</b>${t.kpiDeploys}</div>
  <div class="kpi"><b class="${totals.open ? "bad" : "ok"}">${totals.open}</b>${t.kpiOpen}</div>
</div>
<h2>${t.websites}</h2>
${sites.length ? `<table><thead><tr>${t.siteHeads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${siteRows}</tbody></table>` : `<p class="muted">${t.noSites}</p>`}
<p class="muted">${t.monitoring}</p>
${doms.length ? `<h2>${t.domainsTitle}</h2><table><thead><tr>${t.domainHeads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${domainRows}</tbody></table>` : ""}
${srv.length ? `<h2>${t.servers}</h2><table><thead><tr>${t.serverHeads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${serverRows}</tbody></table>` : ""}
<p class="muted" style="margin-top:32px">${t.period(date(from), date(new Date(to.getTime() - 1)))}</p>
</body></html>`;
}
