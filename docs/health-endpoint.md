# The health endpoint

Moatline learns two things from a site's live URL when it answers
JSON: **which commit is deployed** and **whether its configuration works**.
Both are optional — without them the URL is still checked for being up.

## Format

```json
{
  "ok": true,
  "commit": "3f2c1ab9e4d7…",
  "checks": {
    "email": true,
    "storage": true,
    "database": true,
    "mailFailures": 0,
    "lastMailAt": "2026-10-04T11:02:00Z"
  }
}
```

- **`commit`** — the git SHA the running build was made from. Also read from
  `commitSha`, `commit_sha`, `sha`, `gitCommit`, `git_commit`, `revision` or
  `version` (top level only). With it, Moatline scans exactly what is
  deployed, rescans when it changes and knows when a deploy went live.
  Without it, a linked Dokploy application's last successful deploy is used.
- **`checks`** — the app's own report on its configuration: up to 30 keys,
  each a boolean, a number or a short string (≤ 100 characters). **Never put
  secret values here** — only whether something is set and works. A check
  that turns `false` sends a notification; the repository page shows them
  under _Configuration_.

## Next.js example

```ts
// app/api/health/route.ts
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    commit: process.env.GIT_COMMIT_SHA ?? null,
    checks: {
      email: !!(process.env.RESEND_API_KEY || process.env.SMTP_HOST),
      storage: !!process.env.S3_BUCKET,
      serverActionsKey: !!process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,
    },
  });
}
```

Set `GIT_COMMIT_SHA` at build time — on Dokploy and Coolify a build argument
from the platform's commit variable, in GitHub Actions `${{ github.sha }}`.

Point the repository's **live URL** at this endpoint (e.g.
`https://example.com/api/health`); performance runs and the security probe
still test the site's root page.
