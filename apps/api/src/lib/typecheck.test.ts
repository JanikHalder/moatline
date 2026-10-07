import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, afterEach } from "vitest";
import { runTypecheck } from "./typecheck";

const typescriptDir = path.dirname(
  createRequire(import.meta.url).resolve("typescript/package.json")
);
const dirs: string[] = [];

function project(code: string, pkg: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
  fs.symlinkSync(typescriptDir, path.join(dir, "node_modules", "typescript"));
  fs.symlinkSync(
    "../typescript/bin/tsc",
    path.join(dir, "node_modules", ".bin", "tsc")
  );
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [] },
      include: ["*.ts"],
    })
  );
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  fs.writeFileSync(path.join(dir, "index.ts"), code);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe("runTypecheck", () => {
  it("passes clean code", async () => {
    const r = await runTypecheck(project("export const n: number = 1;\n"), "");
    expect(r).toMatchObject({ ok: true, note: "typecheck passed" });
  }, 60_000);

  it("fails on a type error and shows it", async () => {
    const r = await runTypecheck(
      project('export const n: number = "one";\n'),
      ""
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("TS2322");
  }, 60_000);

  it("does not leave next-env.d.ts behind", async () => {
    const dir = project("export {};\n", { dependencies: { next: "15.0.0" } });
    await runTypecheck(dir, "");
    expect(fs.existsSync(path.join(dir, "next-env.d.ts"))).toBe(false);
  }, 60_000);

  it("says so when there is no TypeScript", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-"));
    dirs.push(dir);
    expect((await runTypecheck(dir, dir)).ok).toBeNull();
  });
});
