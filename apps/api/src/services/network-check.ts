import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";
import { eq, isNotNull } from "drizzle-orm";
import { db, servers } from "db";
import { isTailnetHost, validateLiveUrl } from "../lib/live-check";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";

type Exposure = "critical" | "high" | "medium" | "low" | "info";

/**
 * The ports checked from the outside, and how bad it is when one answers
 * that is not expected. A fixed list on purpose: this is a health check of
 * our own servers, not a port scanner anyone can point anywhere.
 */
export const PORTS: Array<{
  port: number;
  service: string;
  exposure: Exposure;
  why?: string;
}> = [
  { port: 21, service: "FTP", exposure: "high", why: "Unencrypted logins." },
  {
    port: 22,
    service: "SSH",
    exposure: "low",
    why: "Fine with key-only auth and CrowdSec; better reachable only via VPN/Tailscale.",
  },
  {
    port: 23,
    service: "Telnet",
    exposure: "critical",
    why: "Unencrypted remote shell.",
  },
  { port: 25, service: "SMTP", exposure: "medium" },
  { port: 80, service: "HTTP", exposure: "info" },
  { port: 443, service: "HTTPS", exposure: "info" },
  {
    port: 445,
    service: "SMB",
    exposure: "critical",
    why: "File sharing, a classic ransomware entry point.",
  },
  {
    port: 1433,
    service: "MSSQL",
    exposure: "critical",
    why: "Database reachable from the internet.",
  },
  {
    port: 2375,
    service: "Docker API (plain)",
    exposure: "critical",
    why: "Unauthenticated Docker API = root on the host.",
  },
  { port: 2376, service: "Docker API (TLS)", exposure: "high" },
  { port: 2379, service: "etcd", exposure: "critical" },
  {
    port: 3000,
    service: "App / Grafana",
    exposure: "medium",
    why: "Usually an app port that should sit behind the reverse proxy.",
  },
  {
    port: 3001,
    service: "App / Uptime Kuma",
    exposure: "medium",
    why: "Usually an app port that should sit behind the reverse proxy.",
  },
  {
    port: 3306,
    service: "MySQL/MariaDB",
    exposure: "critical",
    why: "Database reachable from the internet.",
  },
  { port: 3389, service: "RDP", exposure: "high" },
  {
    port: 5432,
    service: "PostgreSQL",
    exposure: "critical",
    why: "Database reachable from the internet.",
  },
  { port: 5601, service: "Kibana", exposure: "high" },
  { port: 5672, service: "RabbitMQ", exposure: "high" },
  { port: 5900, service: "VNC", exposure: "high" },
  {
    port: 6379,
    service: "Redis",
    exposure: "critical",
    why: "Redis without auth allows remote code execution.",
  },
  { port: 8000, service: "HTTP alt", exposure: "medium" },
  { port: 8080, service: "HTTP alt / proxy", exposure: "medium" },
  { port: 8443, service: "HTTPS alt", exposure: "medium" },
  {
    port: 9000,
    service: "Portainer / MinIO",
    exposure: "high",
    why: "Admin interface reachable from the internet.",
  },
  { port: 9090, service: "Prometheus / Cockpit", exposure: "high" },
  {
    port: 9200,
    service: "Elasticsearch",
    exposure: "critical",
    why: "Search index, often without auth.",
  },
  { port: 10250, service: "Kubelet", exposure: "critical" },
  { port: 11211, service: "Memcached", exposure: "critical" },
  { port: 15672, service: "RabbitMQ admin", exposure: "high" },
  {
    port: 27017,
    service: "MongoDB",
    exposure: "critical",
    why: "Database reachable from the internet.",
  },
];

const CONNECT_TIMEOUT_MS = 3000;
const CONCURRENCY = 10;

export type PortResult = {
  port: number;
  open: boolean;
  latencyMs: number | null;
};

export type TlsResult = {
  port: number;
  validTo: string | null;
  daysRemaining: number | null;
  issuer: string | null;
  subject: string | null;
  /** null when checked against a bare IP (no name to match). */
  authorized: boolean | null;
  error: string | null;
};

export type NetworkState = {
  checkedAt: string;
  address: string;
  resolved: string[];
  ports: Array<PortResult & { service: string; expected: boolean }>;
  tls: TlsResult | null;
  error: string | null;
};

function tcpProbe(host: string, port: number): Promise<PortResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve({ port, open, latencyMs: open ? Date.now() - started : null });
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function tlsProbe(host: string, ip: string, port: number): Promise<TlsResult> {
  const isIp = net.isIP(host) !== 0;
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: ip,
      port,
      // SNI and name check only make sense for a hostname.
      servername: isIp ? undefined : host,
      rejectUnauthorized: false, // we report validity instead of failing
      timeout: 5000,
    });
    const fail = (error: string) => {
      socket.destroy();
      resolve({
        port,
        validTo: null,
        daysRemaining: null,
        issuer: null,
        subject: null,
        authorized: null,
        error,
      });
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      let authorized: boolean | null = isIp ? null : socket.authorized;
      if (!isIp && authorized) {
        // authorized covers the chain; the name is checked separately.
        authorized = tls.checkServerIdentity(host, cert) === undefined;
      }
      resolve({
        port,
        validTo: validTo?.toISOString() ?? null,
        daysRemaining: validTo
          ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
          : null,
        issuer: cert?.issuer?.O ?? cert?.issuer?.CN ?? null,
        subject: cert?.subject?.CN ?? null,
        authorized,
        error:
          isIp || socket.authorized
            ? null
            : String(socket.authorizationError ?? "untrusted certificate"),
      });
      socket.end();
    });
    socket.once("timeout", () => fail("TLS handshake timed out"));
    socket.once("error", (e) => fail(e.message));
  });
}

/**
 * An address may be an IP or a hostname. Both go through the live-URL rules
 * (no loopback, link-local, metadata or private ranges unless allowed), and a
 * hostname is resolved and every address it points to is checked too —
 * otherwise `internal.example.com → 10.0.0.5` would walk right past.
 */
export async function resolveAddress(
  address: string
): Promise<{ ok: true; ips: string[] } | { ok: false; reason: string }> {
  const host = address.trim().replace(/^\[|\]$/g, "");
  if (!host || /[\s/]/.test(host)) {
    return {
      ok: false,
      reason: "Enter an IP address or a hostname, without http:// or a path.",
    };
  }
  const asUrl = net.isIPv6(host) ? `https://[${host}]` : `https://${host}`;
  const direct = validateLiveUrl(asUrl);
  if (!direct.ok) return { ok: false, reason: direct.reason };
  if (net.isIP(host)) return { ok: true, ips: [host] };
  let ips: string[];
  try {
    ips = (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return { ok: false, reason: `${host} does not resolve.` };
  }
  for (const ip of ips) {
    const v = validateLiveUrl(
      net.isIPv6(ip) ? `https://[${ip}]` : `https://${ip}`
    );
    if (!v.ok)
      return { ok: false, reason: `${host} resolves to ${ip}: ${v.reason}` };
  }
  return { ok: true, ips };
}

async function probeAll(ip: string): Promise<PortResult[]> {
  const results: PortResult[] = [];
  const queue = [...PORTS.map((p) => p.port)];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let port = queue.shift(); port !== undefined; port = queue.shift()) {
        results.push(await tcpProbe(ip, port));
      }
    })
  );
  return results.sort((a, b) => a.port - b.port);
}

export async function checkAddress(
  address: string,
  expectedPorts: number[],
  /** Ports the agent saw published by Docker — exotic ones included. */
  publishedPorts: number[] = []
): Promise<NetworkState> {
  const checkedAt = new Date().toISOString();
  const resolved = await resolveAddress(address);
  if (!resolved.ok) {
    return {
      checkedAt,
      address,
      resolved: [],
      ports: [],
      tls: null,
      error: resolved.reason,
    };
  }
  const ip = resolved.ips[0]!;
  const probed = await probeAll(ip);
  // Expected ports outside the standard list are probed as well.
  const extra = [...new Set([...expectedPorts, ...publishedPorts])]
    .filter((p) => p > 0 && p < 65536 && !PORTS.some((x) => x.port === p))
    .slice(0, 50);
  const extraResults = await Promise.all(extra.map((p) => tcpProbe(ip, p)));
  const all = [...probed, ...extraResults];
  const ports = all.map((r) => ({
    ...r,
    service: PORTS.find((p) => p.port === r.port)?.service ?? "custom",
    expected: expectedPorts.includes(r.port),
  }));
  const https = all.find((r) => r.port === 443 && r.open);
  return {
    checkedAt,
    address,
    resolved: resolved.ips,
    ports,
    tls: https ? await tlsProbe(address.trim(), ip, 443) : null,
    error: null,
  };
}

export function networkFindings(state: NetworkState): FindingInput[] {
  if (state.error) {
    return [
      {
        fingerprint: "address",
        severity: "medium",
        title: "The server address cannot be checked",
        detail: state.error,
        target: state.address,
      },
    ];
  }
  const open = state.ports.filter((p) => p.open);
  if (open.length === 0) {
    // One finding for "the server is gone", not one per expected port.
    return [
      {
        fingerprint: "unreachable",
        severity: "critical",
        title: "Server is not reachable on any port",
        detail:
          "No port answered. The server is down, or a firewall drops everything from here.",
        target: state.address,
      },
    ];
  }
  const out: FindingInput[] = [];
  for (const p of state.ports) {
    if (p.expected && !p.open) {
      out.push({
        fingerprint: `expected:${p.port}`,
        severity: "high",
        title: `Port ${p.port} (${p.service}) is not reachable`,
        detail:
          "This port is expected to answer but did not — the service, the firewall or the whole server may be down.",
        target: `${state.address}:${p.port}`,
      });
    }
  }
  // Checked over Tailscale, an open port says who *on the tailnet* can reach
  // it — governed by ACLs, not the internet. Worth knowing, not an alarm;
  // internet exposure needs the public IP.
  const tailnet =
    isTailnetHost(state.address) ||
    (state.resolved.length > 0 && state.resolved.every(isTailnetHost));
  for (const p of open) {
    if (p.expected) continue;
    const meta = PORTS.find((x) => x.port === p.port);
    const exposure = meta?.exposure ?? "medium";
    if (exposure === "info") continue;
    out.push({
      fingerprint: `open:${p.port}`,
      severity: tailnet ? "low" : exposure,
      title: tailnet
        ? `${p.service} (port ${p.port}) is reachable over the tailnet`
        : `${p.service} (port ${p.port}) is reachable from the internet`,
      detail: tailnet
        ? "Every tailnet node your ACLs allow can reach it. Restrict it in the Tailscale ACLs if that is more than intended, or add it to the expected ports. Check the public IP as well to see what the internet reaches."
        : [
            meta?.why,
            "Close it in the firewall, bind the service to localhost, or reach it via VPN/Tailscale. If it is meant to be public, add it to the expected ports.",
          ]
            .filter(Boolean)
            .join(" "),
      target: `${state.address}:${p.port}`,
    });
  }
  const t = state.tls;
  if (t) {
    if (t.error && t.authorized === null && !t.validTo) {
      out.push({
        fingerprint: "tls:handshake",
        severity: "medium",
        title: "TLS handshake on port 443 failed",
        detail: t.error,
        target: `${state.address}:443`,
      });
    } else if (t.authorized === false) {
      out.push({
        fingerprint: "tls:invalid",
        severity: "high",
        title: "TLS certificate is not trusted or does not match the name",
        detail: t.error,
        target: `${state.address}:443`,
      });
    }
    if (t.daysRemaining != null && t.daysRemaining <= 21) {
      out.push({
        fingerprint: "tls:expiry",
        severity: t.daysRemaining <= 7 ? "high" : "medium",
        title:
          t.daysRemaining < 0
            ? "TLS certificate has expired"
            : `TLS certificate expires in ${t.daysRemaining} days`,
        detail: t.issuer ? `Issued by ${t.issuer}.` : null,
        target: `${state.address}:443`,
      });
    }
  }
  return out;
}

/** Check one server now and update its findings. */
export async function runNetworkCheck(
  serverId: string
): Promise<NetworkState | null> {
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, serverId));
  if (!server?.address) return null;
  const risks = (
    server.lastReport as {
      dockerRisks?: {
        containers?: Array<{
          published?: Array<{ hostIp: string; hostPort: number }>;
        }>;
        servicePorts?: Array<{ hostPort: number }>;
      };
    } | null
  )?.dockerRisks;
  const published = [
    ...(risks?.containers ?? []).flatMap((c) =>
      (c.published ?? [])
        .filter((p) => ["", "0.0.0.0", "::"].includes(p.hostIp))
        .map((p) => p.hostPort)
    ),
    ...(risks?.servicePorts ?? []).map((s) => s.hostPort),
  ];
  const state = await checkAddress(
    server.address,
    server.expectedPorts ?? [],
    published
  );
  await db
    .update(servers)
    .set({ networkState: state })
    .where(eq(servers.id, serverId));
  await syncAndNotify(serverId, "network", networkFindings(state));
  return state;
}

/** Every 15 minutes is plenty for "is a database suddenly public?". */
export const NETWORK_INTERVAL_MS = 15 * 60 * 1000;

export async function runDueNetworkChecks(): Promise<void> {
  const rows = await db
    .select()
    .from(servers)
    .where(isNotNull(servers.address));
  for (const s of rows) {
    const last = (s.networkState as NetworkState | null)?.checkedAt;
    if (last && Date.now() - new Date(last).getTime() < NETWORK_INTERVAL_MS)
      continue;
    await runNetworkCheck(s.id).catch((e) =>
      console.error(`[network] check of ${s.name} failed:`, e)
    );
  }
}
