<p align="center"><img src="docs/logo.svg" width="96" alt="" /></p>

# Moatline

**No-bullshit DevSecOps for self-hosted apps** — buy online with Stripe, or
self-host free. Moatline watches what you deploy on Dokploy, Coolify, Komodo,
Portainer or any Docker host — code, containers, servers, databases and
domains — and fixes what it can by itself: it opens the pull request, checks
the build, deploys through your platform, watches the live site and rolls
back when the deploy broke it. Coding agents connect over MCP with scopes,
allowlists and a full audit trail.

## What it does

- **Vulnerabilities, fixed by pull request** — npm dependencies from the
  lockfile (no clone needed), malicious packages, outdated packages, unused
  ones; fixes as lockfile-only PRs that keep Payload, Next.js and React
  packages on one version, checked by typecheck or build.
- **Guarded deploys** — deploy through Dokploy, Coolify, Komodo or Portainer, follow the
  build, watch the live URL (and `/admin` on Payload sites), roll back
  through the platform or a git revert when the site breaks.
- **Uptime and self-healing** — live checks every few minutes, incidents
  with their likely cause from the app's logs, automatic restarts, uptime
  per month.
- **Servers** — a push-only agent (Python, standard library, MIT): load,
  memory, disk, OS and security updates, CrowdSec, Trivy on the host and
  every running image, signs of compromise, error lines from container
  logs (scrubbed). Nothing listens on the server; the agent takes no
  commands.
- **Platform checks** — databases reachable from the internet, missing or
  failing backups, unmaintained images, containers no platform manages,
  servers without an agent, Docker disk usage with cleanup.
- **Overview** — versions of Payload, Next.js, React and Node across every
  site with bulk upgrades, OS and kernel support across every server,
  clients with domains (certificates, registration, SPF/DKIM/DMARC) and a
  monthly maintenance report.
- **New site in one go** — GitHub repository from your template, Dokploy
  app with database, backup and domain, first deploy and monitoring.
- **AI agents over MCP** — scopes (`read` / `scan` / `fix`), optional
  repo and server allowlists, findings as a markdown task list, every
  tool call in the audit log; org policy for auto-fix and PR review.

English and German UI and notifications (Slack, Telegram, email).

## Quick start

```bash
cd deploy
cp .env.example .env   # set the passwords/secrets and PUBLIC_URL
docker compose up -d
```

Or one click from the Dokploy and Coolify template catalogs — see
[docs/one-click-templates.md](docs/one-click-templates.md). Then add a
GitHub token and your Dokploy/Coolify credentials under Settings, and
install the agent on your servers from the Setup tab.

More: [server monitoring](docs/SERVER_MONITORING.md) ·
[health endpoint](docs/health-endpoint.md) ·
[update strategy](docs/UPDATE_STRATEGY.md) · [security](SECURITY.md)

## License

The server and web app are licensed under the
[GNU AGPL v3](LICENSE); the server agent (`apps/api/agent/`) under
[MIT](apps/api/agent/LICENSE), so it can be audited and vendored freely.

---

# Development

Monorepo: TanStack Router + shadcn/ui (web), Hono API, Drizzle
(PostgreSQL), Better Auth.

## Setup

1. **Install**

   ```bash
   pnpm install
   ```

2. **Database**

   Set `DATABASE_URL` in `apps/api/.env`. Then create the database and run Drizzle migrations:

   ```bash
   # If the DB/user don't exist yet, use an admin connection once (e.g. your OS user on Mac/Linux):
   DATABASE_ADMIN_URL="postgresql://$(whoami)@localhost:5432/postgres" pnpm run db:create

   pnpm run db:migrate   # loads .env from apps/api and runs migrations
   ```

   `db:create` loads `apps/api/.env` and creates the role and DB from `DATABASE_URL`; with `DATABASE_ADMIN_URL` it uses that connection to create them. `db:migrate` also loads `apps/api/.env` automatically. Alternatively use Docker: `docker compose up postgres -d` (creates user and DB), then only `pnpm run db:migrate`.

3. **Environment**
   - **API** (`apps/api/.env`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (e.g. `http://localhost:3001`), `CORS_ORIGIN` (e.g. `http://localhost:5173`).
     - `GITHUB_TOKEN` – fallback for organizations without their own token (see [GitHub access](#github-access)). Needed for private repos **and** for the security auto-fix (clone/PR/merge/push).
     - `SECRETS_KEY` – required to store integration secrets (Dokploy/Telegram/SMTP) encrypted at rest. Any passphrase (`openssl rand -base64 32`).
     - `ENABLE_SCHEDULER=true` – on **exactly one** API instance, to run scheduled scans.
     - `APP_URL` – public URL of the web app, used for invitation links in emails. Falls back to the first `CORS_ORIGIN` entry.
     - `GIT_COMMIT_SHA` – the commit this build was made from, reported by `GET /api/health`. Set it in the deployment platform; without it the API asks `git` and falls back to `null`.
     - `ALLOW_PRIVATE_LIVE_URLS=true` – allow repo live URLs on private/loopback addresses. Off by default so the checker cannot be pointed at internal hosts.
     - `ALLOW_TAILNET_LIVE_URLS=true` – allow live URLs on a Tailscale tailnet (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`, `*.ts.net`). The API container must itself be a node on that tailnet, otherwise every check times out.
   - **Web** (`apps/web/.env`): `VITE_API_URL` (e.g. `http://localhost:3001`). If the API runs on another port (e.g. you set `PORT` in `apps/api/.env`), set `VITE_API_URL` to that URL so the dev proxy reaches the API.
     - `VITE_DISABLE_LOGIN=true` – dev-only, skips the login gate and uses the API's demo org. Auth is on by default and production builds always require a login.

4. **Run**

   **Both API and Web must be running.** Otherwise you get `ECONNREFUSED` on `/api/*` (proxy can't reach the API).

   ```bash
   pnpm run dev:api   # terminal 1 – API on http://localhost:3001
   pnpm run dev:web   # terminal 2 – Web on http://localhost:5173
   ```

   Or from the repo root: `pnpm run dev` (starts both in parallel).

   Open http://localhost:5173. Sign up, create an organization (org switcher at the bottom of the sidebar → **New organization…**), add a repo (e.g. `https://github.com/owner/repo`), then run a scan. All data is scoped to the active organization; switching organizations reloads the view.

   **The first account you create is the only one that can register freely** — see [Team and registration](#team-and-registration) below.

5. **Tests**

   ```bash
   pnpm run test        # api + web (Vitest)
   pnpm run test:api    # API only
   pnpm run test:web    # Web only (Vitest + RTL)
   pnpm run test:e2e    # Playwright E2E (login page). Run once: pnpm exec playwright install
   ```

   Lint and format: `pnpm run lint`, `pnpm run format`, `pnpm run format:check`.

   The same checks run in CI (`.github/workflows/ci.yml`) on every push to `main` and every pull request: lint, format check, build (which type-checks both apps), migrations against a PostgreSQL service, unit tests and Playwright E2E.

## Deploy

The stack is three containers: PostgreSQL, the API (Hono, bundled to a single
file) and the web build served by nginx, which also proxies `/api` to the API.
Only the web container publishes a port.

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"   # required, min 32 chars
export SECRETS_KEY="$(openssl rand -base64 32)"          # required
export POSTGRES_PASSWORD="$(openssl rand -base64 24)"    # recommended
export BETTER_AUTH_URL="https://packages.example.com"
export CORS_ORIGIN="https://packages.example.com"
export GITHUB_TOKEN="ghp_…"                              # for private repos + auto-fix

docker compose up --build -d
```

Open http://localhost:8080 (or your `BETTER_AUTH_URL`). Migrations run on API
startup; if they fail the container exits instead of serving a broken API.
They are retried for about a minute first, so an app container that boots
before its database is reachable does not fail the deployment. If they still
fail, the log ends with the database host from `DATABASE_URL` and a checklist
— `ENOTFOUND <host>` means the name does not resolve: the database service is
not running, the hostname does not match, or the two are on different Docker
networks.

**What you need:**

| Requirement                                                             | Why                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Docker host with ~1 GB RAM and disk for repo clones                     | Scans clone repos and run `npm install` in a temp dir                      |
| PostgreSQL 16 (the compose service, or a managed DB via `DATABASE_URL`) | All app and auth data                                                      |
| `BETTER_AUTH_SECRET` (min 32 chars)                                     | Signs session cookies. **Required** — compose refuses to start without it  |
| `SECRETS_KEY`                                                           | Encrypts Dokploy/Telegram/SMTP secrets at rest. **Required**               |
| `BETTER_AUTH_URL` + `CORS_ORIGIN` = your public origin                  | Auth cookies and CORS are rejected otherwise                               |
| TLS in front (reverse proxy)                                            | Cookies are `Secure` as soon as the URL is HTTPS                           |
| `GITHUB_TOKEN` (optional)                                               | Private repos, and the auto-fix PR/merge/push flow                         |
| `ENABLE_SCHEDULER=true` on **one** instance                             | Scheduled scans — without it, repo schedules are stored but never run      |
| `GIT_COMMIT_SHA` (optional)                                             | `GET /api/health` reports which build is running — makes deploys checkable |

Notes:

- **The API image runs as an unprivileged user** and ships a pinned Nuclei
  (build arg `NUCLEI_IMAGE`) with templates baked in.
- **The web image bakes its API URL at build time.** With no `VITE_API_URL` the
  build emits same-origin URLs, which is what the bundled nginx proxy expects —
  that is the default and the recommended setup. Only set the build arg if the
  API lives on a different origin, and rebuild the image when it changes.
- **Behind another reverse proxy**, forward `X-Forwarded-For`: rate limiting
  keys off it.
- **Scans execute untrusted repo lifecycle scripts** on the API host. Only add
  repos you trust, and prefer a disposable host. See [SECURITY.md](SECURITY.md).

Without Docker: build with `pnpm run build`, run migrations with
`pnpm run db:migrate`, then start the API with `node apps/api/dist/index.js`
and serve `apps/web/dist` as static files behind a proxy that forwards `/api`.

### Nixpacks (Dokploy and similar)

`nixpacks.toml` builds **one service** that serves both parts: the API answers
`/api/*` and serves the web build for everything else. Together with a
PostgreSQL service that is the whole deployment.

- One domain, pointed at the API's port (`PORT`, default `3001`).
- **Leave `VITE_API_URL` unset** so the bundle uses relative URLs. Same origin
  means no CORS between two hosts, and no rebuild when the URL changes.
- `CORS_ORIGIN`, `BETTER_AUTH_URL` and `APP_URL` all get that same public URL.
- Migrations run from the start command. `drizzle-kit` is a dev dependency, so
  do not prune dev dependencies before that step.
- `git` is declared in `nixpacks.toml`: scans clone repositories and the
  workflows push branches.

The API only serves static files when `apps/web/dist` exists, so the Compose
setup — where nginx serves the web and proxies `/api` — is unaffected.

## GitHub access

**Recommended: a GitHub App.** Under **Settings → GitHub**, **Create GitHub
App** creates one for Moatline in two clicks, the way Dokploy does it: GitHub
shows the app pre-filled (on your account, or on an organization you name),
you confirm, then install it on the accounts whose repositories Moatline
should see. Repositories of those accounts then use installation tokens that
last an hour and belong to no person. The app asks for contents, pull
requests and workflows (write) and checks and statuses (read), and receives
no webhooks. `APP_URL` must be the public URL of the web app — GitHub sends
the browser back there.

Each organization stores its own GitHub token under **Settings → GitHub**,
encrypted at rest and never returned to the client. An organization's token
wins; `GITHUB_TOKEN` on the server is the fallback for single-tenant
deployments. With neither, only public repositories can be scanned — an
invalid or expired token also falls back to the public path rather than
failing the scan.

Required permissions, by what you actually use:

| Feature                                                        | Permission                    |
| -------------------------------------------------------------- | ----------------------------- |
| Scan private repos (read `package.json`, list branches, clone) | Contents: read                |
| Update workflow and security auto-fix (push a branch)          | Contents: write               |
| Open, find and merge pull requests                             | Pull requests: read and write |

A fine-grained token limited to the repositories you scan is preferable to a
classic `repo` token. For repositories owned by a GitHub organization,
fine-grained tokens must be approved by an organization owner — without that
you get 404s for repositories that plainly exist. Prefer a machine user or a
GitHub App over a personal token, so scans keep working when someone leaves.

### GitLab, Bitbucket, Gitea and Forgejo

Repositories on other hosts work the same way: scans, update and security
pull requests, waiting for CI, merge and the branch overview. Add each host
under **Settings → GitLab, Bitbucket, Gitea / Forgejo**. The token is tested
before it is stored, and every token is encrypted on its own.

| Host                               | URL                                       | Token                                                                                                                                  |
| ---------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GitLab (gitlab.com or self-hosted) | empty for gitlab.com, else the instance   | Personal, group or project access token, scope `api` (`read_api` + `read_repository` for scans only)                                   |
| Gitea / Forgejo (Codeberg too)     | the instance, e.g. `https://codeberg.org` | Access token with repository read/write (and user read for the test)                                                                   |
| Bitbucket Cloud                    | —                                         | API token with repository and pull request read/write, with the Atlassian account email — or a repository/workspace access token alone |

Repositories on github.com, gitlab.com, bitbucket.org and codeberg.org are
recognized by their URL; self-hosted ones once their host is added. Hosts must
use `https://`. Gitea, Forgejo and Bitbucket have no API to revert a commit:
there the deploy guard rolls back through Dokploy only and asks for the
revert by hand.

### Branches

Each repository page lists its branches and whether they still hold work:
**merged** (every commit is in the default branch, or the branch's pull
request was merged — squash merges included), **open pull request**, or
**not merged**. Merged branches nobody deleted keep showing up as open in
editors and tools; with a token that may write, they can be deleted from
there, one by one or all at once. Each one is checked again right before it
is deleted, and branches with work that is not in the default branch, the
default branch and protected branches are never deleted.

## Komodo and Portainer

Next to Dokploy and Coolify, Moatline works with stacks on **Komodo** and
**Portainer** that deploy from a Git repository. Connect them under
Settings: Komodo with an API key and secret (Komodo → Settings → API keys),
Portainer with an access token (My account → Access tokens).

Every 15 minutes, and when a repository's settings open, each repository is
linked to the stack that deploys it (same repository on any Git host, the
default branch when there are several); a link can also be set by hand.
Linked stacks get merge and deploy, the deploy guard, self-healing
(restarts), the redeploy button for containers and matching of the
containers servers report. Neither platform keeps a previous build to go
back to: when a deploy breaks the site, Moatline reverts the merge in git
and deploys again. Portainer stacks with GitOps updates (polling or a
webhook) deploy a push by themselves, so Moatline does not deploy them a
second time; a Komodo stack's webhook is not visible through its API, so
Moatline always deploys it.

## Scheduled jobs and the platforms themselves

**Scheduled jobs** (Monitoring → Jobs): backups, cleanups and imports that
fail without a sound. Each watched job gets a URL to call after it ran —
`curl -fsS https://…/api/ping/<token>`, with `/start` before the run to time
it and `/fail` to report a failure at once. Silent longer than its period
plus grace, it is reported as missed; when it reports in again, as back.
The check runs every minute, outside the job's own server.

**Platforms** (Monitoring → Platforms): the version of each connected
Dokploy, Coolify, Komodo and Portainer, against the security advisories its
project publishes on GitHub, with the latest release. Checked every six
hours; an advisory that affects the installed version is notified once.

## Maintenance windows and grouped alerts

**Maintenance** on a server or repository page (30 minutes to 8 hours; the
API also takes the whole organization): alerts for what it covers are held
back — a repository is covered by its server's window too — and status
pages show "maintenance" instead of "down".

**Outages are grouped per server:** sites on the same server that go down
within a minute arrive as one message, "3 sites on web-1 are down" — and
when the server's agent went silent too, it says the server is the likely
cause.

## Database migrations

For Payload, Prisma and Drizzle projects, Moatline reads the migrations
before they run — every five minutes, on the default branch and on every
open pull request:

- **Pull requests and merged-but-not-deployed commits** that add a migration
  dropping a table or column, truncating or deleting every row (a renamed
  collection or field looks exactly like that to the migration tool), or
  changing a column's type or making it required. Only a TypeScript
  migration's `up` counts. Each finding is notified once per change set.
- **The setup:** `push: true` in the Payload database adapter, migrations
  that nothing runs in production (no `payload migrate` before the start and
  no `prodMigrations`), and `prisma db push` or `drizzle-kit push` in the
  start or build scripts.

It shows on the repository page under **Database migrations**.

## Checks from several locations

A site that fails a live check is only called down once a second location
sees it too: a broken route from Moatline's own server is not an outage,
and an outage of that server's network is still seen from outside. The
other locations are **probes** — a tiny image (`moatline-probe`, one file,
no dependencies) that asks the API what to check, checks it and reports
back. Sites that fail are checked from every probe each minute, the others
every five minutes. If no probe answers, an outage opens after four failed
checks instead of two. Each site's page shows what every location saw last.

1. On the API, name a token per probe:
   `PROBE_TOKENS=falkenstein:<long random token>,ashburn:<another one>`
   (and `PROBE_HOME_NAME=Nuremberg` to name the API's own location).
2. Run a probe wherever it should check from:

   ```bash
   docker run -d --restart unless-stopped --name moatline-probe \
     -e MOATLINE_URL=https://app.moatline.dev \
     -e PROBE_TOKEN=<its token> \
     ghcr.io/janikhalder/moatline-probe:latest
   ```

## Status pages

Under Settings → Status pages, pick sites for a public page at
`/status/<address>`: whether each one is up, its uptime as 90 daily bars and
the outages of the last 30 days. Nothing internal shows — no causes, logs or
URLs. It refreshes itself every minute and needs no account to read.

## Team and registration

**Registration is invitation only.** The very first account can be created
freely so a fresh deployment can be bootstrapped; after that, sign-up only
works for an address with a pending invitation. Everyone else gets a clear
message on the login screen instead of an account.

Invite colleagues under **Team** in the sidebar: enter an email, pick a role
(`member`, `admin`, `owner`) and send. The invitee gets a link to
`/accept-invitation/<id>`, which works without being signed in — they register
with the invited address (the invitation allows it), open the link again and
accept. From then on they share the organization's repos, scans and findings.

The invitation email goes out over the organization's SMTP settings under
**Settings**. If no SMTP server is configured nothing is lost: the invite link
is shown right after inviting, so it can be passed on by hand. Pending
invitations are listed with a Cancel action, and members can be removed.

`APP_URL` decides which host the emailed link points at.

**Adding someone without any email at all**: under **Team → Create an account
directly**, an owner or admin enters an address, an optional name and a role.
The account is created immediately with a generated 20-character password,
which is shown once for you to pass on — nothing is sent anywhere, so no SMTP
is needed. The password is stored only as a hash and cannot be shown again;
the recipient can change it via "Forgot password?" (which does need SMTP) or
you create the account again. An address that already has a login is simply
added to the organization, without touching its password.

### Forgotten passwords

The login screen has a **Forgot password?** link. The reset mail goes out over
the SMTP settings of an organization the user belongs to, so **SMTP must be
configured for password resets to work** — without it the request still answers
"check your email" (addresses must not be probeable) and the API logs that no
mail could be sent. Reset links are valid for one hour and single use.

## Update workflow

The "Update packages" action creates an update run and runs a **safe update workflow** so the main app never gets touched:

1. **New branch** – Each run uses a dedicated branch (`deps/update-<timestamp>`).
2. **Isolated clone** – Repo is cloned into a temp dir; all steps run there.
3. **Steps** – Clone → checkout new branch → `npx npm-check-updates -u --target minor` (or `latest`) → align released-together packages → install → check → **version match** → commit & push → open a PR.
4. **Version match** – Payload (`payload` + `@payloadcms/*`), Next.js (`next`, `@next/*`, `eslint-config-next`), React (`react`, `react-dom`) and Lexical only build with all their packages at one exact version. A typecheck passes either way; the deploy then fails. So declared versions are first aligned to the leader (`payload`, `next`, `react`), and after the install the resolved versions are compared — including copies a plugin pulls in. A mismatch fails the check and is listed in the log and the PR. Security fixes run the same check.
5. **Merge & deploy** – the run card's button squash-merges the PR on GitHub (branch protection still applies) and deploys with Dokploy. If the Dokploy application deploys on push (its auto deploy), the webhook does it and nothing is triggered twice.

Requires **GITHUB_TOKEN** (repo push). See [docs/UPDATE_STRATEGY.md](docs/UPDATE_STRATEGY.md) for the full strategy.

## Security pipeline (CVEs → auto-fix → auto-deploy)

Scheduled and live scans read the **lockfile through the GitHub API** (`pnpm-lock.yaml`, `package-lock.json` or `yarn.lock`, next to `package.json` or at the workspace root) and send the exact installed versions to the advisory database `npm audit` itself uses (`/-/npm/v1/security/advisories/bulk`) — no clone, no install, no child process, so twenty repositories due at 03:00 cost a few HTTP requests. The results match `npm audit` advisory for advisory. A repository without a lockfile falls back to the clone; scheduled scans run two at a time. **Scan now** runs the full scan: clone, the package manager's own audit and unused-dependency detection (depcheck); scheduled scans keep the unused list of the last full scan. Vulnerabilities are recorded with severity, GHSA id, vulnerable range and fix availability. The **Dashboard** aggregates open CVEs by severity across the org; each repo detail shows a CVE table.

For repos that opt in (per-repo settings, **all off by default**), a critical/high CVE with an available fix triggers an autonomous workflow. Each step only runs if the one before it is enabled — a strict escalation ladder:

1. **Auto-fix** – branch `security/cve-fix-<ts>` → **audit the lockfile** → fix → re-resolve the lockfile → **audit again** → push → open a PR. Nothing is installed for the fix itself: the lockfile says what is installed, the advisory database what is vulnerable, and each manager re-resolves its lockfile without downloading packages (`pnpm install --lockfile-only`, `npm audit fix --package-lock-only`, `yarn install --mode=update-lockfile`; Yarn 1 has no such mode and installs). A run takes seconds and a few hundred MB instead of minutes and gigabytes. Installing and a typecheck only happen when the check needs them: a dependency in `package.json` changed, a major upgrade was allowed, or the repo is set to a full build — moving locked versions within their major is what any install does anyway. Packages released together (Payload, React, Lexical, Next.js) move as one, to the smallest fixed version, and any member left behind is pinned to its leader's version before the PR — the mismatch that makes a Payload deploy refuse to start. An open PR with a mismatch gets **Fix versions on the branch**. Each package manager fixes its own way and commits only its own lockfile:
   - **npm**: `npm audit fix --package-lock-only` (`--force` only if allowed).
   - **pnpm**: overrides in the shape `pnpm audit --fix` writes (`"pkg@<range>": "^patched"`, into `pnpm-workspace.yaml` when overrides live there on pnpm 10), only within the installed major unless "allow --force" is on.
   - **yarn**: no audit fix exists; each vulnerable package gets a `resolutions` entry pinned to its patched version's major, then `yarn install`.
   - In a workspace the lockfile, install, audit and fix run at the workspace root, found by walking up from the package.
2. **Auto-merge** – requires all four: build/tests pass, the diff is limited to `package.json`/lockfile, the second audit shows advisories actually resolved and none introduced, and **GitHub's own checks on the branch report success** (a repo with no CI is passed through, and says so in the log). Then squash-merge (respects branch protection; never forces).
3. **Auto-deploy** – trigger a Dokploy deploy (`POST /api/application.deploy`) for the repo's application. A 200 means _accepted_ (Dokploy exposes no completion poll) — what actually went live is answered by the repo's live URL, below.

4. **Deploy guard** – after every deploy the repo's live URL is watched: does the new commit take over, and does it — with the site root, and `/admin` when the repo uses Payload (the admin breaks on its own: version mismatches, missing migrations) — keep answering for two more minutes? A healthy deploy is scanned again right away (the deployed commit when the live URL reports one), so the dashboard shows what is live now. A deploy that never takes over is `build_failed` (Dokploy kept the old version running); one that comes up and then fails, or never comes back, is `broken`. With **automatic rollback** on (per repo, needs a live URL) Moatline then goes back: Dokploy's `rollback.rollback` to the previous kept image when the application has rollbacks enabled (instant, no build), and a revert commit of the merge on the default branch through the GitHub API — only while the merge is still the tip, never over someone else's commits. Without a Dokploy rollback the revert is deployed. Off, it notifies; **Roll back this deploy** on the repo page does the same by hand.

You can also trigger a fix manually ("Fix critical CVEs") or a deploy manually.

**Dokploy applications** are linked to repositories automatically every 15 minutes (and when a repository's settings open): the application deploying the same GitHub repository — on the default branch, when there are several — is linked; ambiguous ones are picked in **Settings → Dokploy application**. The link brings the application's Docker service name, which ties the containers servers report to the repository: their **image CVEs and memory findings** show under **Live application**, and the repository's server is filled in when nobody set one. Only application fields are read from `project.all`; the database credentials in that response are dropped.

**Integrations** (org-level, under **Settings**): Dokploy base URL + API token; Slack webhook; Telegram bot token + chat id; SMTP for email. Secrets are AES-256-GCM encrypted at rest (`SECRETS_KEY`) and never returned to the client. Notifications fire on new critical CVEs, PR opened/merged, deploy triggered and failures.

### What a scan can and cannot say

- **Audits run for npm, pnpm and yarn.** npm reports the v2 tree format, pnpm and yarn the older per-advisory one; both are normalized to the same rows.
- **An audit that could not run is never shown as a clean result.** The reason is recorded on the scan and displayed in place of the CVE table — an empty list would otherwise read as good news.
- **A fix has to prove itself.** The security pipeline audits before and after `npm audit fix` and records what was resolved, what remains and what the fix _introduced_. Auto-merge requires that proof; a PR that fixes nothing stays open for a human.

### Is it actually live? (per-repo live URL)

A deploy trigger only proves the platform accepted the request. To close that gap, each repository can carry a **live URL** (repo → **Settings → Live URL**). With Dokploy configured, **Load from Dokploy** offers the domains that already point at the application, so the URL is picked rather than typed.

What the URL buys you:

- **Check now** on the repo's _Deployment_ card: status, HTTP code, the reported commit and when it was last looked at. The repo list carries the same as a `Live` / `Down` badge.
- **After every triggered deploy** the URL is watched for ~10 minutes and the deploy run records what happened out there. A failure also goes out through the configured notification channels.

Two levels of proof, and the app never conflates them:

- The target reports a **commit** and it changes → the new build is demonstrably serving. The watch ends there.
- It reports no commit → only reachability can be shown, and it is labelled as exactly that. The old version answering looks identical to the new one.

So point the live URL at an endpoint that returns a JSON `commit` field. This app serves one itself:

```bash
curl -s https://your-instance.example.com/api/health
# {"ok":true,"commit":"752de05…","startedAt":"…","scheduler":true}
```

`commit` comes from `GIT_COMMIT_SHA` (or `GIT_SHA`, `COMMIT_SHA`, `SOURCE_COMMIT`, …), otherwise from `git rev-parse HEAD` in the deployed checkout, otherwise `null`. `scheduler` reports whether _this_ process runs scheduled scans — otherwise invisible when several instances are up.

Live URLs on private, loopback or link-local addresses are refused unless the API runs with `ALLOW_PRIVATE_LIVE_URLS=true`: without that limit, anyone who can edit a repository could aim the checker at internal hosts.

**Servers on a Tailscale tailnet** are a separate case with its own switch, `ALLOW_TAILNET_LIVE_URLS=true` (recognized: `100.64.0.0/10`, `fd7a:115c:a1e0::/48`, `*.ts.net`). Note what the flag does _not_ do: it does not connect anything. The API container has to be a node on that tailnet itself — `tailscaled` in userspace mode with an auth key, ideally a tagged node whose ACLs only reach the ports being checked. Without that, the checks can only time out.

### Languages

The interface switches between English and German (EN / DE in the header, remembered per browser; the first visit follows the browser language). Texts are translated where they are written: the English text is the key (`t("Repositories")`) and `apps/web/src/locales/de.ts` holds the German, so a text without a translation shows in English instead of breaking. The whole interface is translated (sign-in, dashboard, repositories, servers, clients, monitoring, settings, team, audit log, account). Server-side texts — notifications, finding details, the findings export — are still English. `apps/web/scripts/i18n-codemod.mjs` wraps a file's visible English text in `tx("…")` (review the diff), and route content remounts on a language switch so `tx()` outside hooks stays current. The monthly client report has its own language per client.

### Clients, domains and the monthly report

**Clients** group what belongs to one customer: repositories, servers and domains (assign them on the client page or in a repository's settings). **Domains** come from the live URLs automatically, or are added by hand, and are checked daily: the certificate (TLS handshake — expiry under 14 days means renewal stopped), the registration (RDAP from the registry via IANA's bootstrap; .at and .de do not publish the date) and mail authentication (MX, SPF, DMARC and its policy, DKIM for the selectors of Resend, Google, Microsoft and others — a wildcard answer is recognised and not counted). New problems notify. The **monthly report** per client (German or English, per client) is printable HTML — print to PDF: vulnerabilities closed in the month (latest scan before vs. at its end), updates and fixes merged, deployments and rollbacks, open critical/high findings, mobile Lighthouse, site security, domains with certificate, registration and mail status, and the servers' pending security updates.

### Performance (Lighthouse)

With a free **PageSpeed Insights API key** (Settings → Performance; without one Google allows no runs) every live site gets a Lighthouse run, mobile and desktop, once a day and a mobile run after each healthy deploy. The page tested is the site, not the health endpoint the live URL may point at. Each run stores the four category scores, LCP, CLS, TBT, FCP, server response time, page weight and — when Google has them — Chrome's field data (75th percentile LCP, INP, CLS); 180 days are kept. The budget is a go-live gate (SEO 100, accessibility ≥ 95, LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 300 ms, < 3 MB). A clear drop against the previous run (performance −10, LCP +30 % and +0.5 s, CLS over budget and +0.05) notifies, naming the deployed commit after a deploy. The repo page shows the scores, metrics against the budget and the trend; the list a "perf" badge; the findings export the missed budget items.

### Malicious packages and site security

Every lockfile audit also asks OSV for **known malicious package versions** (the OpenSSF malicious-packages list, ids `MAL-…` — worms like the npm token stealers): flagged as critical, no fix version, with the advice to remove and rotate secrets. An unreachable OSV is skipped, the CVE results stand.

**Site security** looks at every live site from outside once a day and after each healthy deploy — plain GETs like a visitor's, never a login attempt or a POST: downloadable `/.env`, `/.env.local`, `/.git/HEAD`; for Payload sites the seed route (`/next/seed` should be 404), the GraphQL playground, anonymous reads of `/api/users` and `/api/form-submissions`; plain HTTP without a redirect; HSTS, framing protection, `nosniff`, CSP, `X-Powered-By`. New critical/high findings notify; the repo page shows them under **Site security**, the list as "site issues", and the findings export includes them.

### Configuration (keys, mail, uploads)

Two sources, values never: the health endpoint's **`checks`** object (`{ "email": true, "storage": false, "mailFailures": 0 }` — flags, numbers and short strings; format in [docs/health-endpoint.md](docs/health-endpoint.md)), read with every live check (every 15 minutes), and for Payload sites linked to a Dokploy application the **environment variable names** in Dokploy (`application.one`; the values are dropped while parsing): `PAYLOAD_SECRET`, `DATABASE_URI`/`DATABASE_URL`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, mail (`RESEND_API_KEY` or `SMTP_HOST`) when a mail adapter or the form builder is installed, S3 when `@payloadcms/storage-s3` is, plus recommended `NEXT_PUBLIC_SERVER_URL` and `ALERT_RESEND_API_KEY`. A check turning false or a required variable going missing notifies; the repo page shows both under **Configuration**, the list a "config issues" badge.

### Which version is actually running

A scan reads the repository's branch — that answers "is it fixed?", which is not the question a security report is asked. With a live URL that reports a commit, **Scan the deployed version** (repo → _Deployment_) scans that exact commit instead: `raw.githubusercontent.com` and the clone both take a SHA where a branch name goes, so the deployed `package.json` and lockfile are read as they were built.

The repo detail then names the gap that matters:

- **fixed on the branch, still running live** — the fix exists and has not shipped. This is the finding that a branch-only scan reports as green.
- **open in both** — no fix available yet.
- **only on the branch** — introduced after the deployed commit was built.

Live scans are kept separate from branch scans: they do not reset the repo's scan clock and never trigger the auto-fix pipeline, because a fix belongs on the branch, not on a commit that already shipped.

**What every app has to expose for this**: a commit, over HTTP, as JSON. Nothing more — the commit is enough to reconstruct the full dependency tree from the repository, including transitive packages that a hand-maintained version list would never cover (and could get wrong).

```jsonc
// GET /health (any path — point the repo's live URL at it)
{ "ok": true, "commit": "752de05e244d374ce98fa7a841c9280b1fa19be3" }
```

`commit`, `commitSha`, `sha`, `gitCommit`, `revision` and `version` are all accepted as the field name, top level only. In most stacks it is one line reading an env var that the deployment platform sets — the same `GIT_COMMIT_SHA` this app uses.

**Scheduled scans**: set a repo's schedule (hourly/daily/weekly). One API instance with `ENABLE_SCHEDULER=true` runs due scans on a 5-minute tick, with in-process + DB overlap guards. "Due" is measured from the last scan _attempt_, so a repo whose scans keep failing waits for its next slot instead of retrying every tick, and scans left `pending`/`running` for more than two hours (API restarted mid-scan) are retired automatically — otherwise they would block that repo's schedule forever.

**Scheduled scans are not running?** In order of likelihood:

1. `ENABLE_SCHEDULER=true` is missing on the instance (the API logs `Scheduler DISABLED` on boot, and the repo list shows a warning banner).
2. The repo has no schedule — check **Settings → Scheduled scan** on the repo; the repo list shows `Manual only` for those.
3. A previous scan is stuck. The list shows `Scanning…`; it is retired after two hours, or run a manual scan once it clears.

`GET /api/system/scheduler` reports the live state (`enabled`, `lastCheckAt`, `nextCheckAt`, `scheduledRepos`, `lastError`); the repo list and repo detail surface the same information.

**Package updates**: "Update packages" clones the repo, runs `npm-check-updates -u`, installs, builds and pushes a branch. It uses the repository's own package manager — the override under repo settings if set, otherwise whatever lockfile the repo has (npm/pnpm/yarn) — and commits only that manager's lockfile. Progress is reported per phase (clone → check updates → install → build → commit & push) together with a live log, and a run in progress is picked back up when you reload the page. A branch whose build failed is still pushed, but flagged as such rather than reported as a success.

> **Safety**: `npm install`/`build`/`audit fix` execute untrusted repo lifecycle scripts on the API host. Secrets (`GITHUB_TOKEN`, `DATABASE_URL`, integration tokens) are scrubbed from those child processes, but only add repos you trust. See [SECURITY.md](SECURITY.md).

## Servers

**Servers → Add server**, then paste the one line shown on the server — for a
new server or an existing one:

```bash
curl -fsSL http://100.x.y.z:3001/api/agent/install.sh | sudo bash -s -- --enroll pce_… --trivy --crowdsec --auto-updates
```

It installs the agent plus (if missing) Trivy, CrowdSec with a firewall
bouncer and automatic security updates, then reports every 5 minutes. The
`pce_…` code is single-use and valid for an hour. Moatline never
connects to the server; with a public IP set it additionally checks open ports
and TLS from the outside. Uptime Kuma and Wazuh are configured under
**Settings**; everything comes together under **Monitoring**.

API environment for this part (all optional): `AGENT_BASE_URL` (the URL the
servers reach, e.g. a Tailscale address), `ALLOW_TAILNET_LIVE_URLS=true`,
`SCANNER_IPS` (never banned by CrowdSec), `NUCLEI_BIN`,
`NUCLEI_INTERACTSH=true`. Details: [docs/SERVER_MONITORING.md](docs/SERVER_MONITORING.md).

### Builds of security fixes and updates

Each repository chooses how a fix or update is checked before its PR
(repository settings → **Check before the PR**):

- **Typecheck** (default): `tsc --noEmit`. Catches what an update breaks in
  the code, needs no database, no secrets and little memory.
- **Full build + tests**: only for apps that build without a database. A
  Payload/Next.js app that renders pages from its database fails here — the
  check deliberately never gets credentials.
- **None**: the repository's CI decides; auto-merge then needs a green CI.

**Build server.** For apps that only build with a database, let a server of
your own build them: server → **Setup** → _Optional: build server for GitHub
Actions_ installs a self-hosted runner (unprivileged user, memory cap, low
priority; the runner fetches jobs from GitHub, no port is opened). Then set
the repository's check to **None** and copy the workflow its settings show
into `.github/workflows/build-check.yml` — every PR is built there against an
empty throwaway database (PostgreSQL with Payload migrations, or MongoDB),
never the real one. Private repositories only.

Auto-merge always also waits for the repository's GitHub CI. Whatever runs
here (install, typecheck, build) — so that it cannot take the server down,
they run **one at a time** (queued, `HEAVY_JOB_CONCURRENCY`, default 1), at
the lowest CPU and disk priority (`nice`/`ionice`), with the Node heap capped
at `BUILD_MEMORY_MB` (default 2048). A build is skipped — and the PR not
auto-merged — when less than `BUILD_MIN_FREE_MB` (default: the heap cap) is
free, and a timeout ends the build with all its workers. Also give the
Moatline app a memory limit in Dokploy (Advanced → Resources, e.g.
4 GB): then a runaway build is stopped inside its container instead of the
kernel picking processes across the whole server.

## Structure

- `apps/web` – Vite + React + TanStack Router + shadcn-style UI; Better Auth client; repos list, repo detail, findings, org switcher.
- `apps/api` – Hono server; Better Auth (Drizzle + Organization plugin); tenant middleware; repos, scans, packages, update-runs routes.
- `packages/db` – Drizzle schema (auth + app tables), migrations.

## Security

See [SECURITY.md](SECURITY.md) for security measures (headers, CORS, rate limiting, auth cookies, URL validation) and a production deployment checklist.

## Improvements

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for done and planned improvements (env validation, scan defaultBranch, packages “latest per repo”, error feedback, and more).
