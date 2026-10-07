import fs from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn";

/** Detect the package manager from the lockfile present in `projectDir`. */
export function detectPackageManager(projectDir: string): PackageManager {
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  // package-lock.json, or no lockfile at all (npm can generate one)
  return "npm";
}

export function hasLockfile(projectDir: string): boolean {
  return (
    fs.existsSync(path.join(projectDir, "package-lock.json")) ||
    fs.existsSync(path.join(projectDir, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(projectDir, "yarn.lock"))
  );
}
