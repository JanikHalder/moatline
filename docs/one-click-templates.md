# One-click install on Dokploy and Coolify

Moatline ships as two images built by `.github/workflows/images.yml`:

- `ghcr.io/janikhalder/moatline-api` — API, scheduler, migrations on start
- `ghcr.io/janikhalder/moatline-web` — the web app (nginx, proxies `/api`)

A push to `main` publishes `:main`; a tag `v1.2.3` publishes `:1.2.3` and
`:latest`. Both images are built for `linux/amd64` and `linux/arm64`.

## Self-host with Docker Compose

```bash
cd deploy
cp .env.example .env   # set POSTGRES_PASSWORD, BETTER_AUTH_SECRET, SECRETS_KEY, PUBLIC_URL
docker compose up -d
```

## Updates

Settings → **Updates** shows the running version (`APP_VERSION`, set from
the release tag at build) against the newest GitHub release, with its
notes. On a self-hosted compose install with `SELF_UPDATE=true`, the Docker
socket mounted and its group given to the API (`group_add`, see
`deploy/docker-compose.yml`), **Update** does it in one click — like
Dokploy: a short-lived `docker:cli` container pulls the new images, only
then pins `PC_VERSION` in `.env`, and recreates the project. A failed pull
changes nothing; `.pc-update.log` next to the compose file says why.
Mounting the socket gives the API root on the host, which is why it is
opt-in. Installed through Dokploy or Coolify, the page says to change the
image tags there. The cloud service shows none of this.

The images are `moatline-api` and `moatline-web`; releases before 1.2.0
were published as `moatline-api` / `-web`.

## The templates

| Catalog | Files                                                                                    | Where they go                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Dokploy | `templates/dokploy/moatline/` (`docker-compose.yml`, `template.toml`, `meta.json`, logo) | `blueprints/moatline/` in [Dokploy/templates](https://github.com/Dokploy/templates)                                             |
| Coolify | `templates/coolify/moatline.yaml`, logo                                                  | `templates/compose/moatline.yaml` and `public/svgs/moatline.svg` in [coollabsio/coolify](https://github.com/coollabsio/coolify) |

Both generate every secret on install (Dokploy `${password}` / `${base64}`,
Coolify `SERVICE_PASSWORD_*`) and point the public URL at the domain the
platform assigns. Nothing has to be typed.

The agent is deliberately **not** a template: it reads the host (updates,
processes, Docker, firewall) and runs from systemd with a hardened unit.
Inside a container it would need the host's root filesystem and Docker
socket — exactly what it is designed not to have. Servers get it with the
one-line install from the Setup tab.

## Before submitting

Both catalogs only list open-source projects whose images anyone can pull.

1. **Repository public**, with a license (see the open-source plan: MIT for
   the agent, AGPL-3.0 for the server).
2. **Images public**: GitHub → Packages → `moatline-api` / `-web` →
   Package settings → Change visibility → Public.
3. **A release**: tag `v1.0.0` (or the version in the templates) so the
   pinned image exists — `git tag v1.0.0 && git push --tags`.
4. **Test it on both platforms** — both projects close untested template PRs:
   - Dokploy: Create Service → Template → _Import_ the `docker-compose.yml`
     and `template.toml`, or test the PR preview Dokploy builds for you.
   - Coolify: New Resource → Docker Compose Empty, paste
     `moatline.yaml`; the `SERVICE_*` variables are filled in.
5. **Open the PRs**: one template per PR. Dokploy validates with
   `node build-scripts/generate-meta.js --check`.

## Keeping them current

When releasing `vX.Y.Z`, bump the image tags in both templates and the
`version` in `meta.json`, then open a small PR in each catalog.
