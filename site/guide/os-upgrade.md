# Upgrading a server's operating system

When Moatline reports an operating system out of support — Ubuntu 20.04
since 2025-05-31, Debian 11 since 2026-08-31 — the server gets no security
updates any more, however well unattended-upgrades runs. There are three
ways off it.

## 1. A new server, apps moved over (safest)

Best for servers that carry customer sites: the old server keeps running
until the new one is proven.

1. Create a server with **Ubuntu 24.04 LTS** (or Debian 13), harden it and
   install the agent from the Setup tab.
2. **Dokploy:** add it under _Remote servers_, move each application and
   database to it (or create them there) and deploy. Restore databases
   from their backups. **Coolify:** add the server and move the resources
   the same way.
3. Check every site on the new server — Moatline's live checks and
   [checks](./operations) tell you when all are green.
4. Move the IP (below) or switch DNS, then shut the old server down.

## 2. Upgrade in place

Possible, one release at a time — there is no direct jump from 20.04 to
24.04. Plan a maintenance window, roughly 20–40 minutes per release with
short outages.

```bash
# 0. Take a snapshot in your provider's console — your way back.

# 1. Bring the current release fully up to date
sudo apt update && sudo apt full-upgrade -y
sudo reboot

# 2. At least ~5 GB free on /
df -h /

# 3. Run the upgrade inside tmux, so a dropped SSH session does not kill it
sudo apt install -y tmux && tmux
sudo do-release-upgrade     # 20.04 → 22.04, reboot when asked
sudo do-release-upgrade     # 22.04 → 24.04 after the reboot
```

- **Third-party repositories are switched off** during the upgrade — Docker,
  CrowdSec, Tailscale. Re-enable them in `/etc/apt/sources.list.d/` with the
  new codename (`focal` → `jammy` → `noble`), then
  `sudo apt update && sudo apt full-upgrade`.
- The upgrader opens **SSH on port 1022** as a fallback and asks first when
  a firewall is active.
- Docker containers come back after the reboot; check the sites are green.

For Debian, change the codename in the APT sources (`bullseye` →
`bookworm` → `trixie`), `apt full-upgrade`, reboot — one release at a time.

## 3. Buy time with extended support

**Ubuntu Pro** keeps 20.04 patched until 2030: `sudo pro attach <token>`.
Free for personal use on up to five machines; for a business it is paid.
A bridge, not a replacement — plan the upgrade anyway.

## Keeping the server's IP

DNS, firewall allowlists at customers and partners often point at the IP.
Whether it can stay depends on the provider:

| Provider                      | How the IP stays                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hetzner Cloud**             | The **primary IP** is its own resource. Power off the old server, _Networking → Primary IPs → Unassign_, power off the new one, unassign its own primary IP, assign the old one. Turn off _auto delete_ on the IP before deleting the old server, or it goes with it. |
| **Hetzner Cloud, in place**   | _Rebuild_ reinstalls the image on the same server and keeps the IP — but wipes the disk: back up everything first.                                                                                                                                                    |
| **Hetzner dedicated (Robot)** | Reinstalling with `installimage` keeps the IP; a new server gets a new one, unless you use a failover IP.                                                                                                                                                             |
| **Other clouds**              | Most have the same idea: elastic, reserved or static IPs (AWS, DigitalOcean, Vultr) that move between servers.                                                                                                                                                        |

For next time, point DNS at a **floating IP** (Hetzner) instead of the
server's own: it moves to another server in seconds, without powering
anything off.

After the move:

- SSH warns that the host key changed — expected; remove the old line with
  `ssh-keygen -R <ip>`.
- In Dokploy, the remote server needs its SSH key again (_Remote servers →
  Setup_).
- Install the agent on the new server; keep the server's address in
  Moatline as it is.
