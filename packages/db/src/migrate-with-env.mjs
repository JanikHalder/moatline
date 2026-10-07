import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(dir, "../../../apps/api/.env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

/** Host from DATABASE_URL, for error messages. Never prints the password. */
function databaseHost() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return "(DATABASE_URL is unset or not a valid URL)";
  }
}

// On a fresh deploy the app container regularly starts before the database
// accepts connections — or before its service name resolves. A single attempt
// turns that race into a failed deployment, so retry for about a minute.
const ATTEMPTS = Number(process.env.DB_MIGRATE_ATTEMPTS) || 6;
const DELAY_MS = Number(process.env.DB_MIGRATE_RETRY_MS) || 10_000;

const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let lastError;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    execSync("pnpm exec drizzle-kit migrate", {
      stdio: "inherit",
      cwd: join(dir, ".."),
    });
    process.exit(0);
  } catch (e) {
    lastError = e;
    if (attempt < ATTEMPTS) {
      console.error(
        `[db] Migration attempt ${attempt}/${ATTEMPTS} failed against ${databaseHost()} – retrying in ${DELAY_MS / 1000}s…`
      );
      sleep(DELAY_MS);
    }
  }
}

console.error(
  [
    "",
    `[db] Migrations failed after ${ATTEMPTS} attempts against ${databaseHost()}.`,
    "",
    "The database host in DATABASE_URL could not be reached. Check, in order:",
    "  1. Is the database service running?",
    "  2. Does the host match the database's internal hostname exactly?",
    "     (On Dokploy: the database's own page shows it — copy it from there.)",
    "  3. Are the app and the database on the same Docker network?",
    "  4. From outside that network, use the external host/port instead.",
    "",
  ].join("\n")
);
// drizzle-kit already printed the underlying error on each attempt; a Node
// stack trace on top of it only buries the checklist above.
void lastError;
process.exit(1);
