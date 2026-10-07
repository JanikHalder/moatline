export type BuildDatabase = "postgres" | "mongo" | "none";
export type BuildManager = "pnpm" | "npm" | "yarn";

/**
 * A GitHub Actions workflow that builds every pull request on the
 * self-hosted build runner, against an empty throwaway database — never the
 * real one. Payload migrations run first, so tables exist for the build.
 */
export function buildWorkflow(opts: {
  database: BuildDatabase;
  manager: BuildManager;
  node: string;
}): string {
  const { database, manager, node } = opts;
  const install =
    manager === "pnpm"
      ? "pnpm install --frozen-lockfile"
      : manager === "yarn"
        ? "yarn install --frozen-lockfile"
        : "npm ci";
  const exec = manager === "npm" ? "npx" : manager;
  const run = manager === "npm" ? "npm run" : manager;
  const service =
    database === "postgres"
      ? `    services:
      db:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: build
          POSTGRES_PASSWORD: build
          POSTGRES_DB: app
        ports: ["5432"]
        options: >-
          --health-cmd "pg_isready -U build" --health-interval 5s
          --health-timeout 5s --health-retries 10
`
      : database === "mongo"
        ? `    services:
      db:
        image: mongo:7
        ports: ["27017"]
        options: >-
          --health-cmd "mongosh --quiet --eval 'db.runCommand({ping:1})'"
          --health-interval 5s --health-timeout 5s --health-retries 10
`
        : "";
  const uri =
    database === "postgres"
      ? "postgres://build:build@localhost:${{ job.services.db.ports['5432'] }}/app"
      : database === "mongo"
        ? "mongodb://localhost:${{ job.services.db.ports['27017'] }}/app"
        : null;
  // Step level: job.services is not available in a job-level env.
  const env = [
    "        env:",
    uri && `          DATABASE_URI: ${uri}`,
    uri && `          DATABASE_URL: ${uri}`,
    "          PAYLOAD_SECRET: build-check-only-not-a-secret",
    "          NEXT_TELEMETRY_DISABLED: 1",
    "          NODE_OPTIONS: --max-old-space-size=4096",
  ]
    .filter(Boolean)
    .join("\n");
  const setupManager =
    manager === "pnpm" ? "      - uses: pnpm/action-setup@v4\n" : "";
  const migrate =
    database === "postgres"
      ? `      # Payload: create the tables in the empty database first.
      - name: Migrate
        if: hashFiles('src/migrations/*.ts') != ''
        run: ${exec} payload migrate
${env}
`
      : "";

  return `# Builds every pull request on your own build server (self-hosted runner),
# against an empty throwaway database — never the production one.
# Moatline opens the PR and waits for this check before auto-merge.
name: Build check

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: build-check-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: [self-hosted, linux, build]
    timeout-minutes: 30
${service}    steps:
      - uses: actions/checkout@v4
${setupManager}      - uses: actions/setup-node@v4
        with:
          node-version: ${node}
          cache: ${manager}
      - run: ${install}
${migrate}      - run: ${run} build
${env}
`;
}
