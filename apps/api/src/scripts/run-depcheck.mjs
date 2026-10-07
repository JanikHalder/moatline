/**
 * Standalone script: runs depcheck on a project dir and prints JSON result.
 * Used from scan service so depcheck crashes don't kill the API process.
 * Usage: node run-depcheck.mjs <projectDir>
 */
const projectDir = process.argv[2];
if (!projectDir) {
  process.exit(1);
}

async function main() {
  const depcheck = (await import("depcheck")).default;
  // depcheck's "specials" read tool configs, and some of those are code
  // (eslint.config.js, babel.config.js …) that it loads. On the cloud the
  // repository is a stranger's: parse source files only.
  const result = await depcheck(projectDir, {
    skipMissing: true,
    ...(process.env.CLOUD_MODE === "true" ? { specials: [] } : {}),
  });
  const out = {
    dependencies: result.dependencies ?? [],
    devDependencies: result.devDependencies ?? [],
  };
  console.log(JSON.stringify(out));
}

main().catch(() => process.exit(1));
