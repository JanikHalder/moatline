# Server monitoring

Moatline watches the servers the applications run on, next to the
repositories themselves. One page per server answers:

- **Is it overloaded?** Load per core, memory, the fullest disk, with a 24h trend.
- **Is it up to date?** Pending OS updates, how many are security updates,
  whether a reboot is pending, whether automatic updates are on.
- **Is it under attack, and is that being stopped?** CrowdSec alerts, active
  bans, and whether a bouncer actually enforces them.
- **What is vulnerable?** Trivy on the OS packages _and_ on the images of the
  running containers, which is what is actually live.
- **What does the outside world see?** Nuclei against the live URLs of the
  applications, Uptime Kuma monitors, TLS certificate expiry.
- **Optional:** Wazuh agent status and hardening (SCA) score.

Every problem from every source becomes a **finding** with one lifecycle: open
while its source keeps reporting it, resolved the first time it no longer does.
New critical/high findings go out over the organization's Slack, Telegram and
email settings, one message per source and report rather than one per finding.

## Architecture

```
 server                                   Moatline
 ┌──────────────────────────┐   HTTPS    ┌──────────────────────────────┐
 │ pc-agent (systemd timer) │──────────▶│ POST /api/agent/report        │
 │  metrics  every 5 min    │  bearer    │   token → one server only     │
 │  trivy    daily          │  token     │                               │
 │  reads: /proc, apt/dnf,  │            │ scheduler (ENABLE_SCHEDULER)  │
 │  cscli, docker, trivy    │            │  • heartbeat: silent agents   │
 └──────────────────────────┘            │  • Uptime Kuma  /metrics      │──▶ Kuma
                                         │  • Wazuh manager API          │──▶ Wazuh
            live URLs ◀──────────────────│  • Nuclei (scheduled/manual)  │
                                         └──────────────────────────────┘
```

**Push, not pull.** The server reports in; Moatline never connects to
it. No SSH keys, no root credentials, no open agent port. Compromising the
dashboard does not give anyone a way onto the servers.

## Docker apps and backups (agent 1.3.0)

- **Docker apps**: every running container with its state and health check,
  and every Swarm service (Dokploy) with running vs. desired replicas.
  Unhealthy or crash-looping containers and services below their replica
  count (in two reports in a row — a deploy briefly reads 0/1) are findings.
  Trivy's CVE count per image sits next to each container.
- **Backups**: under a server's Settings, list the folders, files or globs
  where its backups land and how old the newest file may be. The agent
  reports only file dates and sizes — never contents; the list reaches it in
  the answer to its report (declarative: paths to stat, nothing to run).
  Too old is high, three times too old critical, a missing path high.

## Object storage and disks filling up (agent 1.14.0)

- **S3 storage in Docker** is found by its image: MinIO, Garage, SeaweedFS,
  RustFS, Zenko CloudServer, Versity Gateway, Ceph. Once an hour the agent
  measures the container's data volumes with `du` (at idle I/O priority,
  four minutes at most) and the disk under them. For MinIO, RustFS and
  Versity — which keep buckets as plain folders — it also lists the biggest
  buckets.
- **Any other folder** — an S3 server outside Docker, an upload folder, a
  backup target — is added on the server's Maintenance tab → Storage →
  _Watch a folder_. The agent only measures it.
- **A limit** per storage (Maintenance tab → Storage → _Set a limit_) warns at
  90% and alarms when it is exceeded.
- **Forecasts**: every disk and storage is recorded hourly (kept 90 days).
  From the last week's growth (a straight line through it, so a single big
  upload is no trend) Moatline warns when a disk will be full, or a storage
  reach its limit, within 14 days — before the 85% alarm.

Nothing is ever deleted. The findings say where the space goes and how to
get it back, e.g. a MinIO lifecycle rule
(`mc ilm rule add --expire-days 30 <alias>/<bucket>`).

## Memory and CPU per app (agent 1.6.0)

Every report carries memory (without page cache), CPU, the memory limit,
restarts and whether the kernel killed a container for running out of
memory. Replicas of one app (Swarm service, compose service) add up. Package
Checker keeps 8 days per app and learns each app's usual level (7-day median,
after one day of history). Findings under **Host**:

- Killed for running out of memory (high).
- At 90% of its memory limit (high).
- 2× its usual memory and at least 256 MB more (medium; 3× high) — the
  typical Next.js/Node leak.
- Over 40% of the server's memory without a limit (medium; 60% high).
- A CPU core busy at 90%+ for two reports in a row when that is not its
  normal (medium) — for Node a stuck event loop.

Click a container in **Docker apps** for its memory over 24 hours or 7 days
and the CVEs in its image, critical first.

## Security checks (agent 1.4.0)

Findings under the source **Security**:

- **Hardening**: SSH accepting passwords, root password login, empty
  passwords (effective config via `sshd -T`); UFW off (rated low when the
  external check shows a provider firewall covers it); neither fail2ban nor
  CrowdSec blocking brute force.
- **Access changes**: SSH keys of every user, members of sudo/admin/wheel and
  docker, uid-0 accounts. The first report is the baseline; anything added
  later is a finding (a new uid-0 account is critical) until an owner/admin
  accepts it on the server page — audited.
- **Docker**: privileged containers, the Docker socket mounted (low for
  Dokploy/Traefik, which need it), host networking, and ports published on
  all interfaces — Docker opens them past UFW. Rated by the service behind
  them, so Dokploy's "external port" 6352 → Postgres 5432 is critical.
- **Docker networks, mounts and capabilities** (agent 1.5.0): a network
  where two or more apps can reach a database (medium) — on Dokploy usually
  `dokploy-network`, which Dokploy's own Postgres and Redis share as well;
  several containers on Docker's default bridge (low); writable bind mounts
  of `/`, `/etc`, `/root`, `/var/lib/docker` … (high); added capabilities
  such as `SYS_ADMIN` or `ALL` (high) and `NET_ADMIN` or `SYS_PTRACE`
  (medium). Networks with inter-container traffic off are left alone.
- **Replaced libraries**: services still running a library an update
  replaced (from /proc), with the `systemctl restart` that fixes it.
- **Listening ports** on all interfaces that the external check cannot reach
  — a firewall catches them today; bind them to 127.0.0.1.
- **Signs of compromise**: known miner processes, programs running from
  /tmp, /dev/shm, /var/tmp or from a deleted file, connections to
  mining-pool ports, /etc/ld.so.preload, cron jobs that download and run
  code. Read-only — the agent never kills or deletes anything.

## Topology: Moatline and the app servers on a tailnet

Moatline runs on its own host; the applications run on other servers.
They talk over Tailscale:

```
 app server (tailnet 100.a.b.c)                Moatline host (tailnet 100.x.y.z)
 ┌───────────────────────────┐   report over   ┌────────────────────────────────────┐
 │ pc-agent  ─────────────────┼── tailnet ─────▶│ :3001  /api/agent/*                 │
 │ Trivy · CrowdSec · apt     │  (WireGuard)    │                                    │
 │                            │◀── internet ────│ Nuclei + external port/TLS check   │
 │ public IP 91.x.x.x :80/443 │                 │   against the public IP + domains  │
 └───────────────────────────┘                 └────────────────────────────────────┘
```

API environment for this setup:

| Variable                       | Example                 | Why                                                                                                                      |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `AGENT_BASE_URL`               | `http://100.x.y.z:3001` | The URL in the install command — what the app servers reach. Over Tailscale plain http is fine: WireGuard encrypts it.   |
| `ALLOW_TAILNET_LIVE_URLS=true` |                         | Allows Tailscale addresses as live URLs, server addresses and Kuma/Wazuh URLs. The Moatline host must be a tailnet node. |
| `SCANNER_IPS`                  | `203.0.113.7,100.x.y.z` | Public (and tailnet) IPs Moatline scans from. The installer whitelists them in CrowdSec, so Nuclei does not get banned.  |

The agent accepts `http://` only for Tailscale addresses (`100.64.0.0/10`,
`*.ts.net`); anything else must be `https://`.

### Behind Cloudflare

Cloudflare's bot protection challenges requests from server IPs (`HTTP 403`,
`cf-mitigated: challenge`) — the agent cannot solve a browser challenge. Give
the agents their own domain that bypasses Cloudflare and exposes only the
agent routes:

1. Cloudflare DNS: `A agent.package → <Moatline server IP>`, **DNS
   only** (grey cloud).
2. Dokploy → app → Domains: host `agent.package.<domain>`, **path
   `/api/agent`**, strip path **off**, same container port, HTTPS with Let's
   Encrypt.
3. `AGENT_BASE_URL=https://agent.package.<domain>` and redeploy.

The UI and login stay behind Cloudflare; the agent domain serves only
`install.sh`, `pc-agent.py`, `enroll` and `report`, all over TLS and useless
without a valid code or token.

## Setting up a server

The server's **Setup** tab has all three steps as copy-and-paste commands:
hardening (`harden-server.sh`), automatic updates (`auto-update.sh`) and the
monitoring agent. The two scripts come from the private save-server
repository and are served by this app with their checksums; after changing
them there, run `pnpm sync:server-scripts` and deploy.

New server or one that has been running for years — the same steps:

1. **Servers → Add server** (owner/admin). Optionally enter its public IP for
   the external check.
2. Pick what to set up (Trivy, CrowdSec + firewall bouncer, automatic security
   updates, container scanning — all on by default) and copy the one line:

   ```bash
   curl -fsSL http://100.x.y.z:3001/api/agent/install.sh | sudo bash -s -- --enroll pce_… --trivy --crowdsec --auto-updates
   ```

3. Paste it on the server. It
   - downloads the agent and checks its SHA-256 (baked into `install.sh`),
   - exchanges the one-time code for the server's agent token,
   - installs what is missing from the vendors' official repositories and
     leaves existing installations alone,
   - on Dokploy hosts points CrowdSec at the `dokploy-traefik` container,
   - whitelists `SCANNER_IPS` in CrowdSec,
   - sends a first report and enables `pc-agent-metrics.timer` (every 5
     minutes) and `pc-agent-full.timer` (daily Trivy run, first one right away).
4. **Settings tab of the server:** tick the applications running on it. Their
   live URLs become Nuclei targets, Uptime Kuma monitors on them are attached,
   and their findings show up on the application.

**About the code in the command.** `pce_…` is valid for one hour and works
once: the installer swaps it for the real agent token, which never appears on
a command line. A leaked shell history therefore holds nothing usable.
Running the command again with a fresh code updates the agent and replaces its
token — that is also how the token is rotated.

Requirements: Debian/Ubuntu for the automatic tool setup (on RHEL the agent
itself runs, the tools are installed by hand), Python 3 (installed if
missing), systemd. Missing tools are reported as findings, never as silence.

Prefer to read the agent before it runs as root? The Agent tab has a manual
path: download `pc-agent.py`, compare it with `apps/api/agent/pc-agent.py` in
this repository, verify the checksum, then run
`sudo python3 pc-agent.py install --url … --enroll pce_… --all`.

### What gets installed, exactly

| Flag             | Installs / changes                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--trivy`        | apt repo `aquasecurity.github.io/trivy-repo` + `trivy`                                                                                                                                 |
| `--crowdsec`     | apt repo via `install.crowdsec.net` + `crowdsec`, `crowdsec-firewall-bouncer-iptables` (nftables variant on nft-only hosts), Traefik collection + acquisition on Dokploy, allowlist    |
| `--auto-updates` | `unattended-upgrades` + `/etc/apt/apt.conf.d/20auto-upgrades` (security origins). Reboot policy is left to you — e.g. `save-server/scripts/auto-update.sh`.                            |
| `--no-images`    | Trivy scans only the host, not the running containers                                                                                                                                  |
| `--trust-ip`     | Never ban these addresses (your office): CrowdSec whitelist + fail2ban `ignoreip`, existing bans lifted. Up to /24 or /48; `none` clears. Applied at install, never sent by the server |

On Docker hosts the installer adds the `DOCKER-USER` chain to the firewall
bouncer: by default it only filters `INPUT`, which traffic to published
container ports (Traefik on 80/443) never passes — a banned IP would still
reach every website.

A few failed SSH logins from the office (a machine still trying a password
or a wrong key) get its address banned — and through `DOCKER-USER` that
covers every website on the server too. `--trust-ip` (also on
`harden-server.sh`; both write the same files) prevents it. The setup tab
offers your current IP and keeps the list in the browser for the next
server. It is deliberately an install option, not a setting Moatline
pushes: the agent takes no instructions from the server, and an allowlist
is exactly what someone with access to Moatline should not be able
to hand out.

CrowdSec on Dokploy: HTTP attacks only show up once Traefik writes access logs
(Dokploy → Traefik settings). SSH protection works right away.

## Uptime Kuma

Run Uptime Kuma wherever it suits you (ideally not on the servers it watches).
Create an API key under **Settings → API Keys**, then enter the URL and key in
Moatline under **Settings → Uptime Kuma**. Monitors are pulled every 5
minutes from Kuma's `/metrics`. A down monitor is a critical finding; a
certificate expiring within 21 days is medium, within 7 days high.

If Kuma is only reachable on a private network or tailnet, set
`ALLOW_PRIVATE_LIVE_URLS=true` / `ALLOW_TAILNET_LIVE_URLS=true` on the API.

## Hetzner Cloud firewalls (optional)

The external check sees what _one_ IP — the Moatline server — can
reach. The Hetzner firewall rules say what everyone else gets. Create a token
per Hetzner project (Console → project → Security → API tokens → Generate,
permission **Read**) and paste them, one per line, under **Settings → Hetzner
Cloud firewalls**. Read is all it needs: the token cannot change a firewall or
a server. Pulled every 15 minutes; servers are matched by their public IP (the
server address) or by name.

Findings under the source **Hetzner firewall**:

- No firewall applied (medium; low when UFW is active).
- A rule that opens every TCP port to `0.0.0.0/0` (high).
- A rule that opens a port to anywhere: rated by the service listening there
  (Redis, MongoDB … critical), low when nothing listens yet.

Docker-published ports use the rules too: open to anywhere = full severity,
open only to listed IPs or no rule = medium (it still sits on the public
interface — bind it to the Tailscale address instead). The rules are shown on
the server page under Security. IONOS and other providers have no such
integration; there the external check is the signal.

## Wazuh (optional)

Wazuh is heavy (manager + indexer + dashboard); CrowdSec + Trivy cover most of
what a small fleet needs. If you run it anyway, create a user with a
**read-only** role on the manager API and enter URL, user, password and the
manager's CA certificate under **Settings → Wazuh**. TLS verification is never
switched off — the CA you paste is the one trusted. Then set each server's
Wazuh agent ID (e.g. `001`). Reported: agent not active (high), SCA score below
50% (medium) or below 80% (low).

## Nuclei

Nuclei runs **on the API host** against the live URLs of the applications
linked to a server, plus extra targets configured on the server. Manual
("Scan now") or on a schedule (daily/weekly). The policy (`services/nuclei.ts`):

- Excluded tags: `dos`, `fuzz`, `intrusive`, `brute-force`, `default-login` —
  this is monitoring of our own production, not a pentest.
- Excluded protocols: `code`, `file`, `headless`, `javascript` — nothing runs
  code or a browser on the API host, which holds the organization secrets.
- No interactsh (out-of-band) by default, so no third party learns which hosts
  are scanned. `NUCLEI_INTERACTSH=true` enables it.
- `-restrict-local-network-access` unless private/tailnet targets are allowed,
  so a public hostname that redirects or resolves inward is still refused.
- `-omit-raw`: request/response pairs (cookies, tokens) are not stored.
- Rate-limited (30 req/s), one run at a time, 45-minute cap. A failed run
  resolves nothing — previous findings stay open.
- Templates are baked into the Docker image and refreshed daily.

The Docker image ships a pinned nuclei (`NUCLEI_IMAGE` build arg); Nixpacks
installs it from nixpkgs. Elsewhere, put `nuclei` on the PATH or set
`NUCLEI_BIN`.

## Security model

| Threat                                         | Mitigation                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard compromised                          | Push-only agent: no credentials for the servers exist here. Agent tokens can only submit reports.                                                                                                      |
| Database leaked                                | Agent tokens are stored as SHA-256 only; Kuma key and Wazuh password AES-256-GCM encrypted (`SECRETS_KEY`).                                                                                            |
| Agent token stolen                             | It can only write reports for that one server: size-limited (8 MB, bounded arrays), schema-validated, rate-limited per token, timestamp within ±15 min. Rotate or revoke under the server's Agent tab. |
| Report contains hostile content                | Every string is clipped; links are kept only if `http(s)` (no `javascript:`); React escapes the rest.                                                                                                  |
| Agent runs as root                             | systemd units drop all capabilities except reading files, make `/usr`, `/boot`, `/etc` read-only, forbid privilege escalation, cap CPU at 50% and memory at 1.5 GB. Stdlib-only Python, checksummed.   |
| Install command leaked (history, screen share) | It carries a one-time code valid for an hour; the real token never appears on a command line.                                                                                                          |
| Token in transit                               | The agent sends only over https (TLS verified against the system trust store) or over a Tailscale address, where WireGuard encrypts the traffic.                                                       |
| Nuclei / Kuma / Wazuh used for SSRF            | Same URL rules as live URLs (no loopback, link-local, metadata or private ranges unless explicitly allowed), Wazuh https-only, Kuma without redirects.                                                 |
| A member points integrations at a collector    | Changing integrations, issuing agent tokens and deleting servers require owner/admin.                                                                                                                  |
| API process itself                             | The Docker image now runs as an unprivileged `app` user.                                                                                                                                               |

## Operations

- `ENABLE_SCHEDULER=true` on exactly one API instance runs heartbeat checks,
  Kuma/Wazuh pulls, scheduled Nuclei runs and metric retention (14 days).
- An agent silent for 20 minutes raises "Agent stopped reporting" (high).
- On the server: `systemctl list-timers 'pc-agent*'`,
  `journalctl -u pc-agent-metrics.service`, and
  `python3 /usr/local/lib/pc-agent/pc-agent.py report metrics --dry-run` to
  see exactly what would be sent.
- Uninstall: `sudo python3 /usr/local/lib/pc-agent/pc-agent.py uninstall`,
  then revoke the token.

## High memory (Next.js / Node)

Per-app RSS is recorded every agent report. Findings:

- near the container memory limit (`usage:limit`)
- OOM-killed and restarted (`usage:oom`)
- ~2× the 7-day median (`usage:memory`) — often a leak
- large share of host RAM with no limit (`usage:share`)

On a linked repository, the **Memory** card shows the 24h chart and a short
checklist. Full playbook: [High memory in Next.js](../site/guide/nextjs-memory.md)
(site: `/guide/nextjs-memory`).

## MCP (AI assistants)

`POST /api/mcp` speaks MCP over Streamable HTTP (stateless JSON-RPC, no
sessions). It accepts only organization API keys — never a browser session.
Owners/admins create them under Settings → API keys: shown once, stored as a
hash, 90 days by default, revocable, every call rate-limited per key.
Optional allowlists limit a key to specific repositories and servers.

**Scopes**

| Scope  | Tools |
| ------ | ----- |
| `read` | `get_overview`, `list_servers`, `get_server`, `list_findings`, `list_uptime`, `list_repositories`, `get_repository`, `get_audit_log`, `get_findings_report` |
| `scan` | `start_nuclei_scan`, `start_repository_scan` |
| `fix`  | `start_security_fix` (blocked when org policy disables MCP fixes) |
| `members` | `list_members` (emails and roles — off by default) |

`scan` and `fix` tool calls are written to the audit log (`mcp.<tool>`);
read-only tools are not, to keep the log usable. Security fixes record
`security_fix.started` and `security_fix.pr_opened` with
`source: auto | manual | mcp`. Filter the audit page with **Agents &
automation** (server-side: `GET /api/org/audit?agents=1`). API keys can be
updated with `PATCH /api/org/api-keys/:id` (scopes and allowlists). Nothing
over MCP can change settings, issue install codes or touch servers.

Org rules under Settings → Automation & AI agents: default auto-fix on new
repos, allow/deny MCP security fixes, require PR review (blocks auto-merge
and auto-deploy).

```bash
claude mcp add --transport http moatline https://package.example.com/api/mcp \
  --header "Authorization: Bearer pck_…"
```
