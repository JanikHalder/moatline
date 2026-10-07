import { z } from "zod";
import type { FindingInput } from "../lib/server-findings";
import { isOlderVersion } from "../lib/version";
import { PORTS, type NetworkState } from "./network-check";
import {
  describeSources,
  portAccess,
  type PortAccess,
  type ProviderFirewall,
} from "./hetzner";

const str = (max: number) => z.string().max(max);
const optStr = (max: number) => z.string().max(max).nullish();

/** The security sections of an agent report (agent 1.4.0+). */
export const securitySectionsSchema = {
  hardening: z
    .object({
      ssh: z.record(str(40), str(100)).nullish(),
      sshSource: optStr(40),
      ufw: z.enum(["active", "inactive", "not installed"]).nullish(),
      fail2ban: optStr(40),
    })
    .nullish(),
  access: z
    .object({
      sshKeys: z
        .array(
          z.object({
            user: str(64),
            type: str(64),
            fingerprint: str(100),
            comment: optStr(100),
          })
        )
        .max(500),
      privilegedGroups: z.record(str(20), z.array(str(64)).max(200)),
      uid0: z.array(str(64)).max(20),
    })
    .nullish(),
  staleLibraries: z
    .object({
      units: z
        .array(
          z.object({
            unit: str(200),
            processes: z.number().int().nonnegative(),
            libraries: z.array(str(200)).max(10),
          })
        )
        .max(100),
      partial: z.boolean().nullish(),
    })
    .nullish(),
  listeners: z
    .array(
      z.object({
        address: str(64),
        port: z.number().int().min(0).max(65535),
        process: optStr(64),
      })
    )
    .max(300)
    .nullish(),
  dockerRisks: z
    .object({
      containers: z
        .array(
          z.object({
            name: str(200),
            image: optStr(300),
            privileged: z.boolean(),
            dockerSocket: z.boolean(),
            hostNetwork: z.boolean(),
            capAdd: z.array(str(64)).max(20),
            published: z
              .array(
                z.object({
                  hostIp: str(64),
                  hostPort: z.number().int(),
                  containerPort: str(32),
                })
              )
              .max(50),
            // Agent 1.5.0+
            networks: z.array(str(100)).max(20).nullish(),
            project: optStr(200),
            hostMounts: z
              .array(z.object({ source: str(200), rw: z.boolean() }))
              .max(10)
              .nullish(),
          })
        )
        .max(200),
      networks: z
        .array(
          z.object({
            name: str(100),
            driver: optStr(40),
            internal: z.boolean(),
            icc: z.boolean(),
          })
        )
        .max(100)
        .nullish(),
      servicePorts: z
        .array(
          z.object({
            name: str(200),
            hostPort: z.number().int(),
            containerPort: str(32),
          })
        )
        .max(200),
    })
    .nullish(),
  compromise: z
    .object({
      hits: z.array(z.object({ kind: str(40), detail: str(300) })).max(50),
    })
    .nullish(),
};

export type SecuritySections = z.infer<
  z.ZodObject<typeof securitySectionsSchema>
>;

export type AccessBaseline = {
  keys: string[];
  groups: string[];
  uid0: string[];
};

/** Stable identities for everything that grants access. */
export function accessIdentities(
  access: NonNullable<SecuritySections["access"]>
): AccessBaseline {
  return {
    keys: access.sshKeys.map((k) => `${k.user}|${k.fingerprint}`),
    groups: Object.entries(access.privilegedGroups).flatMap(([g, users]) =>
      users.map((u) => `${g}|${u}`)
    ),
    uid0: access.uid0,
  };
}

const ALL_INTERFACES = new Set(["0.0.0.0", "::", ""]);
const WEB = new Set([80, 443]);

function exposureOf(port: number) {
  return PORTS.find((p) => p.port === port);
}

/** Dokploy and Traefik need the Docker socket — expected, not alarming. */
const DATABASE_IMAGE =
  /(^|[/:-])(postgres|postgis|timescaledb|mysql|mariadb|percona|mongo|mongodb|redis|valkey|keydb|dragonfly|elasticsearch|opensearch|clickhouse|cassandra|scylla|couchdb|influxdb|neo4j|rabbitmq|memcached|minio|nats)([/:@-]|$)/i;

export function isDatabaseImage(image: string | null | undefined): boolean {
  return !!image && DATABASE_IMAGE.test(image.split("@")[0]!);
}

/** Networks that do not connect containers to each other. */
const NOT_SHARED = new Set(["host", "none", "ingress", "docker_gwbridge"]);

const DANGEROUS_CAPS: Record<string, FindingInput["severity"]> = {
  ALL: "high",
  SYS_ADMIN: "high",
  SYS_MODULE: "high",
  SYS_RAWIO: "high",
  SYS_PTRACE: "medium",
  DAC_READ_SEARCH: "medium",
  NET_ADMIN: "medium",
  BPF: "medium",
};

/** The app a container belongs to: compose project, stack, or service. */
function appOf(c: { name: string; project?: string | null }): string {
  return c.project || c.name.replace(/[._-]\d+([._-][a-z0-9]+)?$/i, "");
}

function isPlatform(c: { name: string; image?: string | null }): boolean {
  return /traefik/i.test(c.image ?? "") || /^dokploy(-traefik)?$/i.test(c.name);
}

function needsDockerSocket(name: string, image?: string | null): boolean {
  return (
    /^dokploy/i.test(name) ||
    /traefik|portainer\/agent|dokploy/i.test(image ?? "")
  );
}

export function securityFindings(
  report: SecuritySections,
  ctx: {
    baseline: AccessBaseline | null;
    networkState?: NetworkState | null;
    providerFirewall?: ProviderFirewall | null;
    expectedPorts?: number[];
    crowdsecAvailable?: boolean;
    rebootRequired?: boolean;
    agentVersion?: string | null;
  }
): FindingInput[] {
  const out: FindingInput[] = [];

  // ---- SSH, firewall, brute-force protection
  const h = report.hardening;
  const ssh = h?.ssh ?? null;
  if (ssh) {
    if (ssh.permitemptypasswords === "yes") {
      out.push({
        fingerprint: "ssh:empty-passwords",
        severity: "critical",
        title: "SSH accepts empty passwords",
        detail: "Set `PermitEmptyPasswords no` in /etc/ssh/sshd_config.",
      });
    }
    if (ssh.passwordauthentication === "yes") {
      out.push({
        fingerprint: "ssh:password-auth",
        severity: "high",
        title: "SSH accepts passwords",
        detail:
          "Passwords can be guessed; keys cannot. Setup tab → 1. Harden the server (with your public key) turns password login off. Hardened before and still on? A drop-in such as /etc/ssh/sshd_config.d/50-cloud-init.conf wins over sshd_config (sshd keeps the first value) — the current harden script writes 00-harden-server.conf, which loads first.",
      });
    }
    if (ssh.permitrootlogin === "yes") {
      out.push({
        fingerprint: "ssh:root-password",
        severity: "high",
        title: "root can log in over SSH with a password",
        detail:
          "Setup tab → 1. Harden the server sets `PermitRootLogin prohibit-password` (keys only). Check /etc/ssh/sshd_config.d/ for a drop-in that sets it back to yes.",
      });
    }
  }
  const hetzner = ctx.providerFirewall?.firewalls.filter(
    (f) => f.status === "applied"
  );
  if (h?.ufw && h.ufw !== "active") {
    // A provider firewall may cover it — the Hetzner API or the external
    // check tells.
    const external = ctx.networkState;
    const onlyExpected =
      !!external &&
      !external.error &&
      external.ports.every((p) => !p.open || p.expected || p.port === 22);
    out.push({
      fingerprint: "firewall:off",
      severity: hetzner?.length || onlyExpected ? "low" : "medium",
      title:
        h.ufw === "not installed"
          ? "No host firewall (UFW not installed)"
          : "Host firewall (UFW) is off",
      detail: hetzner?.length
        ? `The Hetzner firewall (${hetzner.map((f) => f.name).join(", ")}) filters in front of it. A host firewall still protects if that one is changed.`
        : onlyExpected
          ? "From outside only the expected ports answer, so a provider firewall (Hetzner, IONOS, …) seems to cover it. A host firewall still protects if that one is changed."
          : "Every listening service is reachable unless a provider firewall blocks it. Setup tab → 1. Harden the server turns UFW on.",
    });
  }
  if (
    h?.fail2ban &&
    h.fail2ban !== "active" &&
    ctx.crowdsecAvailable === false
  ) {
    out.push({
      fingerprint: "bruteforce:none",
      severity: "medium",
      title: "Nothing blocks SSH brute-force attempts",
      detail: "Neither fail2ban nor CrowdSec is running.",
    });
  }

  // ---- Access: anything not in the accepted baseline
  if (report.access && ctx.baseline) {
    const now = accessIdentities(report.access);
    const keyInfo = new Map(
      report.access.sshKeys.map((k) => [`${k.user}|${k.fingerprint}`, k])
    );
    for (const id of now.keys) {
      if (ctx.baseline.keys.includes(id)) continue;
      const k = keyInfo.get(id)!;
      out.push({
        fingerprint: `access:key:${id}`,
        severity: "high",
        title: `New SSH key for ${k.user}${k.comment ? ` (${k.comment})` : ""}`,
        detail: `${k.type} ${k.fingerprint}. If you added it, accept it on the server page; if not, someone has a way in — remove it from ~${k.user}/.ssh/authorized_keys and investigate.`,
        target: k.user,
      });
    }
    for (const id of now.groups) {
      if (ctx.baseline.groups.includes(id)) continue;
      const [group, user] = id.split("|");
      out.push({
        fingerprint: `access:group:${id}`,
        severity: "high",
        title: `${user} was added to the ${group} group`,
        detail:
          group === "docker"
            ? "Members of the docker group are root on this host."
            : "Members of this group can become root.",
        target: user,
      });
    }
    for (const u of now.uid0) {
      if (ctx.baseline.uid0.includes(u)) continue;
      out.push({
        fingerprint: `access:uid0:${u}`,
        severity: "critical",
        title: `New account with uid 0: ${u}`,
        detail:
          "A second root account is a classic backdoor. Check /etc/passwd immediately.",
        target: u,
      });
    }
  }

  // ---- Services still running replaced libraries
  const stale = report.staleLibraries?.units ?? [];
  if (stale.length) {
    out.push({
      fingerprint: "stale-libraries",
      severity: "medium",
      title: `${stale.length} ${stale.length === 1 ? "service runs" : "services run"} replaced libraries`,
      detail: [
        "An update replaced these libraries, but the running processes still use the old ones until they restart:",
        stale
          .slice(0, 15)
          .map((u) => `${u.unit} (${u.libraries.join(", ")})`)
          .join("; "),
        ctx.rebootRequired
          ? "The pending reboot will take care of it."
          : `Fix: systemctl restart ${stale
              .filter((u) => u.unit.endsWith(".service"))
              .map((u) => u.unit)
              .slice(0, 10)
              .join(" ")}`,
      ].join("\n"),
    });
  }

  // ---- Docker: what weakens the host
  // host port → who publishes it, and which service port is behind it
  // (Dokploy's "external port" maps e.g. 6352 → Postgres on 5432).
  const published = new Map<number, string[]>();
  const behind = new Map<number, number>();
  const note = (hostPort: number, containerPort: string) => {
    const inner = Number(containerPort.split("/")[0]);
    if (Number.isFinite(inner)) behind.set(hostPort, inner);
  };
  for (const c of report.dockerRisks?.containers ?? []) {
    if (c.privileged) {
      out.push({
        fingerprint: `docker:privileged:${c.name}`,
        severity: "high",
        title: `Container ${c.name} runs privileged`,
        detail:
          "A privileged container can take over the host. Drop `privileged: true` and add only the capabilities it needs.",
        target: c.image ?? null,
      });
    }
    if (c.dockerSocket) {
      const expected = needsDockerSocket(c.name, c.image);
      out.push({
        fingerprint: `docker:socket:${c.name}`,
        severity: expected ? "low" : "high",
        title: `Container ${c.name} has the Docker socket`,
        detail: expected
          ? "Expected for Dokploy/Traefik — but whoever controls this container controls the host, so keep it updated."
          : "Access to /var/run/docker.sock is root on the host. Remove the mount unless the container manages Docker by design.",
        target: c.image ?? null,
      });
    }
    if (c.hostNetwork && !needsDockerSocket(c.name, c.image)) {
      out.push({
        fingerprint: `docker:host-network:${c.name}`,
        severity: "medium",
        title: `Container ${c.name} uses the host network`,
        detail:
          "It sees and binds every host interface directly; its ports are not isolated.",
        target: c.image ?? null,
      });
    }
    for (const m of c.hostMounts ?? []) {
      if (!m.rw) continue;
      const path = m.source.replace(/\/+$/, "") || "/";
      out.push({
        fingerprint: `docker:mount:${c.name}:${path}`,
        severity: path === "/home" ? "medium" : "high",
        title: `Container ${c.name} can write the host's ${path}`,
        detail: `A writable bind mount of ${path} lets the container change the host (cron, SSH keys, binaries, other containers' data). Mount only the directory it needs, read-only where possible (\`:ro\`).`,
        target: c.image ?? null,
      });
    }
    for (const cap of c.capAdd) {
      const key = cap.replace(/^CAP_/i, "").toUpperCase();
      const severity = DANGEROUS_CAPS[key];
      if (!severity || needsDockerSocket(c.name, c.image)) continue;
      out.push({
        fingerprint: `docker:cap:${c.name}:${key}`,
        severity,
        title: `Container ${c.name} has ${key === "ALL" ? "every capability" : `CAP_${key}`}`,
        detail:
          key === "ALL" || key === "SYS_ADMIN" || key === "SYS_MODULE"
            ? "That is close to privileged: the container can escape to the host. Drop it unless the container must manage the kernel."
            : "Extra kernel privileges widen what an attacker inside the container can do. Drop it unless it is needed.",
        target: c.image ?? null,
      });
    }
    for (const p of c.published) {
      if (!ALL_INTERFACES.has(p.hostIp) || !p.hostPort) continue;
      const list = published.get(p.hostPort) ?? [];
      list.push(c.name);
      published.set(p.hostPort, list);
      note(p.hostPort, p.containerPort);
    }
  }
  for (const s of report.dockerRisks?.servicePorts ?? []) {
    const list = published.get(s.hostPort) ?? [];
    list.push(`${s.name} (service)`);
    published.set(s.hostPort, list);
    note(s.hostPort, s.containerPort);
  }
  const expected = new Set(ctx.expectedPorts ?? [80, 443]);
  for (const [port, owners] of published) {
    if (WEB.has(port) || expected.has(port)) continue;
    const inner = behind.get(port);
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const meta = [exposureOf(port), inner ? exposureOf(inner) : undefined]
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => rank[a.exposure] - rank[b.exposure])[0];
    const full =
      meta?.exposure === "critical"
        ? "critical"
        : meta?.exposure === "high"
          ? "high"
          : "medium";
    // What the external check saw on this exact port: open, blocked, or
    // not known (no public address set / not checked yet).
    const seen = ctx.networkState?.error
      ? undefined
      : ctx.networkState?.ports.find((p) => p.port === port);
    // The Hetzner firewall knows what everyone else gets, not just us.
    const fw: PortAccess | null = ctx.providerFirewall
      ? portAccess(ctx.providerFirewall, port)
      : null;
    const open =
      !!seen?.open || fw?.access === "world" || fw?.access === "unfiltered";
    const blocked = !open && (fw ? true : seen ? !seen.open : false);
    const what = `Port ${port}${meta ? ` (${meta.service}${inner && inner !== port ? ` on ${inner}` : ""})` : ""}`;
    const fix = `Bind it to the Tailscale or loopback address ("100.x.y.z:${port}:…" or "127.0.0.1:${port}:…"), use \`tailscale serve\`, reach it over the Dokploy network, or turn off "external port" on the Dokploy database.`;
    out.push({
      fingerprint: `docker:published:${port}`,
      severity: blocked ? (full === "critical" ? "medium" : "low") : full,
      title: open
        ? `${what} is reachable from the internet`
        : fw?.access === "restricted"
          ? `${what} is published on all interfaces — the firewall allows only some IPs`
          : blocked
            ? `${what} is published on all interfaces — only a firewall blocks it`
            : `${what} is published by Docker on all interfaces`,
      detail: [
        `${owners.join(", ")}.`,
        seen?.open
          ? "The external check reached it from outside. Docker opens published ports past UFW."
          : fw?.access === "world"
            ? `The Hetzner firewall "${fw.firewall}" allows it from anywhere (0.0.0.0/0), and Docker opens published ports past UFW.`
            : fw?.access === "unfiltered"
              ? "No Hetzner firewall is applied to this server, and Docker opens published ports past UFW."
              : fw?.access === "restricted"
                ? `The Hetzner firewall "${fw.firewall}" lets it in only from ${describeSources(fw.sources)}. Fine if those are yours — but the service still sits on the public interface.`
                : fw?.access === "closed"
                  ? `The Hetzner firewall (${fw.firewall}) has no rule for it, so it is blocked today. Add a rule and it is public: Docker opens published ports past UFW.`
                  : blocked
                    ? "From outside it does not answer today, so a provider firewall (Hetzner, IONOS, …) catches it. Change that rule and it is public: Docker opens published ports past UFW."
                    : "Docker opens published ports past UFW — reachable from the internet unless a provider firewall blocks it. Set the server's public address so the external check can tell.",
        fix,
      ].join("\n"),
    });
  }

  // ---- Docker networks: who can reach whose database
  const containers = report.dockerRisks?.containers ?? [];
  const netInfo = new Map(
    (report.dockerRisks?.networks ?? []).map((n) => [n.name, n])
  );
  const members = new Map<string, typeof containers>();
  for (const c of containers) {
    for (const n of c.networks ?? []) {
      if (NOT_SHARED.has(n)) continue;
      const list = members.get(n) ?? [];
      list.push(c);
      members.set(n, list);
    }
  }
  for (const [network, list] of members) {
    if (netInfo.get(network)?.icc === false) continue; // isolated by design
    const dbs = list.filter((c) => isDatabaseImage(c.image));
    const apps = [
      ...new Set(
        list
          .filter((c) => !isDatabaseImage(c.image) && !isPlatform(c))
          .map(appOf)
      ),
    ];
    if (network === "bridge") {
      if (list.length > 1) {
        out.push({
          fingerprint: "docker:default-bridge",
          severity: "low",
          title: `${list.length} containers share Docker's default bridge`,
          detail: `${list
            .map((c) => c.name)
            .slice(0, 15)
            .join(
              ", "
            )}.\nOn the default bridge every container reaches every other one. Give each app its own network (compose does that by default).`,
        });
      }
      continue;
    }
    if (dbs.length === 0 || apps.length < 2) continue;
    const dokploy = dbs.filter((c) =>
      /^dokploy-(postgres|redis)/i.test(c.name)
    );
    out.push({
      fingerprint: `docker:shared-network:${network}`,
      severity: "medium",
      title: `${apps.length} apps share the network ${network} with ${dbs.length} ${dbs.length === 1 ? "database" : "databases"}`,
      detail: [
        `Databases: ${dbs
          .map((c) => c.name)
          .slice(0, 12)
          .join(", ")}.`,
        `Apps: ${apps.slice(0, 15).join(", ")}${apps.length > 15 ? ` (+${apps.length - 15})` : ""}.`,
        dokploy.length
          ? `Dokploy's own ${dokploy.map((c) => c.name).join(" and ")} ${dokploy.length === 1 ? "is" : "are"} on it too — whoever takes over one app can talk to them.`
          : "Whoever takes over one app can talk to every database here.",
        network === "dokploy-network"
          ? "In Dokploy compose apps, attach only the web service to dokploy-network and keep the database on the project's own network. Databases created in Dokploy always join dokploy-network — give each a strong, unique password and its own user."
          : "Put each app and its database on their own network; only the service the reverse proxy needs joins the shared one. Every database needs its own strong password.",
      ].join("\n"),
    });
  }

  // ---- Services listening on every interface (not via Docker)
  const ext = ctx.networkState;
  for (const l of report.listeners ?? []) {
    if (!ALL_INTERFACES.has(l.address)) continue;
    if (l.port === 22 || WEB.has(l.port) || expected.has(l.port)) continue;
    if (published.has(l.port)) continue; // reported above
    const reachable = ext?.ports.find((p) => p.port === l.port)?.open;
    if (reachable) continue; // the external check already raises it
    // An open Hetzner rule is raised by the provider findings.
    if (
      ctx.providerFirewall &&
      portAccess(ctx.providerFirewall, l.port).access === "world"
    )
      continue;
    out.push({
      fingerprint: `listener:${l.port}`,
      severity: "low",
      title: `${l.process ?? "A service"} listens on port ${l.port} on all interfaces`,
      detail: ext
        ? "Not reachable from outside right now — a firewall blocks it. Bind it to 127.0.0.1 so it stays private even if a firewall rule changes."
        : "Set the server's public address (Settings) so the external check can tell whether it is reachable. If it only serves this host, bind it to 127.0.0.1.",
    });
  }

  // ---- Signs of compromise
  const SEVERITY: Record<string, FindingInput["severity"]> = {
    "miner-process": "critical",
    "pool-connection": "critical",
    "ld-preload": "critical",
    "cron-download-exec": "critical",
    "temp-executable": "high",
    "deleted-executable": "medium",
  };
  const TITLE: Record<string, string> = {
    "miner-process": "Possible cryptominer running",
    "pool-connection": "Connection to a mining-pool port",
    "ld-preload": "Global library preload (rootkit technique)",
    "cron-download-exec": "Cron job downloads and executes code",
    "temp-executable": "Program running from a temp directory",
    "deleted-executable": "Program running from a deleted file",
  };
  for (const hit of report.compromise?.hits ?? []) {
    // Agents before 1.5.1 could not tell the kernel's own kswapd0 thread
    // from a miner using the name, and every host has one.
    if (
      ctx.agentVersion &&
      isOlderVersion(ctx.agentVersion, "1.5.1") &&
      hit.kind === "miner-process" &&
      /^process 'kswapd0' \(pid \d+\)$/.test(hit.detail)
    )
      continue;
    out.push({
      fingerprint: `compromise:${hit.kind}:${hit.detail}`,
      severity: SEVERITY[hit.kind] ?? "high",
      title: TITLE[hit.kind] ?? "Suspicious activity",
      detail: `${hit.detail}\nIf you do not recognise it: isolate the server (provider firewall), keep it running for analysis, rotate credentials that were on it.`,
    });
  }
  return out;
}
