import { describe, expect, it } from "vitest";
import {
  buildStack,
  effectiveVersion,
  nodeSupport,
  nodeVersion,
} from "./stack";
import { pinFamily } from "./lockstep";
import { lagOf, recommendedNode } from "../services/versions";

describe("nodeVersion", () => {
  it("prefers the Dockerfile's base image", () => {
    expect(
      nodeVersion({
        dockerfile:
          "FROM --platform=linux/amd64 node:22.11-alpine AS base\nFROM base",
        nvmrc: "20",
        engines: ">=18",
      })
    ).toEqual({ version: "22.11", source: "Dockerfile" });
  });
  it("falls back to .nvmrc, then engines", () => {
    expect(nodeVersion({ nvmrc: "v20.11.0\n" })).toEqual({
      version: "20.11.0",
      source: ".nvmrc",
    });
    expect(nodeVersion({ engines: "^18.20.2 || >=20.9.0" })).toEqual({
      version: "18",
      source: "engines",
    });
    expect(nodeVersion({ nvmrc: "lts/iron" })).toBeNull();
  });
});

describe("buildStack", () => {
  it("takes installed versions from the lockfile, the highest copy", () => {
    const s = buildStack(
      { dependencies: { payload: "^3.40.0", next: "15.3.0" } },
      [
        { name: "payload", version: "3.44.0" },
        { name: "payload", version: "3.41.0" },
        { name: "next", version: "15.3.0" },
      ],
      { dockerfile: "FROM node:22-alpine" },
      new Date("2026-10-04T00:00:00Z")
    );
    expect(s.packages).toEqual({
      payload: { declared: "^3.40.0", installed: "3.44.0" },
      next: { declared: "15.3.0", installed: "15.3.0" },
    });
    expect(effectiveVersion({ declared: "^3.40.0", installed: null })).toBe(
      "3.40.0"
    );
  });
});

describe("node support", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  it("knows end of life", () => {
    expect(nodeSupport("20.11", now)).toBe("eol");
    expect(nodeSupport("22", now)).toBe("ok");
    expect(nodeSupport("14", now)).toBe("eol");
  });
  it("recommends the newest LTS with a year of support left", () => {
    expect(recommendedNode(now)).toBe(24);
  });
});

describe("lagOf", () => {
  it("says how far behind", () => {
    expect(lagOf("3.58.0", "3.58.0")).toBe("current");
    expect(lagOf("3.58.0", "3.58.2")).toBe("patch");
    expect(lagOf("3.40.0", "3.58.0")).toBe("minor");
    expect(lagOf("2.30.0", "3.58.0")).toBe("major");
    expect(lagOf(null, "3.58.0")).toBe("unknown");
  });
});

describe("pinFamily", () => {
  it("moves the whole family to one release, keeping range styles", () => {
    const pkg = {
      dependencies: {
        payload: "^3.40.0",
        "@payloadcms/next": "3.40.0",
        "@payloadcms/eslint-config": "3.9.0",
        next: "15.3.0",
      },
      devDependencies: { "@payloadcms/db-postgres": "~3.40.0" },
    };
    expect(pinFamily(pkg, "Payload", "3.58.0")).toEqual([
      "payload: ^3.40.0 → ^3.58.0",
      "@payloadcms/next: 3.40.0 → 3.58.0",
      "@payloadcms/db-postgres: ~3.40.0 → ~3.58.0",
    ]);
    expect(pkg.dependencies.next).toBe("15.3.0");
    expect(pkg.dependencies["@payloadcms/eslint-config"]).toBe("3.9.0");
  });
  it("does nothing where the family is not used", () => {
    expect(
      pinFamily({ dependencies: { next: "15.0.0" } }, "Payload", "3.58.0")
    ).toEqual([]);
  });
});
