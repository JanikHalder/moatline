# Vulnerabilities and fixes

## Scans

- **Light scans** read the lockfile through the GitHub API (pnpm, npm,
  yarn) and check every resolved version against the npm advisory database
  and OSV's malicious-package list — no clone, about a second each.
- **Full scans** also find unused dependencies.
- Scans run on a schedule, after every change of the branch, and against
  the **deployed commit** when the live URL reports one — so what is
  exposed in production is what counts.

## Fixes

A security fix is a branch with the smallest lockfile change that removes
the vulnerable version: overrides for pnpm, `npm audit fix --package-lock-only`,
resolutions for yarn. Packages released together — Payload, Next.js, React,
Lexical — are always moved together; mixing their versions is what breaks
deploys.

Before the pull request: install, then the repository's typecheck or build.
Optional, per repository: merge when the check passes, deploy after merge,
roll back when the deploy breaks the site.

## Updates

Minor and patch updates, or everything to latest, as one PR. On the
Versions page, every Payload or Next.js site can be moved to one exact
release in one go — a PR each, nothing merged by itself.
