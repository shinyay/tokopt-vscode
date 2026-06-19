import { build } from "esbuild";
import { glob } from "node:fs/promises";

// Compile *.test.ts → out-test/ as runnable CJS for `node --test`.
// Pure modules (credit.ts, optimizationReport.ts) carry no `vscode`
// import; `vscode` is marked external as a safety net so a stray import
// can never break the test bundle.
const entryPoints = [];
for await (const file of glob("src/**/*.test.ts")) {
  entryPoints.push(file);
}

await build({
  entryPoints,
  bundle: true,
  outdir: "out-test",
  external: ["vscode", "node:test", "node:assert", "node:assert/strict"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
});
