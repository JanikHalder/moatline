# Security

Measures in place for production deployment.

## Application

- **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (geolocation, microphone, camera disabled).
- **CORS**: In production `CORS_ORIGIN` is required. Multiple origins supported (comma-separated). Only these origins (and in dev `http://localhost*`) are accepted; no wildcard.
- **Rate limiting**: 100 requests per minute per client IP. The IP is the address the reverse proxy saw (right-most `X-Forwarded-For` entry — the client cannot write it); `CF-Connecting-IP` is used only when that address is a Cloudflare edge, so it cannot be forged by reaching the origin directly. Returns 429 with `X-RateLimit-*` headers.
- **Two-factor authentication**: TOTP (authenticator app) plus ten single-use backup codes, under Account → Security. Owners and admins need it for everything that hands out access or redirects secrets (agent install codes, servers, integrations, members) — the API refuses those actions without it (`REQUIRE_ADMIN_2FA=false` lifts this for a local instance). Enabling only takes effect after a code from the app proves the secret was stored.
- **Audit log** (owners/admins, sidebar → Audit log): sign-ins, 2FA and password changes, servers (added, deleted, install codes, enrolment, revoked tokens, Nuclei scans), integrations (which settings changed — never secret values), members, repository settings including every change to auto-fix/auto-merge/auto-deploy, security fixes and deploys. Each entry has the user and the client IP as described below.
- **Login throttling per account**: 10 sign-in and 10 two-factor attempts per 15 minutes and 5 password-reset requests per hour _per email address_, whatever the IP — rotating addresses does not help a password guesser.
- **Auth (Better Auth)**:
  - `trustedOrigins` set from `CORS_ORIGIN` so only allowed frontend origins can use auth.
  - Secure cookies when `NODE_ENV=production` or `BETTER_AUTH_URL` is HTTPS (`secure`, `sameSite: lax`).
- **Invitation-only registration**: sign-up is rejected unless the address has a pending, unexpired invitation. The single exception is the first account on an empty database, so a new deployment can be bootstrapped. Enforced in front of the auth routes (`middleware/signup-gate.ts`), not in the client.
- **GitHub access per organization**: each organization has its own encrypted token, so one instance can serve several organizations without sharing repository access. `GITHUB_TOKEN` remains an instance-wide fallback — leave it unset when organizations must stay isolated, otherwise every organization inherits its access.
- **Password reset**: tokens are single use, expire after one hour, and the request endpoint answers identically for known and unknown addresses so accounts cannot be enumerated.
- **Login gate**: the web app requires a login by default. The demo-org bypass (`VITE_DISABLE_LOGIN=true`) is only honored in a dev build; production builds always show the login screen.
- **Input validation**: Repo creation and scan only accept `https://github.com/owner/repo` URLs (no other hosts or protocols). Zod validation on API payloads.
- **Startup checks**: In production the API exits if `DATABASE_URL`, `BETTER_AUTH_SECRET` (min 32 chars), or `CORS_ORIGIN` is missing. A warning is logged if `SECRETS_KEY` is unset (integration secrets can't be saved without it).

## Security auto-fix & deploy pipeline

- **Opt-in, off by default**: `autoFixCritical`, `autoMerge`, `autoDeploy` are per-repo and default `false`, in a strict escalation ladder (`autoDeploy ⇒ autoMerge ⇒ autoFixCritical`) enforced in the API.
- **Authenticated for autonomy**: enabling `autoMerge`/`autoDeploy` and editing org integrations require a real session (the demo-org bypass is rejected). Note: the demo org is only reachable in dev or when `ENABLE_DEMO_ORG=true`.
- **Untrusted code execution**: `npm install`, `npm run build`, `npm test` and `npm audit fix` run the target repo's lifecycle scripts on the API host. Mitigations: secrets (`GITHUB_TOKEN`, `DATABASE_URL`, integration tokens) are **scrubbed from the child environment**; the audit lockfile step uses `--ignore-scripts`; steps run under timeouts in a temp dir that is always cleaned up. **Only add repositories you trust.** For stronger isolation, run the API's fix workers in a disposable sandbox.
- **Auto-merge guardrails**: merges only when the local build **and** tests pass and the diff is limited to `package.json`/lockfile. GitHub branch protection / required checks are respected (a 405 leaves the PR open; nothing is force-merged). Note that a local green build is **not** the same as your GitHub CI.
- **Secrets at rest**: GitHub/Dokploy/Telegram/SMTP secrets are AES-256-GCM encrypted with `SECRETS_KEY` and never returned to clients (only "configured" flags are exposed).
- **Deploy**: Dokploy deploys are triggered via `x-api-key`; a 200 is recorded as "triggered" (accepted), not a confirmed live deploy.
- **Scheduler**: gated behind `ENABLE_SCHEDULER` so only one instance schedules; overlap is prevented in-process and via a DB check. Multiple API replicas would need a Postgres advisory lock.

## Server monitoring

- **Push-only agent**: servers report in with a per-server token; the app holds no SSH keys or credentials for them and the agent accepts no commands.
- **Agent tokens**: 256-bit random, shown once, stored as SHA-256. They can only submit reports for their own server — schema-validated, size-limited (8 MB), rate-limited per token, rejected when the timestamp is more than 15 minutes off. Issuing, rotating and revoking require owner/admin.
- **Untrusted report content**: strings are clipped, reference links kept only for `http(s)` (no `javascript:`/`data:` URLs).
- **Agent hardening**: stdlib-only Python with a published checksum; systemd units with `CapabilityBoundingSet=CAP_DAC_READ_SEARCH`, `NoNewPrivileges`, `ProtectSystem=full`, CPU/memory quotas. TLS is verified; plain http is refused.
- **Nuclei**: no `dos`/`fuzz`/`intrusive`/`brute-force` templates, no `code`/`file`/`headless`/`javascript` protocols, no interactsh by default, local network blocked unless explicitly allowed, raw requests/responses not stored.
- **Integrations**: Kuma key and Wazuh password encrypted at rest; Wazuh only over https with an optional pinned CA (verification is never disabled); all integration URLs go through the same SSRF rules as live URLs. Changing integrations requires owner/admin.
- **API container** runs as an unprivileged user.

See [docs/SERVER_MONITORING.md](docs/SERVER_MONITORING.md) for the full threat table.

## Deployment checklist

1. Set `NODE_ENV=production`.
2. Use HTTPS for API and frontend (reverse proxy with TLS).
3. Set `DATABASE_URL` to a dedicated DB user with minimal required privileges.
4. Generate a strong `BETTER_AUTH_SECRET` and `SECRETS_KEY` (e.g. `openssl rand -base64 32` each). `SECRETS_KEY` encrypts stored integration secrets — rotating it invalidates previously stored secrets.
5. Set `BETTER_AUTH_URL` to the public API URL (e.g. `https://api.example.com`).
6. Set `CORS_ORIGIN` to the frontend origin(s), e.g. `https://app.example.com` or `https://app.example.com,https://admin.example.com`.
7. Keep `GITHUB_TOKEN` server-side only; use for private repo access if needed.
8. Run DB migrations from a controlled environment; do not expose Drizzle or DB publicly.
9. Prefer a single rate-limit store per deployment (e.g. Redis) if you run multiple API instances; the default in-memory store is per process.

## Reporting

If you find a security issue, **report it privately** — do not open a public
GitHub issue.

1. Prefer
   [GitHub Security Advisories](https://github.com/JanikHalder/moatline/security/advisories/new)
   on the public repository (private vulnerability reporting is enabled).
2. Or email [info@janikhalder.at](mailto:info@janikhalder.at) with a clear
   description, impact, and steps to reproduce if you have them.

We will acknowledge reports and work on a fix before any public disclosure.
