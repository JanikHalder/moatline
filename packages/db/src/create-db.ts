/**
 * Creates the database from DATABASE_URL if it does not exist.
 * Connects to the default DB (postgres) with the same credentials, then CREATE DATABASE.
 * For first-time setup with a different admin user, set DATABASE_ADMIN_URL.
 */
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

async function main() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(adminUrl, { max: 1 });
  const safeName = sanitizeIdent(dbName);
  try {
    await sql.unsafe(`CREATE DATABASE ${safeName}`);
    console.log(`Database "${dbName}" created.`);
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && "code" in e
        ? (e as { code: string }).code
        : "";
    if (msg === "42P04") {
      console.log(`Database "${dbName}" already exists.`);
    } else {
      console.error("Create database failed:", e);
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

function sanitizeIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
    throw new Error("Invalid database name");
  return `"${name.replace(/"/g, '""')}"`;
}

main();
