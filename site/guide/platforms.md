# Connect Dokploy or Coolify

Both can be connected at once; each site deploys through the one it is
linked to.

## Dokploy

1. In Dokploy: _Settings → Profile → API/CLI_ → generate a key.
   Cleanups and the server list need a key of an **admin or owner**.
2. In Moatline: _Settings → Dokploy_ → base URL and the key.

Linked automatically: every repository whose GitHub repository and branch
one Dokploy application deploys. Databases are found too (for the
database and backup checks), and containers are matched to their service.

## Coolify

1. In Coolify: _Settings → API_ → turn the API **on**.
2. _Keys & Tokens → API tokens_ → create a token with **read** and
   **deploy**. (Ticking _deploy_ resets the list to deploy only — add _read_
   again.)
3. In Moatline: _Settings → Coolify_ → URL and token.

Coolify has no rollback in its API: a broken deploy is undone with a git
revert of the merge, then deployed again.

## What a connected platform enables

- **Merge & deploy**, auto-deploy after a security fix, with the build
  followed and the live URL watched
- **Rollback** (Dokploy's image rollback, otherwise a git revert)
- **Self-healing**: a site that stays down is restarted
- **Redeploy / restart** buttons on the server's containers
- **Database checks**: public ports, missing, disabled, failed or late backups
