import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { alignDeclared, checkInstalled, describeCheck } from "./lockstep";

describe("alignDeclared", () => {
  it("moves Payload, Next.js and React siblings to the leader's version", () => {
    const pkg = {
      dependencies: {
        payload: "^3.58.0",
        "@payloadcms/next": "^3.57.1",
        "@payloadcms/db-postgres": "3.50.0",
        "@payloadcms/eslint-config": "3.9.0",
        next: "15.5.4",
        react: "19.1.1",
        "react-dom": "19.1.0",
        zod: "^3.0.0",
      },
      devDependencies: { "eslint-config-next": "~15.4.0" },
    };
    const changes = alignDeclared(pkg);
    expect(pkg.dependencies["@payloadcms/next"]).toBe("^3.58.0");
    expect(pkg.dependencies["@payloadcms/db-postgres"]).toBe("3.58.0");
    expect(pkg.dependencies["@payloadcms/eslint-config"]).toBe("3.9.0");
    expect(pkg.dependencies["react-dom"]).toBe("19.1.1");
    // Lint packages do not reach the build and are versioned on their own.
    expect(pkg.devDependencies["eslint-config-next"]).toBe("~15.4.0");
    expect(pkg.dependencies.zod).toBe("^3.0.0");
    expect(changes).toHaveLength(3);
  });

  it("leaves non-version specs alone", () => {
    const pkg = {
      dependencies: { payload: "^3.58.0", "@payloadcms/ui": "workspace:*" },
    };
    expect(alignDeclared(pkg)).toEqual([]);
  });
});

describe("checkInstalled", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, json: object) => {
    const p = path.join(dir, rel, "package.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(json));
  };

  it("finds a sibling left behind and a second copy pulled in", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockstep-"));
    write(".", {
      dependencies: {
        payload: "^3.58.0",
        "@payloadcms/next": "^3.58.0",
        "@payloadcms/db-postgres": "^3.57.0",
      },
    });
    write("node_modules/payload", { version: "3.58.0" });
    write("node_modules/@payloadcms/db-postgres", { version: "3.57.0" });
    write("node_modules/@payloadcms/next", {
      version: "3.58.0",
      dependencies: { "@payloadcms/ui": "3.58.0" },
      peerDependencies: { payload: "3.58.0" },
    });
    // @payloadcms/next got its own, older @payloadcms/ui.
    write("node_modules/@payloadcms/next/node_modules/@payloadcms/ui", {
      version: "3.57.0",
    });
    const r = checkInstalled(dir);
    expect(r.ok).toBe(false);
    expect(r.checked).toEqual(["Payload 3.58.0"]);
    expect(r.problems).toHaveLength(2);
    expect(r.problems.join("\n")).toContain("@payloadcms/db-postgres 3.57.0");
    expect(r.problems.join("\n")).toContain("@payloadcms/ui 3.57.0");
    expect(describeCheck(r).log).toContain("MISMATCH");
  });

  it("passes when everything is at one version", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockstep-"));
    write(".", { dependencies: { react: "19.1.1", "react-dom": "19.1.1" } });
    write("node_modules/react", { version: "19.1.1" });
    write("node_modules/react-dom", {
      version: "19.1.1",
      peerDependencies: { react: "^19.1.1" },
    });
    const r = checkInstalled(dir);
    expect(r).toMatchObject({ ok: true, checked: ["React 19.1.1"] });
  });
});
