# The server agent

One Python file, standard library only, MIT-licensed — read it before you
run it: [`apps/api/agent/pc-agent.py`](https://github.com/JanikHalder/moatline/blob/main/apps/api/agent/pc-agent.py).

## Install

Servers → **Add server** shows a one-line install with a one-time code:

```bash
curl -fsSL https://checker.example.com/api/agent/install.sh | sudo bash -s -- --enroll pce_… --all
```

`--all` also installs Trivy, CrowdSec with its firewall bouncer and
automatic security updates when they are missing. `--trust-ip <office IP>`
keeps your own address out of CrowdSec and fail2ban bans. `--ssh-from
<IP,…>` closes SSH in ufw for everyone but these addresses — the Dokploy or
Coolify server, your office (see [Tailscale, SSH and Dokploy](./tailscale)).
`--no-logs` stops error lines from container logs being sent.

If CrowdSec's local API cannot start because another program (often a
container published on port 8080) holds its port, `--crowdsec` moves it to a
free local port and points the bouncer at it.

Run the same command without a code to update the agent in place — the
token and settings are kept.

## What it reports

Every 5 minutes: load and real CPU use, memory, disks, pending and security
updates, CrowdSec, containers (state, health, memory, image), Swarm
services, listening ports, hardening, access (SSH keys, sudoers), signs of
compromise, Docker disk usage, and error lines from container logs —
scrubbed of passwords, tokens, e-mail and IP addresses before they leave.
Daily: Trivy on the host and every running image.

## What it never does

- open a port, or accept a command
- run anything sent from Moatline
- send log lines other than errors, or environment values

The systemd units drop every capability except reading files and cap CPU
and memory. Details: [server monitoring](/reference/server-monitoring).
