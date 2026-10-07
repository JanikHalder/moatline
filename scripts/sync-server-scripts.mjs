// Copies the server setup scripts from the save-server repository into the
// app, which serves them to servers (GET /api/agent/scripts/<name>).
//
// save-server is the source of truth; run this after changing a script there:
//   pnpm sync:server-scripts [path/to/save-server]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.resolve(
  process.argv[2] ?? path.join(root, "..", "save-server")
);
const target = path.join(root, "apps/api/server-scripts");
const SCRIPTS = [
  "harden-server.sh",
  "auto-update.sh",
  "setup-github-runner.sh",
];

for (const name of SCRIPTS) {
  const from = path.join(source, "scripts", name);
  if (!fs.existsSync(from)) {
    console.error(`missing: ${from}`);
    process.exit(1);
  }
  const before = fs.existsSync(path.join(target, name))
    ? fs.readFileSync(path.join(target, name), "utf8")
    : null;
  const body = fs.readFileSync(from, "utf8");
  fs.writeFileSync(path.join(target, name), body, { mode: 0o755 });
  console.log(`${before === body ? "unchanged" : "updated  "} ${name}`);
}
