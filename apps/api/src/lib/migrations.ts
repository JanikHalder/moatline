/**
 * Database migrations that can lose data, and setups where migrations
 * never run or the schema is pushed straight into production. Pure
 * functions over file contents — the guard reads the files from the Git host.
 *
 * Payload (Drizzle underneath), Prisma and Drizzle Kit: their migrations are
 * SQL, or TypeScript with the SQL inside `up` (and the reverse in `down`).
 */

export type MigrationFramework = "payload" | "prisma" | "drizzle";

export type MigrationIssue = {
  kind:
    | "drop-table"
    | "drop-column"
    | "truncate"
    | "delete"
    | "type-change"
    | "not-null"
    | "push-in-production"
    | "never-run";
  severity: "high" | "medium";
  title: string;
  detail: string;
  file?: string;
  line?: number;
};

/** Which migration tool a package.json uses. */
export function frameworkOf(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): MigrationFramework | null {
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  if (
    Object.keys(deps).some((d) =>
      /^@payloadcms\/db-(postgres|vercel-postgres|sqlite|d1-sqlite)$/.test(d)
    )
  )
    return "payload";
  if (deps.prisma || deps["@prisma/client"]) return "prisma";
  if (deps["drizzle-kit"] || deps["drizzle-orm"]) return "drizzle";
  return null;
}

/** Files that are migrations (not their index or snapshots). */
export function isMigrationFile(path: string): boolean {
  const p = path.toLowerCase();
  if (/(^|\/)node_modules\//.test(p)) return false;
  if (/(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/.test(p)) return true;
  if (/(^|\/)migrations?\/(index|meta\/.*)\.(ts|js|json)$/.test(p))
    return false;
  if (/\.json$/.test(p)) return false;
  return /(^|\/)(migrations|drizzle)\/[^/]+\.(sql|ts|js|mjs)$/.test(p);
}

/**
 * The part of a migration that runs on deploy: `up` of a TypeScript
 * migration (its `down` drops what `up` created), the whole file for SQL.
 */
export function upPart(
  text: string,
  path: string
): { text: string; offset: number } {
  if (!/\.(ts|js|mjs)$/.test(path)) return { text, offset: 0 };
  const up = text.search(
    /\b(export\s+)?(async\s+)?function\s+up\b|\bup\s*[:=]\s*async\b/
  );
  if (up === -1) return { text, offset: 0 };
  const rest = text.slice(up);
  const down = rest.search(
    /\b(export\s+)?(async\s+)?function\s+down\b|\bdown\s*[:=]\s*async\b/
  );
  return { text: down === -1 ? rest : rest.slice(0, down), offset: up };
}

const lineAt = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

const RULES: Array<{
  re: RegExp;
  kind: MigrationIssue["kind"];
  severity: MigrationIssue["severity"];
  title: (m: RegExpExecArray) => string;
  detail: string;
}> = [
  {
    re: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/gi,
    kind: "drop-table",
    severity: "high",
    title: (m) => `Drops table ${m[1]!.replace(/"/g, "")}`,
    detail:
      "Every row in it is gone after the deploy. A renamed collection or model looks exactly like this to the migration tool — rename the table in the migration instead of dropping it.",
  },
  {
    re: /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?("?\w+"?)/gi,
    kind: "drop-column",
    severity: "high",
    title: (m) => `Drops column ${m[1]!.replace(/"/g, "")}`,
    detail:
      "Its values are gone after the deploy. A renamed field looks like this — rename the column instead, or copy the data over first.",
  },
  {
    re: /\bTRUNCATE\s+(?:TABLE\s+)?("?[\w.]+"?)/gi,
    kind: "truncate",
    severity: "high",
    title: (m) => `Empties table ${m[1]!.replace(/"/g, "")}`,
    detail: "TRUNCATE deletes every row.",
  },
  {
    re: /\bDELETE\s+FROM\s+("?[\w.]+"?)(?![^;]*\bWHERE\b)/gi,
    kind: "delete",
    severity: "high",
    title: (m) => `Deletes every row of ${m[1]!.replace(/"/g, "")}`,
    detail: "A DELETE without WHERE empties the table.",
  },
  {
    re: /\bALTER\s+COLUMN\s+("?\w+"?)\s+(?:SET\s+DATA\s+)?TYPE\b/gi,
    kind: "type-change",
    severity: "medium",
    title: (m) => `Changes the type of ${m[1]!.replace(/"/g, "")}`,
    detail:
      "Fails on values the new type cannot hold, or cuts them — check the data before deploying.",
  },
  {
    re: /\bALTER\s+COLUMN\s+("?\w+"?)\s+SET\s+NOT\s+NULL\b/gi,
    kind: "not-null",
    severity: "medium",
    title: (m) => `Makes ${m[1]!.replace(/"/g, "")} required`,
    detail:
      "The migration fails if a row has no value yet, and the deploy with it — fill the column first or give it a default.",
  },
];

/** What a migration does that can lose data or fail on existing rows. */
export function riskyStatements(text: string, file: string): MigrationIssue[] {
  const { text: up, offset } = upPart(text, file);
  const out: MigrationIssue[] = [];
  const seen = new Set<string>();
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(up))) {
      const title = r.title(m);
      if (seen.has(title)) continue;
      seen.add(title);
      out.push({
        kind: r.kind,
        severity: r.severity,
        title,
        detail: r.detail,
        file,
        line: lineAt(text, offset + m.index),
      });
    }
  }
  return out;
}

/**
 * Setups that lose data or never migrate: the schema pushed straight into
 * the production database, or migrations that nothing runs.
 */
export function setupIssues(opts: {
  framework: MigrationFramework;
  scripts: Record<string, string>;
  /** The Payload config's text, when found. */
  payloadConfig: string | null;
  dockerfile: string | null;
  /** The repository has migration files. */
  hasMigrations: boolean;
}): MigrationIssue[] {
  const out: MigrationIssue[] = [];
  const runs = [
    ...Object.entries(opts.scripts)
      .filter(([k]) =>
        /^(start|build|prestart|postbuild|deploy|release|migrate.*)$/.test(k)
      )
      .map(([, v]) => v),
    opts.dockerfile ?? "",
  ].join("\n");

  if (opts.framework === "payload") {
    if (opts.payloadConfig && /\bpush\s*:\s*true\b/.test(opts.payloadConfig))
      out.push({
        kind: "push-in-production",
        severity: "high",
        title: "Payload pushes the schema straight into the database",
        detail:
          "`push: true` in the database adapter changes tables without a migration — in production a renamed field drops its column. Remove it (Payload pushes in development by default) and use migrations.",
        file: "payload.config",
      });
    const migrates =
      /\bpayload\s+migrate\b/.test(runs) ||
      (opts.payloadConfig
        ? /\bprodMigrations\b/.test(opts.payloadConfig)
        : false);
    if (opts.hasMigrations && !migrates)
      out.push({
        kind: "never-run",
        severity: "medium",
        title: "Migrations exist but nothing runs them in production",
        detail:
          "Neither `payload migrate` in the start command or Dockerfile nor `prodMigrations` in the adapter — a deploy with schema changes then meets an old database. Add `prodMigrations: migrations` to the adapter, or run `payload migrate` before `next start`.",
      });
  }
  if (opts.framework === "prisma" && /\bprisma\s+db\s+push\b/.test(runs))
    out.push({
      kind: "push-in-production",
      severity: "high",
      title: "`prisma db push` runs on deploy",
      detail:
        "It changes the production schema without migrations and can drop data (it asks first — unless `--accept-data-loss` is set). Use `prisma migrate deploy`.",
    });
  if (opts.framework === "drizzle" && /\bdrizzle-kit\s+push\b/.test(runs))
    out.push({
      kind: "push-in-production",
      severity: "high",
      title: "`drizzle-kit push` runs on deploy",
      detail:
        "It changes the production schema without migrations; a renamed column can become drop-and-add. Generate migrations and run `drizzle-kit migrate`.",
    });
  return out;
}
