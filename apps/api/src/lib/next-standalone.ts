/**
 * Whether a Next.js app is set up for a small self-hosted image
 * (`output: 'standalone'`). Used during scans so Moatline can flag multi-GB
 * Railpack/Nixpacks images before they fill the host.
 */

export type NextStandaloneVerdict = {
  /** Repository depends on `next`. */
  usesNext: boolean;
  /** `output: 'standalone'` in next.config (null = no config file found). */
  configStandalone: boolean | null;
  /** `package.json` start runs the standalone server. */
  startUsesStandalone: boolean;
  /** Dockerfile copies `.next/standalone` (multi-stage runner). */
  dockerfileStandalone: boolean;
  /** True when Next is used and neither config nor Dockerfile opts into standalone. */
  missing: boolean;
  /** Config has standalone but start/Dockerfile do not use it (Railpack risk). */
  startMismatch: boolean;
};

const CONFIG_NAMES = [
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
  "next.config.cjs",
] as const;

export function nextConfigFileNames(
  packageJsonPath = "package.json"
): string[] {
  const dir = packageJsonPath.replace(/\/?package\.json$/, "");
  const prefix = dir && dir !== "." ? `${dir}/` : "";
  const rooted = CONFIG_NAMES.map((n) => `${prefix}${n}`);
  // Also try repo root when the app lives in a subdirectory.
  return dir && dir !== "." ? [...rooted, ...CONFIG_NAMES] : [...rooted];
}

export function hasNextDependency(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): boolean {
  return !!(pkg.dependencies?.next || pkg.devDependencies?.next);
}

/** Whether next.config sets `output: 'standalone'`. */
export function configSetsStandalone(text: string): boolean {
  return /output\s*:\s*['"`]standalone['"`]/.test(text);
}

export function startScriptUsesStandalone(pkg: {
  scripts?: Record<string, string>;
}): boolean {
  const start = pkg.scripts?.start ?? "";
  return (
    /\.next\/standalone/.test(start) || /standalone\/server\.js/.test(start)
  );
}

export function dockerfileUsesStandalone(text: string): boolean {
  return /\.next\/standalone/.test(text);
}

export function verdictNextStandalone(opts: {
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  /** First next.config.* content found, or null. */
  nextConfig: string | null;
  dockerfile: string | null;
}): NextStandaloneVerdict {
  const usesNext = hasNextDependency(opts.pkg);
  if (!usesNext) {
    return {
      usesNext: false,
      configStandalone: null,
      startUsesStandalone: false,
      dockerfileStandalone: false,
      missing: false,
      startMismatch: false,
    };
  }
  const configStandalone =
    opts.nextConfig == null ? null : configSetsStandalone(opts.nextConfig);
  const startUsesStandalone = startScriptUsesStandalone(opts.pkg);
  const dockerfileStandalone = opts.dockerfile
    ? dockerfileUsesStandalone(opts.dockerfile)
    : false;
  const hasStandalone = configStandalone === true || dockerfileStandalone;
  const missing = !hasStandalone;
  const startMismatch =
    configStandalone === true && !dockerfileStandalone && !startUsesStandalone;
  return {
    usesNext: true,
    configStandalone,
    startUsesStandalone,
    dockerfileStandalone,
    missing,
    startMismatch,
  };
}
