import { describe, it, expect } from "vitest";
import {
  accessIdentities,
  securityFindings,
  type SecuritySections,
} from "./security-findings";

const access = {
  sshKeys: [
    {
      user: "root",
      type: "ssh-ed25519",
      fingerprint: "SHA256:known",
      comment: "alex@laptop",
    },
  ],
  privilegedGroups: { sudo: ["ubuntu"], docker: [] as string[] },
  uid0: ["root"],
};

describe("securityFindings", () => {
  it("is quiet for a hardened server", () => {
    const f = securityFindings(
      {
        hardening: {
          ssh: {
            passwordauthentication: "no",
            permitrootlogin: "prohibit-password",
          },
          ufw: "active",
          fail2ban: "active",
        },
        access,
      },
      { baseline: accessIdentities(access) }
    );
    expect(f).toEqual([]);
  });

  it("flags password SSH, root password login and a missing firewall", () => {
    const f = securityFindings(
      {
        hardening: {
          ssh: { passwordauthentication: "yes", permitrootlogin: "yes" },
          ufw: "inactive",
          fail2ban: "inactive",
        },
      },
      { baseline: null, crowdsecAvailable: false }
    );
    expect(f.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["ssh:password-auth", "high"],
      ["ssh:root-password", "high"],
      ["firewall:off", "medium"],
      ["bruteforce:none", "medium"],
    ]);
  });

  it("raises access added after the baseline", () => {
    const now = {
      ...access,
      sshKeys: [
        ...access.sshKeys,
        {
          user: "root",
          type: "ssh-rsa",
          fingerprint: "SHA256:new",
          comment: "x@unknown",
        },
      ],
      privilegedGroups: { sudo: ["ubuntu"], docker: ["mallory"] },
      uid0: ["root", "toor"],
    };
    const f = securityFindings(
      { access: now },
      { baseline: accessIdentities(access) }
    );
    expect(f.map((x) => [x.severity, x.title])).toEqual([
      ["high", "New SSH key for root (x@unknown)"],
      ["high", "mallory was added to the docker group"],
      ["critical", "New account with uid 0: toor"],
    ]);
  });

  it("finds Docker ports that bypass the firewall, rated by service", () => {
    const report: SecuritySections = {
      dockerRisks: {
        containers: [
          {
            name: "dokploy-traefik",
            image: "traefik:v3",
            privileged: false,
            dockerSocket: true,
            hostNetwork: false,
            capAdd: [],
            published: [
              { hostIp: "0.0.0.0", hostPort: 443, containerPort: "443/tcp" },
            ],
          },
          {
            name: "debug",
            image: "alpine",
            privileged: true,
            dockerSocket: false,
            hostNetwork: false,
            capAdd: [],
            published: [],
          },
        ],
        servicePorts: [
          { name: "app-db", hostPort: 6352, containerPort: "5432/tcp" },
          { name: "cache", hostPort: 6379, containerPort: "6379/tcp" },
        ],
      },
    };
    const f = securityFindings(report, { baseline: null });
    expect(f.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["docker:socket:dokploy-traefik", "low"],
      ["docker:privileged:debug", "high"],
      ["docker:published:6352", "critical"],
      ["docker:published:6379", "critical"],
    ]);
  });

  it("treats signs of compromise as critical", () => {
    const f = securityFindings(
      {
        compromise: {
          hits: [
            { kind: "miner-process", detail: "process 'xmrig' (pid 1100)" },
            {
              kind: "cron-download-exec",
              detail: "/etc/cron.d/x: curl … | sh",
            },
          ],
        },
      },
      { baseline: null }
    );
    expect(f.map((x) => [x.severity, x.title])).toEqual([
      ["critical", "Possible cryptominer running"],
      ["critical", "Cron job downloads and executes code"],
    ]);
  });
});

describe("published database ports and the external check", () => {
  const report: SecuritySections = {
    dockerRisks: {
      containers: [],
      servicePorts: [
        { name: "mongo", hostPort: 27017, containerPort: "27017/tcp" },
      ],
    },
  };
  const state = (open: boolean) => ({
    checkedAt: "",
    address: "203.0.113.10",
    resolved: [],
    tls: null,
    error: null,
    ports: [
      {
        port: 27017,
        open,
        latencyMs: null,
        service: "MongoDB",
        expected: false,
      },
    ],
  });

  it("is critical when the internet reaches it", () => {
    const [f] = securityFindings(report, {
      baseline: null,
      networkState: state(true),
    });
    expect(f).toMatchObject({
      severity: "critical",
      title: "Port 27017 (MongoDB) is reachable from the internet",
    });
  });

  it("is fragile, not critical, when only a provider firewall blocks it", () => {
    const [f] = securityFindings(report, {
      baseline: null,
      networkState: state(false),
    });
    expect(f).toMatchObject({ severity: "medium" });
    expect(f!.title).toContain("only a firewall blocks it");
    expect(f!.detail).toContain("tailscale serve");
  });

  it("ignores ports bound to the Tailscale address", () => {
    const f = securityFindings(
      {
        dockerRisks: {
          containers: [
            {
              name: "mongo",
              image: "mongo:7",
              privileged: false,
              dockerSocket: false,
              hostNetwork: false,
              capAdd: [],
              published: [
                {
                  hostIp: "100.81.123.101",
                  hostPort: 27017,
                  containerPort: "27017/tcp",
                },
              ],
            },
          ],
          servicePorts: [],
        },
      },
      { baseline: null }
    );
    expect(f).toEqual([]);
  });
});

describe("Docker networks, mounts and capabilities", () => {
  const c = (
    name: string,
    image: string,
    networks: string[],
    extra: Record<string, unknown> = {}
  ) => ({
    name,
    image,
    privileged: false,
    dockerSocket: false,
    hostNetwork: false,
    capAdd: [] as string[],
    published: [],
    networks,
    project: null,
    ...extra,
  });

  it("flags databases that several apps can reach", () => {
    const f = securityFindings(
      {
        dockerRisks: {
          containers: [
            c("dokploy-traefik", "traefik:v3", ["dokploy-network"]),
            c("dokploy-redis.1.abc", "redis:7", ["dokploy-network"]),
            c("shop-web-1", "ghcr.io/x/shop:1", ["dokploy-network"], {
              project: "shop",
            }),
            c("blog.1.xyz", "ghcr.io/x/blog:2", ["dokploy-network"], {
              project: "blog",
            }),
            c("shop-db-1", "postgres:16", ["dokploy-network", "shop_default"], {
              project: "shop",
            }),
          ],
          servicePorts: [],
        },
      },
      { baseline: null }
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      fingerprint: "docker:shared-network:dokploy-network",
      severity: "medium",
      title: "2 apps share the network dokploy-network with 2 databases",
    });
    expect(f[0]!.detail).toContain("Dokploy's own dokploy-redis.1.abc");
    expect(f[0]!.detail).toContain("attach only the web service");
  });

  it("is quiet for one app with its own database", () => {
    const f = securityFindings(
      {
        dockerRisks: {
          containers: [
            c("shop-web-1", "shop:1", ["shop_default"], { project: "shop" }),
            c("shop-db-1", "mongo:7", ["shop_default"], { project: "shop" }),
          ],
          servicePorts: [],
        },
      },
      { baseline: null }
    );
    expect(f).toEqual([]);
  });

  it("respects networks with inter-container traffic off", () => {
    const f = securityFindings(
      {
        dockerRisks: {
          containers: [
            c("a-1", "a:1", ["shared"], { project: "a" }),
            c("b-1", "b:1", ["shared"], { project: "b" }),
            c("db", "mariadb:11", ["shared"]),
          ],
          networks: [
            { name: "shared", driver: "bridge", internal: false, icc: false },
          ],
          servicePorts: [],
        },
      },
      { baseline: null }
    );
    expect(f).toEqual([]);
  });

  it("flags writable host mounts and dangerous capabilities", () => {
    const f = securityFindings(
      {
        dockerRisks: {
          containers: [
            c("backup", "restic:1", [], {
              hostMounts: [
                { source: "/", rw: false },
                { source: "/etc", rw: true },
              ],
              capAdd: ["SYS_ADMIN", "CHOWN"],
            }),
          ],
          servicePorts: [],
        },
      },
      { baseline: null }
    );
    expect(f.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["docker:mount:backup:/etc", "high"],
      ["docker:cap:backup:SYS_ADMIN", "high"],
    ]);
  });
});

describe("kswapd0", () => {
  const report = {
    compromise: {
      hits: [{ kind: "miner-process", detail: "process 'kswapd0' (pid 51)" }],
    },
  };

  it("ignores the kernel thread old agents reported", () => {
    expect(
      securityFindings(report, { baseline: null, agentVersion: "1.5.0" })
    ).toEqual([]);
  });

  it("trusts agents that tell kernel threads apart", () => {
    expect(
      securityFindings(report, { baseline: null, agentVersion: "1.5.1" })
    ).toHaveLength(1);
  });
});
