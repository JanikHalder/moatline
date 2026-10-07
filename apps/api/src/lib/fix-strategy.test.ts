import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  caretize,
  findLockfile,
  tightenPackageJsonOverrides,
  tightenWorkspaceOverrides,
  yarnResolutions,
} from "./fix-strategy";
import type { Vulnerability } from "./audit";

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixstrat-"));
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  return dir;
}

describe("findLockfile", () => {
  it("finds a workspace root's pnpm lockfile from a package folder", () => {
    const root = tmp({
      "pnpm-lock.yaml": "",
      "apps/web/package.json": "{}",
    });
    expect(findLockfile(path.join(root, "apps/web"), root)).toEqual({
      dir: root,
      manager: "pnpm",
    });
  });

  it("never looks above the clone", () => {
    const root = tmp({ "sub/package.json": "{}" });
    expect(
      findLockfile(path.join(root, "sub"), path.join(root, "sub"))
    ).toBeNull();
  });
});

describe("overrides", () => {
  it("pins >= ranges to the patched version's major", () => {
    expect(caretize(">=2.0.1")).toBe("^2.0.1");
    expect(caretize(">= 4.17.21")).toBe("^4.17.21");
    expect(caretize("^1.0.0")).toBe("^1.0.0");
    expect(caretize(">=1.0.0 <2")).toBe(">=1.0.0 <2");
  });

  it("rewrites pnpm overrides in package.json and pnpm-workspace.yaml", () => {
    const dir = tmp({
      "package.json": JSON.stringify(
        { name: "x", pnpm: { overrides: { "lodash@<4.17.21": ">=4.17.21" } } },
        null,
        2
      ),
      "pnpm-workspace.yaml":
        "packages:\n  - apps/*\noverrides:\n  'minimist@<1.2.6': '>=1.2.6'\n  semver: ^7.5.2\n",
    });
    expect(tightenPackageJsonOverrides(path.join(dir, "package.json"))).toBe(1);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).pnpm
        .overrides
    ).toEqual({ "lodash@<4.17.21": "^4.17.21" });
    expect(
      tightenWorkspaceOverrides(path.join(dir, "pnpm-workspace.yaml"))
    ).toBe(1);
    expect(
      fs.readFileSync(path.join(dir, "pnpm-workspace.yaml"), "utf8")
    ).toContain("'minimist@<1.2.6': '^1.2.6'");
  });
});

describe("yarnResolutions", () => {
  const v = (
    packageName: string,
    patchedVersion: string | null
  ): Vulnerability =>
    ({
      packageName,
      patchedVersion,
      fixAvailable: !!patchedVersion,
    }) as Vulnerability;

  it("pins each vulnerable package to its newest patched version", () => {
    expect(
      yarnResolutions([
        v("lodash", ">=4.17.19"),
        v("lodash", ">=4.17.21"),
        v("minimist", "1.2.6"),
        v("nofix", null),
      ])
    ).toEqual({ lodash: "^4.17.21", minimist: "^1.2.6" });
  });
});
