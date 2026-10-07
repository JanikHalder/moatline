# Security model

Moatline holds keys to your code and your platforms, so it is built
to be a poor target:

- **Secrets encrypted at rest** (GitHub, Dokploy, Coolify, notification
  credentials) with `SECRETS_KEY`; never sent back to the browser.
- **Two-factor authentication** required for owners and admins before
  anything that deploys, merges or changes integrations.
- **Audit log** of every unattended switch and every action.
- **Push-only agent**: no port, no commands; a token that can only submit
  reports.
- **Least data**: error lines scrubbed on the server, environment variable
  names but never values, database passwords dropped while reading.
- **Live checks** refuse private and loopback addresses unless allowed.

Found a vulnerability? Please report it privately — see
[SECURITY.md](https://github.com/JanikHalder/moatline/blob/main/SECURITY.md).
