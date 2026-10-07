# Servers and platforms

Every server gets one page with tabs: **Overview** (numbers and one line
per area), **Apps** (containers, logs, live apps), **Security**,
**Maintenance** (updates, backups, Docker storage, disks), **Findings**.

## Findings that matter

- security updates pending for days, a reboot that is due
- an OS out of support (Ubuntu and Debian lines are known)
- containers restarting, unhealthy, killed for memory, or using several
  times their usual memory
- vulnerabilities in the host and every running image, with whether a
  newer image exists or the image is no longer maintained at all
- databases reachable from the internet, backups missing or failing
- containers no platform manages, a platform running unconnected
- signs of compromise: miners, programs from deleted files, cron jobs that
  download and execute

Each finding opens once, notifies once, and resolves by itself when its
source stops reporting it.

## Docker storage

Build cache and unused images, measured hourly, and cleared through Dokploy
with a click — volumes are never touched.
