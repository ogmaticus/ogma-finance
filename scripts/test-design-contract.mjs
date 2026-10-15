import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
const tokenCSS = postcss.parse(readFileSync("public/design-tokens.css", "utf8"));
const known = new Set();
tokenCSS.walkDecls((d) => {
  if (d.prop.startsWith("--")) known.add(d.prop);
});
const fonts = new Set([
  "var(--text-small)",
  "var(--text-body)",
  "var(--text-label)",
  "var(--text-heading)",
  "var(--text-amount)",
  "var(--text-hero)",
]);
for (const file of ["base.css", "theme.css", "appearance.css", "shell.css"]) {
  const css = postcss.parse(readFileSync("public/" + file, "utf8"));
  css.walkDecls((d) => {
    for (const m of d.value.matchAll(/var\((--[\w-]+)/g))
      assert.ok(known.has(m[1]), file + ": unresolved " + m[1]);
    assert.ok(!/#[\da-f]{3,8}\b|rgba?\(/i.test(d.value), file + ": color outside token source");
    if (d.prop === "font-size")
      assert.ok(
        fonts.has(d.value) || d.value === "inherit" || d.value.startsWith("clamp("),
        file + ": typography outside scale: " + d.value,
      );
    if (/^(margin|padding|gap|row-gap|column-gap)(-|$)/.test(d.prop))
      assert.ok(
        !/\dpx/.test(d.value.replace(/var\([^)]*\)/g, "")),
        file + ": spacing outside tokens",
      );
  });
}
const html = readFileSync("public/app.html", "utf8");
assert.match(html, /viewport-fit=cover/);
assert.ok(!html.includes("<style>"));
const order = ["base.css", "theme.css", "design-tokens.css", "appearance.css", "shell.css"].map(
  (name) => html.indexOf(name),
);
assert.deepEqual(
  order.slice().sort((a, b) => a - b),
  order,
);
const tokens = Object.fromEntries(
  [...readFileSync("public/design-tokens.css", "utf8").matchAll(/--(text-[\w-]+):\s*(\d+)px/g)].map(
    (m) => [m[1], Number(m[2])],
  ),
);
assert.deepEqual(
  Object.values(tokens).sort((a, b) => a - b),
  [13, 15, 17, 20, 28, 34],
);
const shell = readFileSync("public/shell.css", "utf8"),
  appearance = readFileSync("public/appearance.css", "utf8");
assert.match(appearance, /:focus-visible/);
assert.match(appearance, /prefers-reduced-motion/);
assert.match(shell, /safe-area-inset-bottom/);
console.log(
  "PASS: centralized colors/spacing/radii/fonts, resolved CSS variables, six-size minimum-13px type scale, stylesheet order, focus/reduced motion and safe-area declarations; browser layout remains unverified",
);
// The content offset must always match the fixed desktop menu width.
const layout = postcss.parse(shell);
const desktopMain = layout.nodes.find((n) => n.type === "rule" && n.selector === "main");
const desktopAside = layout.nodes.find((n) => n.type === "rule" && n.selector === ".shell-sidebar");
const valueOf = (rule, prop) => rule.nodes.find((n) => n.prop === prop)?.value;
assert.equal(valueOf(desktopAside, "width"), "var(--sidebar-width)");
assert.equal(valueOf(desktopMain, "margin-left"), "var(--sidebar-width)");
assert.equal(valueOf(desktopMain, "width"), "calc(100% - var(--sidebar-width))");
postcss
  .parse(readFileSync("public/base.css", "utf8"))
  .walkRules((rule) =>
    assert.notEqual(rule.selector, "main", "main layout belongs only in shell.css"),
  );
assert.match(
  shell,
  /#app-header \.month-control\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*max-content/s,
);
assert.ok(
  JSON.parse(readFileSync("package.json", "utf8")).devDependencies.postcss,
  "CSS parser must be an explicit dev dependency",
);
assert.ok(
  !readFileSync("scripts/test-backups.mjs", "utf8").includes("/workspace/"),
  "backup tests must work outside this host",
);
