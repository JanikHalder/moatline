/**
 * Creates the database from DATABASE_URL if it does not exist.
 * Connects to the default DB (postgres) with the same credentials, then CREATE DATABASE.
 * Set DATABASE_ADMIN_URL for a superuser connection if the DATABASE_URL user cannot create DBs.
 */
import postgres from "postgres";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function loadEnvFromApi() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const envPath = join(dir, "../../../apps/api/.env");
  if (!existsSync(envPath)) return;
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

loadEnvFromApi();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set DATABASE_URL");
  process.exit(1);
}

const parsed = new URL(databaseUrl);
const dbName = parsed.pathname.slice(1).replace(/\/$/, "") || "package_checker";
let adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  parsed.pathname = "/postgres";
  adminUrl = parsed.toString();
}

function sanitizeIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
    throw new Error("Invalid database name");
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  const sql = postgres(adminUrl, { max: 1 });
  const safeDbName = sanitizeIdent(dbName);
  const isAdmin = !!process.env.DATABASE_ADMIN_URL;

  if (isAdmin && parsed.username) {
    const user = decodeURIComponent(parsed.username);
    const password = parsed.password ? decodeURIComponent(parsed.password) : "";
    const safePass = "'" + String(password).replace(/'/g, "''") + "'";
    try {
      await sql.unsafe(
        `CREATE ROLE ${sanitizeIdent(user)} WITH LOGIN PASSWORD ${safePass}`
      );
      console.log(`Role "${user}" created.`);
    } catch (e) {
      if (e?.code !== "42710") console.error("Create role:", e?.message ?? e);
    }
  }

  try {
    const ownerClause =
      isAdmin && parsed.username
        ? ` OWNER ${sanitizeIdent(decodeURIComponent(parsed.username))}`
        : "";
    await sql.unsafe(`CREATE DATABASE ${safeDbName}${ownerClause}`);
    console.log(`Database "${dbName}" created.`);
  } catch (e) {
    const code = e?.code ?? "";
    if (code === "42P04") {
      console.log(`Database "${dbName}" already exists.`);
    } else {
      console.error("Create database failed:", e?.message ?? e);
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main();
