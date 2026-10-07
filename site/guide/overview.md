# Versions and new sites

## Versions

- **Sites**: Payload, Next.js, React and Node on every site — installed
  versions from the lockfile, Node from the Dockerfile — and how far each
  is behind. Bulk upgrade to one release, a pull request each.
- **Servers**: OS with end of support, kernel, Docker, pending updates,
  reboot, agent version.

## Clients and reports

Put repositories, servers and domains under a client. Domains are checked
daily: certificate, registration, SPF, DKIM, DMARC. The monthly maintenance
report (German or English per client) lists what was fixed, updated and
deployed, open vulnerabilities, uptime and performance.

## New site

One form creates the GitHub repository from your template, a Dokploy
project, PostgreSQL or MongoDB with a daily backup, the application with
its environment (database URL, secrets and site URL filled in from the
template's `.env.example`), the domain with Let's Encrypt, the first deploy
and the monitoring.
