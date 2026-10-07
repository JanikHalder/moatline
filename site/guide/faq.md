# FAQ

## Do I need Dokploy or Coolify?

No. Scans, fixes as pull requests and the server agent work without them.
A platform adds deploys, rollback, self-healing and the platform checks.

## Which languages are supported?

JavaScript and TypeScript (npm, pnpm, yarn) for code. Servers and images:
anything Trivy understands.

## Is my code copied?

Light scans read only the lockfile and `package.json` through the GitHub
API. Full scans and fixes clone into a temporary directory that is deleted
afterwards.

## Can it break production?

Only what you switch on happens by itself. Fixes are pull requests; merging,
deploying and rolling back are separate switches per repository, deploys
are watched, and broken ones are undone.

## How do updates work?

Settings → Updates shows new releases. Self-hosted with the Docker socket
mounted, one click pulls and restarts — like Dokploy. See
[images and templates](/reference/templates).

## What does the cloud cost?

A price per server and month; repositories and sites are included.
Self-hosting is free, with every feature.
