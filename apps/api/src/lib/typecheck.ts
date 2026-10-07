import fs from "node:fs";
import path from "node:path";
import { run } from "./run";

const TYPECHECK_TIMEOUT_MS = 300_000;

// What `next dev`/`next build` would generate; without it every CSS or
// image import fails the typecheck. Written only for the check, removed after.
const NEXT_ENV = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`;

export type TypecheckResult = {
  /** null: nothing to check (no TypeScript in the project). */
  ok: boolean | null;
  output: string;
  note: string;
};

/**
 * `tsc --noEmit` on the project: catches what a dependency update breaks in
 * the code (renamed exports, changed signatures) without running the app —
 * so unlike `next build` it needs no database, no secrets and little memory.
 */
export async function runTypecheck(
  projectDir: string,
  workDir: string,
  env: NodeJS.ProcessEnv = {}
): Promise<TypecheckResult> {
  if (!fs.existsSync(path.join(projectDir, "tsconfig.json"))) {
    return {
      ok: null,
      output: "",
      note: "no tsconfig.json — nothing to typecheck",
    };
  }
  const tsc = [projectDir, workDir]
    .map((d) => path.join(d, "node_modules", ".bin", "tsc"))
    .find((p) => fs.existsSync(p));
  if (!tsc) {
    return {
      ok: null,
      output: "",
      note: "typescript is not installed in the project — not checked",
    };
  }
  let nextEnv: string | null = null;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const usesNext = !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
    const file = path.join(projectDir, "next-env.d.ts");
    if (usesNext && !fs.existsSync(file)) {
      fs.writeFileSync(file, NEXT_ENV);
      nextEnv = file;
    }
  } catch {
    // no readable package.json: check without the Next.js types
  }
  try {
    const r = await run(tsc, ["--noEmit", "-p", "tsconfig.json"], {
      cwd: projectDir,
      timeout: TYPECHECK_TIMEOUT_MS,
      scrubSecrets: true,
      env,
    });
    return {
      ok: r.ok,
      output: [r.stdout, r.stderr].filter(Boolean).join("\n"),
      note: r.ok
        ? "typecheck passed"
        : r.timedOut
          ? "typecheck timed out"
          : "typecheck failed",
    };
  } finally {
    // Must not end up in the commit.
    if (nextEnv) fs.rmSync(nextEnv, { force: true });
  }
}
