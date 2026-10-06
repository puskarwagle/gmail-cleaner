/**
 * Rebuilds mail-maze.html from the maze sources in src/web/maze/.
 *
 * Single-file build (file:// demo still works): main.ts (+ office-gen,
 * settings, textures, world, game, render, hud) is bundled with Bun.build()
 * as a classic IIFE script and inlined with maze.css into shell.html.
 * No external module/script references — only Google Fonts links remain.
 *
 * Usage: bun run build:maze  (also use --check for CI drift detection)
 */
const SHELL = new URL("../src/web/maze/shell.html", import.meta.url);
const CSS = new URL("../src/web/maze/maze.css", import.meta.url);
const ENTRY = new URL("../src/web/maze/main.ts", import.meta.url);
const HTML = new URL("../mail-maze.html", import.meta.url);

const CSS_MARKER = "/*MAZE-CSS*/";
const JS_MARKER = "//MAZE-JS";

const checkOnly = process.argv.includes("--check");

const build = await Bun.build({
  entrypoints: [ENTRY.pathname],
  target: "browser",
  format: "iife",
  minify: false,
  sourcemap: "none",
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  throw new Error("Bun.build() failed for src/web/maze/main.ts");
}
const bundleText = await build.outputs[0].text();
let js = bundleText.trimEnd() + "\n";
// Drop any sourceMappingURL comment (single-file, no map emitted).
js = js.replace(/\/\/# sourceMappingURL=.*\n?$/, "");

const css = (await Bun.file(CSS).text()).trimEnd() + "\n";
const shell = await Bun.file(SHELL).text();
if (!shell.includes(CSS_MARKER)) throw new Error("CSS marker not found in shell.html");
if (!shell.includes(JS_MARKER)) throw new Error("JS marker not found in shell.html");

const banner =
  "// ===== MAZE-BUNDLE-BEGIN (generated from src/web/maze/*.ts; do not hand-edit — run `bun run build:maze`) =====\n";
const footer = "// ===== MAZE-BUNDLE-END =====\n";
const rebuilt = shell.replace(CSS_MARKER, () => css).replace(JS_MARKER, () => banner + js + footer);

const current = await Bun.file(HTML).text();
if (checkOnly) {
  if (rebuilt !== current) {
    console.error("mail-maze.html is stale: run `bun run build:maze`.");
    process.exit(1);
  }
  console.log("mail-maze.html is in sync with src/web/maze/*.");
} else {
  await Bun.write(HTML, rebuilt);
  console.log("mail-maze.html rebuilt from src/web/maze/* via Bun.build().");
}
