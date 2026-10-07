# Quick start

## 1. Run it

On any server with Docker:

```bash
git clone https://github.com/JanikHalder/moatline.git
cd moatline/deploy
cp .env.example .env
```

Set the required values in `.env`:

```bash
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
SECRETS_KEY=$(openssl rand -base64 32)
PUBLIC_URL=https://checker.example.com
```

```bash
docker compose up -d
```

The web app listens on port 8080; put your reverse proxy (or Dokploy's,
Coolify's) in front for HTTPS. Migrations run on start.

::: tip One click instead
On Dokploy or Coolify, install it from the template catalog — every secret
is generated for you. See [images and templates](/reference/templates).
:::

## 2. Create your account

Open the URL, sign up, create an organization. Owners and admins are asked
to turn on two-factor authentication — it guards everything that deploys or
changes integrations.

## 3. Connect

Under **Settings**:

- **GitHub token** — fine-grained, with _Contents_ and _Pull requests_
  (read & write) on the repositories to fix; read-only is enough to scan.
- **Dokploy** or **Coolify** — see [Connect a platform](./platforms).

Repositories → **Add all from Dokploy** adds every app Dokploy deploys from
GitHub, already linked.

## 4. Watch the servers

Servers → **Add server**, then run the one-line install it shows on the
server. See [the agent](./agent).
