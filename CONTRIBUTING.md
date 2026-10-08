# Contributing

Thanks for helping. A few things keep this project easy to work on.

## Public and development remotes

This tree is published as **[moatline](https://github.com/JanikHalder/moatline)**
(public). Day-to-day work often uses a private development remote
(**[moatline-dev](https://github.com/JanikHalder/moatline-dev)**).

If both remotes are configured locally:

| Remote   | Repository     | Use for                                     |
| -------- | -------------- | ------------------------------------------- |
| `origin` | `moatline`     | Public `main`, releases, what outsiders see |
| `dev`    | `moatline-dev` | WIP branches, experiments, private drafts   |

```bash
# Typical day-to-day (private)
git push -u dev HEAD

# Publish a finished branch or main to the public repo
git push origin main
# or: git push origin HEAD:main
```

Do **not** push secrets, customer data, internal notes, or half-finished
experiments to `origin`. Prefer PRs against public `main` for reviewable
changes; keep unfinished work on `dev`.

Maintainers: after merging on `dev`, fast-forward or merge into public
`main` only when the tree is ready to show.

## Checks

- **Run before a PR**: `pnpm lint`, `pnpm format:check`, `pnpm build`,
  `pnpm --filter api test`, `pnpm --filter web test`. CI also runs the
  migrations against PostgreSQL and the Playwright end-to-end tests.
- **Migrations**: add a numbered SQL file in `packages/db/drizzle/` and an
  entry in `meta/_journal.json`. Make them idempotent (`IF NOT EXISTS`) and
  never edit one that was released.
- **UI text** is English in the code and translated in
  `apps/web/src/locales/de.ts` (the English text is the key). New strings
  need a German entry.
- **Platforms**: Dokploy and Coolify implement one interface
  (`apps/api/src/services/platforms/`). Supporting another platform means
  implementing it there — nothing above it should know which platform runs
  an app.
- **The agent** (`apps/api/agent/pc-agent.py`) runs as root on production
  servers: standard library only, push-only, no new commands it accepts.
  Bump `VERSION` when it changes.
- **Security issues**: please report privately — see [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the
project's licenses (AGPL-3.0 for the server and web app, MIT for the agent).
