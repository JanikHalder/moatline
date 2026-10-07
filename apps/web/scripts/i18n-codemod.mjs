// Wraps user-facing English text in tx("…") so it can be translated.
//
//   node apps/web/scripts/i18n-codemod.mjs <file.tsx> [more files]
//
// What it touches, and nothing else:
// - JSX text ("Scan now")
// - user-facing string attributes (title, description, placeholder,
//   aria-label, label, tooltip, alt)
// - string literals that are a JSX child expression, or a branch of a
//   conditional / logical expression inside one ({ok ? "Live" : "Down"})
// - the fallback in `e instanceof Error ? e.message : "…"` and string
//   arguments of toast.*()
// Template literals, class names and code are left alone. Review the diff.
import fs from "node:fs";
import ts from "typescript";

const ATTRS = new Set([
  "title",
  "description",
  "placeholder",
  "aria-label",
  "label",
  "tooltip",
  "alt",
]);

const decode = (s) =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const userText = (s) =>
  /[A-Za-z]{2,}/.test(s) &&
  !/^[a-z0-9._/:@-]+$/.test(s) && // identifiers, paths, ids
  !/^https?:\/\//.test(s) &&
  !/^[A-Z0-9_]+$/.test(s); // ENV_NAMES

const lit = (s) => JSON.stringify(s);

/** JSX whitespace rules: trim each line, drop empty ones, join with spaces. */
function jsxTextValue(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 1) return raw.replace(/\s+/g, " ");
  const out = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i !== 0) l = l.replace(/^ +/, "");
    if (i !== lines.length - 1) l = l.replace(/ +$/, "");
    if (l) out.push(l);
  });
  return out.join(" ").replace(/\s+/g, " ");
}

function insideCode(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) {
      const tag = p.openingElement.tagName.getText();
      if (tag === "code" || tag === "kbd" || tag === "pre") return true;
    }
  }
  return false;
}

export function transform(source, fileName) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const edits = [];
  const wrapLiteral = (node) => {
    const text = node.text;
    if (!userText(text)) return;
    edits.push([node.getStart(sf), node.getEnd(), `tx(${lit(text)})`]);
  };
  const wrapInExpression = (expr) => {
    if (!expr) return;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
      return wrapLiteral(expr);
    if (ts.isParenthesizedExpression(expr))
      return wrapInExpression(expr.expression);
    if (ts.isConditionalExpression(expr)) {
      wrapInExpression(expr.whenTrue);
      wrapInExpression(expr.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(expr) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(expr.operatorToken.kind)
    ) {
      wrapInExpression(expr.right);
      if (expr.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken)
        wrapInExpression(expr.left);
    }
  };

  const visit = (node) => {
    if (ts.isJsxText(node) && !insideCode(node)) {
      const raw = node.getFullText(sf);
      const value = decode(jsxTextValue(raw));
      const core = value.trim();
      if (userText(core) && !/[{}<>]/.test(core)) {
        const lead =
          value.startsWith(" ") && !/^\s*\n/.test(raw) ? `{" "}` : "";
        const trail = value.endsWith(" ") && !/\n\s*$/.test(raw) ? `{" "}` : "";
        edits.push([
          node.getStart(sf),
          node.getEnd(),
          `${lead}{tx(${lit(core)})}${trail}`,
        ]);
      }
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (ATTRS.has(name)) {
        const init = node.initializer;
        if (ts.isStringLiteral(init) && userText(init.text))
          edits.push([
            init.getStart(sf),
            init.getEnd(),
            `{tx(${lit(decode(init.text))})}`,
          ]);
        else if (ts.isJsxExpression(init)) wrapInExpression(init.expression);
      }
    } else if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      wrapInExpression(node.expression);
    } else if (
      ts.isConditionalExpression(node) &&
      /instanceof Error/.test(node.condition.getText(sf))
    ) {
      wrapInExpression(node.whenFalse);
    } else if (
      ts.isCallExpression(node) &&
      /^toast(\.\w+)?$/.test(node.expression.getText(sf)) &&
      node.arguments[0]
    ) {
      wrapInExpression(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) return source;

  // Apply from the end, skipping overlaps (an outer wrap already covers it).
  edits.sort((a, b) => b[0] - a[0]);
  let out = source;
  let lastStart = Infinity;
  for (const [start, end, text] of edits) {
    if (end > lastStart) continue;
    out = out.slice(0, start) + text + out.slice(end);
    lastStart = start;
  }
  if (!/import \{[^}]*\btx\b[^}]*\} from "@\/lib\/i18n"/.test(out)) {
    if (/from "@\/lib\/i18n";/.test(out))
      out = out.replace(
        /import \{([^}]*)\} from "@\/lib\/i18n";/,
        (m, names) => `import {${names.trimEnd()}, tx } from "@/lib/i18n";`
      );
    else {
      const lastImport = [...out.matchAll(/^import [\s\S]*?;\n/gm)].pop();
      const at = lastImport ? lastImport.index + lastImport[0].length : 0;
      out =
        out.slice(0, at) + `import { tx } from "@/lib/i18n";\n` + out.slice(at);
    }
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before, file);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(`wrapped ${file}`);
  }
}
