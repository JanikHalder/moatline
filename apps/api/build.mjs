// Bundles the API for production.
//
// `tsc` alone cannot produce a runnable server here: it emits the source's
// extensionless relative imports verbatim (Node's ESM loader rejects those),
// and the workspace `db` package exports TypeScript source that Node cannot
// load. Bundling resolves both, so the entry point is a single self-contained
// file plus the packages installed in node_modules.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

// Everything this app declares stays external and is resolved from
// node_modules at runtime. The workspace `db` package is bundled in (it ships
// TypeScript), which pulls in its own `postgres` driver as well.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== "db");

await esbuild.build({
  entryPoints: [join(here, "src/index.ts")],
  outfile: join(here, "dist/index.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  external,
  logLevel: "info",
});
