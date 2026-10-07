import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Vulnerability } from "./audit";
import { applyPins, applyPnpmOverrides, pnpmOverrides } from "./lockfile-fix";

const vuln = (p: Partial<Vulnerability>): Vulnerability => ({
  packageName: "x",
  severity: "high",
  ghsaId: null,
  cveId: null,
  title: null,
  url: null,
  vulnerableRange: null,
  patchedVersion: null,
  fixAvailable: true,
  fixIsSemverMajor: false,
  isDirect: false,
  cvssScore: null,
  ...p,
});

describe("pnpmOverrides", () => {
  it("overrides a transitive package within its major, skips majors", () => {
    const r = pnpmOverrides(
      [
        vuln({
          packageName: "lodash",
          vulnerableRange: "<4.17.21",
          patchedVersion: "4.17.21",
        }),
        vuln({
          packageName: "old",
          vulnerableRange: "<2.0.0",
          patchedVersion: "2.0.0",
        }),
        vuln({ packageName: "nofix", vulnerableRange: "*" }),
      ],
      [
        { name: "lodash", version: "4.17.15" },
        { name: "old", version: "1.4.0" },
      ],
      false
    );
    expect(r.overrides).toEqual({ "lodash@<4.17.21": "^4.17.21" });
    expect(r.skipped).toHaveLength(2);
  });

  it("moves all Payload packages together, to the smallest fixed version", () => {
    const r = pnpmOverrides(
      [
        vuln({
          packageName: "payload",
          vulnerableRange: "<3.79.1",
          patchedVersion: "3.79.1",
        }),
      ],
      [
        { name: "payload", version: "3.64.0" },
        { name: "@payloadcms/ui", version: "3.64.0" },
        { name: "@payloadcms/next", version: "3.64.0" },
        { name: "@payloadcms/eslint-config", version: "3.9.0" },
      ],
      false,
      ["payload", "@payloadcms/next"]
    );
    expect(r.overrides).toEqual({
      payload: "3.79.1",
      "@payloadcms/ui": "3.79.1",
      "@payloadcms/next": "3.79.1",
    });
  });
});

describe("applying pins", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const setup = (files: Record<string, string>) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pins-"));
    for (const [f, body] of Object.entries(files))
      fs.writeFileSync(path.join(dir, f), body);
  };
  const pkg = () =>
    JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));

  it("pnpm: package.json pnpm.overrides, keeping existing ones", () => {
    setup({
      "package.json": JSON.stringify({ pnpm: { overrides: { a: "1" } } }),
    });
    applyPnpmOverrides(dir, { b: "2" });
    expect(pkg().pnpm.overrides).toEqual({ a: "1", b: "2" });
  });

  it("pnpm 10: into pnpm-workspace.yaml when overrides live there", () => {
    setup({
      "package.json": "{}",
      "pnpm-workspace.yaml": "packages:\n  - apps/*\noverrides:\n  a: '1'\n",
    });
    applyPnpmOverrides(dir, { payload: "3.79.1" });
    expect(
      fs.readFileSync(path.join(dir, "pnpm-workspace.yaml"), "utf8")
    ).toContain("overrides:\n  'payload': '3.79.1'\n  a: '1'");
  });

  it("npm overrides and yarn resolutions", () => {
    setup({ "package.json": "{}" });
    applyPins(dir, "npm", { react: "19.1.1" });
    expect(pkg().overrides).toEqual({ react: "19.1.1" });
    applyPins(dir, "yarn", { react: "19.1.1" });
    expect(pkg().resolutions).toEqual({ react: "19.1.1" });
  });
});
