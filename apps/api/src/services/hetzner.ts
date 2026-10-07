import net from "node:net";
import dns from "node:dns/promises";
import { eq, isNotNull } from "drizzle-orm";
import { db, orgIntegrations, servers } from "db";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";
import { PORTS } from "./network-check";

/**
 * Hetzner Cloud firewalls, read with a read-only API token: which ports the
 * firewall in front of a server lets through, and from where. The external
 * check sees one source IP; the firewall rules say what everyone else sees.
 */

const API = "https://api.hetzner.cloud/v1";
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 20;

export type FirewallRule = {
  protocol: string;
  /** "22", "8000-8100", or null for protocols without ports. */
  port: string | null;
  sources: string[];
  description: string | null;
  firewall: string;
};

export type ProviderFirewall = {
  provider: "hetzner";
  checkedAt: string;
  /** The server's name in the Hetzner project. */
  serverName: string;
  firewalls: Array<{ id: number; name: string; status: string }>;
  inbound: FirewallRule[];
};

export type HetznerState = {
  checkedAt: string;
  tokens: number;
  servers: number;
  matched: number;
  error: string | null;
};

type HServer = {
  id: number;
  name: string;
  public_net?: {
    ipv4?: { ip?: string } | null;
    ipv6?: { ip?: string } | null;
    firewalls?: Array<{ id: number; status: string }>;
  };
  private_net?: Array<{ ip?: string }>;
};

type HFirewall = {
  id: number;
  name: string;
  rules?: Array<{
    direction: "in" | "out";
    protocol: string;
    port?: string | null;
    source_ips?: string[];
    description?: string | null;
  }>;
};

export const TOKEN_RE = /^[A-Za-z0-9]{64}$/;

/** Stored as one encrypted string, one token per line (one per project). */
export function parseTokens(stored: string | null | undefined): string[] {
  if (!stored) return [];
  let plain: string;
  try {
    plain = isEncrypted(stored) ? decryptSecret(stored) : stored;
  } catch {
    return [];
  }
  return plain
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function getAll<T>(
  token: string,
  path: string,
  key: string
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${API}/${path}?per_page=50&page=${page}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
    if (res.status === 401) {
      throw new Error("Hetzner rejected an API token (revoked or mistyped).");
    }
    if (!res.ok) throw new Error(`Hetzner API: HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown> & {
      meta?: { pagination?: { next_page?: number | null } };
    };
    out.push(...((body[key] as T[] | undefined) ?? []));
    if (!body.meta?.pagination?.next_page) break;
  }
  return out;
}

/** Every server of a project with its inbound firewall rules. */
export async function fetchProject(
  token: string
): Promise<Array<{ server: HServer; firewall: ProviderFirewall }>> {
  const [hServers, hFirewalls] = await Promise.all([
    getAll<HServer>(token, "servers", "servers"),
    getAll<HFirewall>(token, "firewalls", "firewalls"),
  ]);
  const byId = new Map(hFirewalls.map((f) => [f.id, f]));
  const checkedAt = new Date().toISOString();
  return hServers.map((s) => {
    const attached = (s.public_net?.firewalls ?? [])
      .map((a) => ({ a, f: byId.get(a.id) }))
      .filter((x): x is { a: typeof x.a; f: HFirewall } => !!x.f);
    return {
      server: s,
      firewall: {
        provider: "hetzner",
        checkedAt,
        serverName: s.name,
        firewalls: attached.map(({ a, f }) => ({
          id: f.id,
          name: f.name,
          status: a.status,
        })),
        inbound: attached
          // A firewall still being applied does not filter yet.
          .filter(({ a }) => a.status === "applied")
          .flatMap(({ f }) =>
            (f.rules ?? [])
              .filter((r) => r.direction === "in")
              .map((r) => ({
                protocol: r.protocol,
                port: r.port ?? null,
                sources: r.source_ips ?? [],
                description: r.description ?? null,
                firewall: f.name,
              }))
          ),
      },
    };
  });
}

const WORLD = new Set(["0.0.0.0/0", "::/0"]);

function covers(rule: FirewallRule, port: number): boolean {
  if (rule.protocol !== "tcp") return false;
  if (!rule.port || rule.port === "any") return true;
  const [lo, hi] = rule.port.split("-").map(Number);
  if (!Number.isFinite(lo)) return false;
  return port >= lo! && port <= (Number.isFinite(hi) ? hi! : lo!);
}

export type PortAccess =
  | { access: "unfiltered" }
  | { access: "world"; firewall: string }
  | { access: "restricted"; sources: string[]; firewall: string }
  | { access: "closed"; firewall: string };

/** What the firewall does with inbound TCP on one port. */
export function portAccess(fw: ProviderFirewall, port: number): PortAccess {
  const applied = fw.firewalls.filter((f) => f.status === "applied");
  // Without an applied firewall Hetzner lets everything through.
  if (applied.length === 0) return { access: "unfiltered" };
  const rules = fw.inbound.filter((r) => covers(r, port));
  const world = rules.find((r) => r.sources.some((s) => WORLD.has(s)));
  if (world) return { access: "world", firewall: world.firewall };
  if (rules.length) {
    return {
      access: "restricted",
      sources: [...new Set(rules.flatMap((r) => r.sources))],
      firewall: rules[0]!.firewall,
    };
  }
  return {
    access: "closed",
    firewall: applied.map((f) => f.name).join(", "),
  };
}

/** Short form for finding texts: "1.2.3.4/32, 5.6.7.8/32 (+2)". */
export function describeSources(sources: string[]): string {
  const shown = sources.slice(0, 3).join(", ");
  return sources.length > 3 ? `${shown} (+${sources.length - 3})` : shown;
}

/** Does this Hetzner server stand behind the address we know? */
function matches(
  s: HServer,
  ips: string[],
  names: Array<string | null | undefined>
): boolean {
  const v4 = s.public_net?.ipv4?.ip;
  if (v4 && ips.includes(v4)) return true;
  const v6 = s.public_net?.ipv6?.ip; // a /64 network
  if (v6) {
    const [prefix, bits] = v6.split("/");
    const list = new net.BlockList();
    try {
      list.addSubnet(prefix!, Number(bits ?? 64), "ipv6");
      if (ips.some((ip) => net.isIPv6(ip) && list.check(ip, "ipv6")))
        return true;
    } catch {
      // ignore a malformed network
    }
  }
  const lower = s.name.toLowerCase();
  return names.some((n) => !!n && n.toLowerCase() === lower);
}

async function addressIps(address: string | null): Promise<string[]> {
  const host = address?.trim().replace(/^\[|\]$/g, "");
  if (!host) return [];
  if (net.isIP(host)) return [host];
  try {
    return (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

type ServerRow = typeof servers.$inferSelect;

type ReportPorts = {
  hardening?: { ufw?: string | null } | null;
  listeners?: Array<{ address: string; port: number; process?: string | null }>;
  dockerRisks?: {
    containers?: Array<{ published?: Array<{ hostPort: number }> }>;
    servicePorts?: Array<{ hostPort: number }>;
  } | null;
};

/**
 * Findings about the firewall itself. Ports Docker publishes are rated in
 * the security findings (they know which container is behind them); here:
 * no firewall at all, and rules that open other listening services or
 * everything to the internet.
 */
export function providerFindings(
  fw: ProviderFirewall,
  server: Pick<ServerRow, "expectedPorts" | "lastReport">
): FindingInput[] {
  const out: FindingInput[] = [];
  const report = (server.lastReport ?? {}) as ReportPorts;
  if (!fw.firewalls.some((f) => f.status === "applied")) {
    const ufw = report.hardening?.ufw === "active";
    out.push({
      fingerprint: "hetzner:no-firewall",
      severity: ufw ? "low" : "medium",
      title: "No Hetzner firewall in front of this server",
      detail: ufw
        ? `Hetzner server "${fw.serverName}" has no firewall applied; only UFW on the host filters. Docker-published ports bypass UFW, so a Hetzner firewall (80/443 open, SSH only from Tailscale or your IPs) adds the layer that catches them.`
        : `Hetzner server "${fw.serverName}" has no firewall applied and UFW is not active: every listening port is reachable. Create a firewall in the Hetzner console (Firewalls → allow 80/443, SSH only from your IPs) and apply it.`,
      target: fw.serverName,
    });
    return out;
  }

  const everything = fw.inbound.find(
    (r) =>
      r.protocol === "tcp" &&
      r.sources.some((s) => WORLD.has(s)) &&
      (!r.port || r.port === "any" || r.port === "1-65535")
  );
  if (everything) {
    out.push({
      fingerprint: "hetzner:all-ports",
      severity: "high",
      title: `Hetzner firewall "${everything.firewall}" allows every TCP port from anywhere`,
      detail:
        "A rule opens all ports to the internet, so the firewall filters nothing. Replace it with rules for the ports that must be public (usually 80 and 443).",
      target: fw.serverName,
    });
    return out;
  }

  const expected = new Set([80, 443, ...(server.expectedPorts ?? [])]);
  const published = new Set([
    ...(report.dockerRisks?.containers ?? []).flatMap((c) =>
      (c.published ?? []).map((p) => p.hostPort)
    ),
    ...(report.dockerRisks?.servicePorts ?? []).map((s) => s.hostPort),
  ]);
  const listening = new Map<number, string | null>();
  for (const l of report.listeners ?? []) {
    if (["0.0.0.0", "::", ""].includes(l.address))
      listening.set(l.port, l.process ?? null);
  }
  const candidates = new Set([
    ...PORTS.filter((p) => p.exposure !== "info").map((p) => p.port),
    ...listening.keys(),
  ]);
  for (const port of [...candidates].sort((a, b) => a - b)) {
    if (expected.has(port) || published.has(port)) continue;
    const a = portAccess(fw, port);
    if (a.access !== "world") continue;
    const meta = PORTS.find((p) => p.port === port);
    const live = listening.has(port);
    // An open rule with nothing behind it is a trap for later, not a hole.
    const severity: FindingInput["severity"] = !live
      ? "low"
      : (meta?.exposure ?? "medium") === "critical"
        ? "critical"
        : meta?.exposure === "high"
          ? "high"
          : meta?.exposure === "low"
            ? "low"
            : "medium";
    const name = meta?.service ?? listening.get(port) ?? "a service";
    out.push({
      fingerprint: `hetzner:open:${port}`,
      severity,
      title: live
        ? `Hetzner firewall lets ${name} (port ${port}) in from anywhere`
        : `Hetzner firewall opens port ${port} (${name}) to anywhere — nothing listens yet`,
      detail: [
        `Rule in "${a.firewall}" allows 0.0.0.0/0.`,
        live ? meta?.why : null,
        port === 22
          ? "Limit SSH to your IPs or reach it over Tailscale only."
          : "Limit the rule to the IPs that need it, or remove it and use Tailscale. If it is meant to be public, add it to the expected ports.",
      ]
        .filter(Boolean)
        .join(" "),
      target: `${fw.serverName}:${port}`,
    });
  }
  return out;
}

/**
 * Pull every Hetzner project of an organization and attach the firewall to
 * the servers it protects (matched by public IP, else by name).
 */
export async function syncHetznerForOrg(
  orgId: string
): Promise<HetznerState | null> {
  const [integ] = await db
    .select({ tokens: orgIntegrations.hetznerTokens })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId));
  const tokens = parseTokens(integ?.tokens);
  const orgServers = await db
    .select()
    .from(servers)
    .where(eq(servers.organizationId, orgId));
  if (tokens.length === 0) {
    // Token removed: forget what it showed.
    for (const s of orgServers.filter((s) => s.providerFirewall)) {
      await db
        .update(servers)
        .set({ providerFirewall: null })
        .where(eq(servers.id, s.id));
      await syncAndNotify(s.id, "provider", []);
    }
    return null;
  }

  const state: HetznerState = {
    checkedAt: new Date().toISOString(),
    tokens: tokens.length,
    servers: 0,
    matched: 0,
    error: null,
  };
  const project: Awaited<ReturnType<typeof fetchProject>> = [];
  const errors: string[] = [];
  for (const t of tokens) {
    try {
      project.push(...(await fetchProject(t)));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  state.servers = project.length;
  state.error = errors.length ? [...new Set(errors)].join(" ") : null;

  for (const s of orgServers) {
    const ips = await addressIps(s.address);
    const hit = project.find((p) =>
      matches(p.server, ips, [s.hostname, s.name])
    );
    if (!hit) {
      // A failing token must not wipe what it showed last time.
      if (s.providerFirewall && !errors.length) {
        await db
          .update(servers)
          .set({ providerFirewall: null })
          .where(eq(servers.id, s.id));
        await syncAndNotify(s.id, "provider", []);
      }
      continue;
    }
    state.matched++;
    await db
      .update(servers)
      .set({ providerFirewall: hit.firewall })
      .where(eq(servers.id, s.id));
    await syncAndNotify(s.id, "provider", providerFindings(hit.firewall, s));
  }
  await db
    .update(orgIntegrations)
    .set({ hetznerState: state })
    .where(eq(orgIntegrations.organizationId, orgId));
  return state;
}

/** Firewalls change rarely; every 15 minutes, like the external check. */
export const HETZNER_INTERVAL_MS = 15 * 60 * 1000;

export async function syncDueHetzner(): Promise<void> {
  const orgs = await db
    .select({
      organizationId: orgIntegrations.organizationId,
      state: orgIntegrations.hetznerState,
    })
    .from(orgIntegrations)
    .where(isNotNull(orgIntegrations.hetznerTokens));
  for (const o of orgs) {
    const last = (o.state as HetznerState | null)?.checkedAt;
    if (last && Date.now() - new Date(last).getTime() < HETZNER_INTERVAL_MS)
      continue;
    await syncHetznerForOrg(o.organizationId).catch((e) =>
      console.error("[hetzner] sync failed:", e)
    );
  }
}
