import { describe, expect, it } from "vitest";
import {
  frameworkOf,
  isMigrationFile,
  riskyStatements,
  setupIssues,
} from "./migrations";

const payloadMigration = `import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql\`
   ALTER TABLE "posts" DROP COLUMN IF EXISTS "subtitle";
   DROP TABLE "authors" CASCADE;
   ALTER TABLE "pages" ALTER COLUMN "title" SET NOT NULL;
   DELETE FROM "logs" WHERE "created_at" < now() - interval '1 year';\`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql\`DROP TABLE "comments";\`)
}
`;

describe("migrations", () => {
  it("knows the migration tool from package.json", () => {
    expect(
      frameworkOf({ dependencies: { "@payloadcms/db-postgres": "3" } })
    ).toBe("payload");
    expect(frameworkOf({ devDependencies: { prisma: "6" } })).toBe("prisma");
    expect(frameworkOf({ dependencies: { "drizzle-orm": "1" } })).toBe(
      "drizzle"
    );
    expect(frameworkOf({ dependencies: { next: "15" } })).toBeNull();
  });

  it("recognizes migration files, not their index or snapshots", () => {
    expect(isMigrationFile("src/migrations/20260101_add_x.ts")).toBe(true);
    expect(isMigrationFile("prisma/migrations/2026_x/migration.sql")).toBe(
      true
    );
    expect(isMigrationFile("drizzle/0007_brave.sql")).toBe(true);
    expect(isMigrationFile("src/migrations/index.ts")).toBe(false);
    expect(isMigrationFile("drizzle/meta/0007_snapshot.json")).toBe(false);
    expect(isMigrationFile("src/collections/Posts.ts")).toBe(false);
  });

  it("flags what `up` destroys and ignores `down`", () => {
    const found = riskyStatements(payloadMigration, "src/migrations/x.ts");
    expect(found.map((f) => [f.kind, f.title])).toEqual([
      ["drop-table", "Drops table authors"],
      ["drop-column", "Drops column subtitle"],
      ["not-null", "Makes title required"],
    ]);
    expect(found[0]!.line).toBe(6);
    // The DELETE has a WHERE; `down`'s DROP TABLE comments is not run.
    expect(found.some((f) => f.title.includes("comments"))).toBe(false);
  });

  it("flags a DELETE without WHERE and TRUNCATE in SQL files", () => {
    const found = riskyStatements(
      'TRUNCATE "sessions";\nDELETE FROM "users";\n',
      "prisma/migrations/x/migration.sql"
    );
    expect(found.map((f) => f.kind)).toEqual(["truncate", "delete"]);
  });

  it("finds setups that push into production or never migrate", () => {
    const payload = setupIssues({
      framework: "payload",
      scripts: { start: "next start" },
      payloadConfig: "db: postgresAdapter({ pool: {}, push: true })",
      dockerfile: 'CMD ["node", "server.js"]',
      hasMigrations: true,
    });
    expect(payload.map((i) => i.kind)).toEqual([
      "push-in-production",
      "never-run",
    ]);
    expect(
      setupIssues({
        framework: "payload",
        scripts: { start: "payload migrate && next start" },
        payloadConfig:
          "postgresAdapter({ push: process.env.NODE_ENV !== 'production' })",
        dockerfile: null,
        hasMigrations: true,
      })
    ).toEqual([]);
    expect(
      setupIssues({
        framework: "prisma",
        scripts: { build: "prisma db push && next build" },
        payloadConfig: null,
        dockerfile: null,
        hasMigrations: false,
      })[0]?.kind
    ).toBe("push-in-production");
  });
});
