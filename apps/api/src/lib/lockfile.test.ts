import { describe, expect, it } from "vitest";
import {
  lockfileCandidates,
  parsePackageLock,
  parsePnpmLock,
  parseYarnLock,
} from "./lockfile";

describe("lockfile parsers", () => {
  it("reads package-lock v3 including nested copies, not workspaces", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "apps/web": { version: "0.1.0" },
        "node_modules/web": { link: true, resolved: "apps/web" },
        "node_modules/lodash": { version: "4.17.15" },
        "node_modules/a/node_modules/lodash": { version: "4.17.21" },
        "node_modules/@scope/pkg": { version: "1.0.0" },
      },
    });
    expect(parsePackageLock(lock)).toEqual([
      { name: "lodash", version: "4.17.15" },
      { name: "lodash", version: "4.17.21" },
      { name: "@scope/pkg", version: "1.0.0" },
    ]);
  });

  it("reads pnpm v5, v6 and v9 keys", () => {
    const v9 = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "packages:",
      "  '@payloadcms/next@3.58.0':",
      "    resolution: {integrity: x}",
      "  next@15.5.4:",
      "  react-dom@19.1.1(react@19.1.1):",
      "snapshots:",
      "  next@15.5.4:",
    ].join("\n");
    expect(parsePnpmLock(v9)).toEqual([
      { name: "@payloadcms/next", version: "3.58.0" },
      { name: "next", version: "15.5.4" },
      { name: "react-dom", version: "19.1.1" },
    ]);
    const v6 =
      "packages:\n  /lodash@4.17.21:\n  /@babel/core@7.24.0(supports-color@8.1.1):\n";
    expect(parsePnpmLock(v6).map((p) => p.name)).toEqual([
      "lodash",
      "@babel/core",
    ]);
    const v5 = "packages:\n  /lodash/4.17.21:\n  /@types/node/20.1.0_abc:\n";
    expect(parsePnpmLock(v5)).toEqual([
      { name: "lodash", version: "4.17.21" },
      { name: "@types/node", version: "20.1.0" },
    ]);
  });

  it("reads yarn v1 and berry", () => {
    const v1 = [
      "# yarn lockfile v1",
      "",
      '"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.10.4":',
      '  version "7.12.13"',
      "  dependencies:",
      '    "@babel/highlight" "^7.10.4"',
      "",
      "lodash@^4.17.15:",
      '  version "4.17.21"',
    ].join("\n");
    expect(parseYarnLock(v1)).toEqual([
      { name: "@babel/code-frame", version: "7.12.13" },
      { name: "lodash", version: "4.17.21" },
    ]);
    const berry = [
      "__metadata:",
      "  version: 8",
      "",
      '"app@workspace:.":',
      "  version: 0.0.0-use.local",
      "",
      '"lodash@npm:^4.17.21":',
      "  version: 4.17.21",
    ].join("\n");
    expect(parseYarnLock(berry)).toEqual([
      { name: "lodash", version: "4.17.21" },
    ]);
  });

  it("looks next to package.json first, then up to the workspace root", () => {
    expect(lockfileCandidates("apps/web/package.json")).toEqual([
      "apps/web/pnpm-lock.yaml",
      "apps/web/package-lock.json",
      "apps/web/yarn.lock",
      "apps/pnpm-lock.yaml",
      "apps/package-lock.json",
      "apps/yarn.lock",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
    ]);
  });
});
