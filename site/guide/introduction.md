# Introduction

Dokploy and Coolify make deploying easy. What happens afterwards is left to
you: is the server patched, does the app depend on a vulnerable package, do
the backups actually run, is the database open to the internet, did last
night's deploy break the admin?

Moatline is that layer. It watches four things and connects them:

| Layer        | What it looks at                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Code**     | npm dependencies from the lockfile, malicious packages, outdated and unused packages, the versions of Payload, Next.js, React and Node |
| **Deploys**  | every deploy through Dokploy or Coolify, the live URL before and after, the build status                                               |
| **Servers**  | the host (updates, load, disk, CrowdSec, Trivy, signs of compromise) and every running container and image                             |
| **Platform** | databases, backups, images, unmanaged containers, servers without an agent, domains and certificates                                   |

Because it sees all four, it can act: a vulnerable package becomes a pull
request, a merged fix becomes a guarded deploy, a broken deploy becomes a
rollback, a stuck app becomes a restart — each one optional, visible and in
the audit log.

Pricing is the same idea: self-hosted free, cloud from a flat monthly price
with Stripe checkout — no demos, no seat games, every feature in every plan.

## AI agents and automated code

Coding agents (Claude, Cursor and others) can read this organization's data
over MCP: findings, uptime, servers, repositories. Keys have scopes (`read`,
`scan`, `fix`), optional allowlists, and every tool call is audited. Org
policy can require pull-request review (no auto-merge), disable MCP security
fixes, and default new repositories to auto-fix critical CVEs.

## What it is not

- **Not a platform.** It deploys through Dokploy or Coolify, never instead
  of them.
- **Not a remote control.** The server agent only reports; it opens no port
  and accepts no commands.
- **Not a log store.** It keeps error lines (scrubbed), not your logs.
- **Not a sales-led security suite.** You buy online or self-host; there is
  nothing to negotiate.

Next: [Quick start](./quick-start).
