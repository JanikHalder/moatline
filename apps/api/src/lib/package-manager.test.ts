import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectPackageManager, hasLockfile } from "./package-manager";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function touch(name: string) {
  fs.writeFileSync(path.join(dir, name), "");
}

describe("detectPackageManager", () => {
  it("detects pnpm from pnpm-lock.yaml", () => {
    touch("pnpm-lock.yaml");
    expect(detectPackageManager(dir)).toBe("pnpm");
  });
  it("detects yarn from yarn.lock", () => {
    touch("yarn.lock");
    expect(detectPackageManager(dir)).toBe("yarn");
  });
  it("defaults to npm (package-lock.json or none)", () => {
    expect(detectPackageManager(dir)).toBe("npm");
    touch("package-lock.json");
    expect(detectPackageManager(dir)).toBe("npm");
  });
  it("prefers pnpm over yarn when both present", () => {
    touch("pnpm-lock.yaml");
    touch("yarn.lock");
    expect(detectPackageManager(dir)).toBe("pnpm");
  });
});

describe("hasLockfile", () => {
  it("is false with no lockfile, true with any", () => {
    expect(hasLockfile(dir)).toBe(false);
    touch("package-lock.json");
    expect(hasLockfile(dir)).toBe(true);
  });
});
