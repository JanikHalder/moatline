# AI agents and MCP

Moatline exposes your organization's **servers, findings, repositories and
uptime** to coding assistants (Claude, Cursor, and others) over
[MCP](https://modelcontextprotocol.io/) — with **scopes**, optional
**allowlists**, an **audit trail**, and org **automation policy**. Nothing
over MCP can change integration settings, issue server install codes, or
remote-control agents.

## Create an API key

1. Sign in as an owner or admin.
2. Open **Settings → API keys (MCP)**.
3. Name the key (for example `Claude on Alex's laptop`).
4. Choose scopes (see below) and, if you want, limit the key to specific
   repositories and servers.
5. Copy the key once — only a hash is stored.

Connect Claude Code:

```bash
claude mcp add --transport http moatline https://YOUR-MOATLINE/api/mcp \
  --header "Authorization: Bearer pck_…"
```

Replace `YOUR-MOATLINE` with your cloud URL or self-hosted `PUBLIC_URL`.

## Scopes

| Scope             | What the key may do                                                                    |
| ----------------- | -------------------------------------------------------------------------------------- |
| **read** (always) | Overview, servers, findings, uptime, repositories, findings markdown report, audit log |
| **scan**          | Start Nuclei and repository dependency scans                                           |
| **fix**           | Open lockfile-only security-fix pull requests (if org policy allows)                   |
| **members**       | List organization members (role and 2FA status — not granted by default)               |

Read-only keys are enough for questions like “what is down?” or “which repos
have critical CVEs?”. Grant **scan** or **fix** only when the assistant should
**start** work, not just read state.

Keys can be **updated** later (scopes and allowlists) without rotating the
secret.

## Findings for an agent

Two ways to give an agent actionable work:

1. **In the app** — on a repository, use **Copy findings for agent** (markdown
   task list).
2. **Over MCP** — tool `get_findings_report` with the repository name or id.

Security fixes can be opened manually in the UI, triggered automatically when
auto-fix is enabled, or started with MCP tool `start_security_fix` (needs
**fix** scope).

Every **scan** and **fix** MCP call is written to the audit log. Read-only
tools are not logged, so the log stays usable.

## Org automation policy

Under **Settings → Automation & AI agents**:

- **Default auto-fix on new repositories** — new repos start with critical
  CVE auto-fix enabled (you can still change each repo).
- **Allow security fixes over MCP** — kill-switch for the **fix** scope.
- **Require pull-request review** — blocks auto-merge and auto-deploy on
  repositories. When you turn this on, Moatline **turns off** auto-merge and
  auto-deploy on repos that already had them enabled. Fixes still arrive as
  PRs for humans to merge.

Filter **Audit log → Agents & automation** for MCP, API key, and security-fix
events.

## What MCP cannot do

- Change Dokploy, GitHub, or notification settings.
- SSH into servers or run commands on hosts.
- Revoke or create API keys (those require an admin session in the browser).

For the full tool list and HTTP details, see
[Server monitoring](/reference/server-monitoring) (MCP section).

Next: [Security model](./security) · [FAQ](./faq)
