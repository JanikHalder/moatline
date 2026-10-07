# Contributing

Thanks for helping. A few things keep this project easy to work on:

- **Run the checks before a PR**: `pnpm lint`, `pnpm format:check`,
  `pnpm build`, `pnpm --filter api test`, `pnpm --filter web test`. CI also
  runs the migrations against PostgreSQL and the Playwright end-to-end tests.
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
