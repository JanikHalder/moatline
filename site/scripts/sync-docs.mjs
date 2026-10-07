// Copies the reference documentation from docs/ into the site, so the
// repository keeps one source. Run before `vitepress dev|build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(here, "../../docs");
const out = path.resolve(here, "../reference");

// Public reference only — docs/cloud-billing.md is for running the service.
const pages = [
  ["SERVER_MONITORING.md", "server-monitoring.md"],
  ["health-endpoint.md", "health-endpoint.md"],
  ["UPDATE_STRATEGY.md", "update-strategy.md"],
  ["one-click-templates.md", "templates.md"],
];

fs.mkdirSync(out, { recursive: true });
for (const [from, to] of pages) {
  let text = fs.readFileSync(path.join(docs, from), "utf8");
  // Links between the copied pages keep working under their new names.
  for (const [a, b] of pages)
    text = text
      .replaceAll(`](${a})`, `](./${b.replace(/\.md$/, "")})`)
      .replaceAll(`](docs/${a})`, `](./${b.replace(/\.md$/, "")})`);
  fs.writeFileSync(
    path.join(out, to),
    // v-pre: the docs show `${{ … }}` (GitHub Actions) — not Vue.
    `<!-- Generated from docs/${from} — edit it there. -->\n\n::: v-pre\n\n${text}\n\n:::\n`
  );
}
console.log(`synced ${pages.length} reference pages`);
