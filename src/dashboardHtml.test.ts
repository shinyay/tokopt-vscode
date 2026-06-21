import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  donutSvg,
  hbarSvg,
  buildDashboardData,
  renderDashboardHtml,
  renderPromptAnatomy,
  modelOptions,
  type DashboardData,
} from "./dashboardHtml.js";
import type { AuditResult } from "./audit.js";
import type { Finding } from "./detect.js";

test("escapeHtml escapes the five dangerous chars", () => {
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("donutSvg: two equal segments → equal dash lengths (half circumference)", () => {
  const svg = donutSvg([
    { label: "a", value: 1, colorVar: "--c1" },
    { label: "b", value: 1, colorVar: "--c2" },
  ], { size: 160, thickness: 26 });
  // r = (160-26)/2 = 67; circ = 2π·67 ≈ 420.973; half ≈ 210.487
  assert.match(svg, /stroke-dasharray="210\.487/);
  // first segment offset 0, second offset -210.487
  assert.match(svg, /stroke-dashoffset="0\.000"/);
  assert.match(svg, /stroke-dashoffset="-210\.487"/);
  assert.match(svg, /<svg /);
});

test("donutSvg: zero total renders a placeholder ring", () => {
  const svg = donutSvg([{ label: "a", value: 0, colorVar: "--c1" }]);
  assert.match(svg, /charts-lines/);
  assert.doesNotMatch(svg, /stroke-dasharray/);
});

test("donutSvg: center label is rendered and escaped", () => {
  const svg = donutSvg([{ label: "a", value: 1, colorVar: "--c1" }], {
    centerLabel: "8,377",
    centerSub: "tokens",
  });
  assert.match(svg, /donut-center">8,377</);
  assert.match(svg, /donut-sub">tokens</);
});

test("hbarSvg: widest row is 100%, half-value row is 50%", () => {
  const html = hbarSvg([
    { label: "big", value: 100, valueLabel: "100", colorVar: "--c" },
    { label: "half", value: 50, valueLabel: "50", colorVar: "--c" },
  ]);
  assert.match(html, /width:100\.0%/);
  assert.match(html, /width:50\.0%/);
});

test("hbarSvg: rows with path are clickable + carry data-path", () => {
  const html = hbarSvg([
    { label: "f", value: 1, valueLabel: "1", colorVar: "--c", path: "AGENTS.md" },
  ]);
  assert.match(html, /class="bar-row clickable"/);
  assert.match(html, /data-path="AGENTS\.md"/);
});

test("hbarSvg: empty rows → friendly message", () => {
  assert.match(hbarSvg([]), /Nothing to chart/);
});

const audit: AuditResult = {
  root: "/ws",
  encoding: "o200k_base",
  files: [
    { path: "AGENTS.md", category: "agents-md", scope: "always-on", tokens: 1782, bytes: 7302 },
    { path: ".github/copilot-instructions.md", category: "copilot-instructions", scope: "always-on", tokens: 630, bytes: 2629 },
    { path: ".github/skills/x/SKILL.md", category: "skill-definition", scope: "on-demand", tokens: 170, bytes: 755 },
  ],
  alwaysOnTotal: 2412,
  conditionalTotal: 0,
  onDemandTotal: 170,
  credit: {
    model: "gpt-5.5",
    nanoAiuPerInputToken: 312500,
    alwaysOnNanoAiu: 753_750_000,
    conditionalNanoAiu: 0,
    onDemandNanoAiu: 53_125_000,
    totalNanoAiu: 806_875_000,
  },
  raw: "{}",
};

const findings: Finding[] = [
  { id: "huge-agents-md", title: "t", severity: "warn", confidence: "measured", location: "AGENTS.md", recommendation: "Trim it.", est_tokens_saved: 1282 },
  { id: "kitchen-sink-system-prompt", title: "t", severity: "info", confidence: "measured", location: ".github/copilot-instructions.md", recommendation: "Cut rules.", est_tokens_saved: 130 },
];

test("buildDashboardData: scopes, top files sorted, savings sorted", () => {
  const d = buildDashboardData(audit, findings, {
    creditModel: "gpt-5.5",
    requestsPerDay: 200,
    generatedAt: "t",
  });
  assert.equal(d.totalTokens, 2582);
  // top file is AGENTS.md (1782) first
  assert.equal(d.topFiles[0].relPath, "AGENTS.md");
  assert.equal(d.topFiles[0].tokens, 1782);
  // always-on scope carries 2 files + credit
  const ao = d.scopes.find((s) => s.scope === "always-on")!;
  assert.equal(ao.fileCount, 2);
  assert.equal(ao.nanoAiu, 753_750_000);
  // findings sorted by savings desc
  assert.equal(d.findings[0].id, "huge-agents-md");
});

test("buildDashboardData: topFileLimit caps the list", () => {
  const d = buildDashboardData(audit, findings, {
    requestsPerDay: 200,
    generatedAt: "t",
    topFileLimit: 1,
  });
  assert.equal(d.topFiles.length, 1);
});

test("renderDashboardHtml: valid doc, CSP, nonce, charts present", () => {
  const data = buildDashboardData(audit, findings, {
    creditModel: "gpt-5.5",
    requestsPerDay: 200,
    generatedAt: "2026-06-20T00:00:00Z",
  });
  const html = renderDashboardHtml(data, { cspSource: "vscode-resource:", nonce: "ABC123" });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'nonce-ABC123'/);
  assert.match(html, /<script nonce="ABC123">/);
  assert.match(html, /<svg /); // donut
  assert.match(html, /class="bars"/); // bar chart
  assert.match(html, /Always-on tax/); // metric card
  assert.match(html, /huge-agents-md/); // finding
  // cost projection present with credit
  assert.match(html, /\/mo/);
});

test("renderDashboardHtml: no credit model → tokens-only, enable hint", () => {
  const data = buildDashboardData(audit, [], {
    requestsPerDay: 200,
    generatedAt: "t",
  });
  // strip credit to simulate no model
  const noCredit: DashboardData = { ...data, creditModel: undefined, alwaysOnNanoAiu: undefined, totalNanoAiu: undefined };
  const html = renderDashboardHtml(noCredit, { cspSource: "x", nonce: "N" });
  assert.match(html, /Set a cost model/);
  assert.match(html, /No anti-patterns detected/);
});

// ---- R1: accessibility ----
test("donutSvg: carries an aria-label summarizing segments (a11y)", () => {
  const svg = donutSvg([
    { label: "Always-on", value: 30, colorVar: "--c1" },
    { label: "On-demand", value: 70, colorVar: "--c2" },
  ]);
  assert.match(svg, /aria-label="Token split by scope: Always-on 30 \(30%\), On-demand 70 \(70%\)"/);
});

test("hbarSvg: rows carry aria-label and the list has role=list (a11y)", () => {
  const html = hbarSvg([
    { label: "AGENTS.md", sublabel: "Always-on", value: 100, valueLabel: "100", colorVar: "--c", path: "AGENTS.md" },
  ]);
  assert.match(html, /role="list"/);
  assert.match(html, /aria-label="AGENTS\.md Always-on: 100 tokens"/);
});

// ---- R3: markdown report button ----
test("renderDashboardHtml: has an Open markdown report button wired to openReport", () => {
  const data = buildDashboardData(audit, findings, { creditModel: "gpt-5.5", requestsPerDay: 200, generatedAt: "t" });
  const html = renderDashboardHtml(data, { cspSource: "x", nonce: "N" });
  assert.match(html, /id="open-report"/);
  assert.match(html, /type: "openReport"/);
});

// ---- R5: heaviest-files scroll + count + higher default cap ----
test("buildDashboardData: default cap is 40 (was 14)", () => {
  // synthesize 50 files
  const many = { ...audit, files: Array.from({ length: 50 }, (_, i) => ({
    path: `f${i}.md`, category: "x", scope: "on-demand" as const, tokens: 50 - i, bytes: 1,
  })) };
  const d = buildDashboardData(many, [], { requestsPerDay: 200, generatedAt: "t" });
  assert.equal(d.topFiles.length, 40);
});

test("renderDashboardHtml: heaviest-files list is scrollable + shows count", () => {
  const data = buildDashboardData(audit, findings, { requestsPerDay: 200, generatedAt: "t" });
  const html = renderDashboardHtml(data, { cspSource: "x", nonce: "N" });
  assert.match(html, /class="scroll-bars"/);
  assert.match(html, /Heaviest files <span class="subtle">\(3\)<\/span>/);
});

// ---- R4: prompt anatomy (educational) ----
test("buildDashboardData: toolsTokens sums mcp-config files", () => {
  const withMcp = { ...audit, files: [
    ...audit.files,
    { path: ".copilot/mcp-config.json", category: "mcp-config", scope: "conditional" as const, tokens: 857, bytes: 1 },
    { path: ".vscode/mcp.json", category: "mcp-config", scope: "conditional" as const, tokens: 63, bytes: 1 },
  ] };
  const d = buildDashboardData(withMcp, [], { requestsPerDay: 200, generatedAt: "t" });
  assert.equal(d.toolsTokens, 920);
});

test("renderPromptAnatomy: 7 segments, repo ones measured, runtime greyed", () => {
  const withMcp = { ...audit, files: [
    ...audit.files,
    { path: ".copilot/mcp-config.json", category: "mcp-config", scope: "conditional" as const, tokens: 920, bytes: 1 },
  ] };
  const d = buildDashboardData(withMcp, [], { requestsPerDay: 200, generatedAt: "t" });
  const html = renderPromptAnatomy(d);
  // all 7 canonical segment names
  for (const name of ["System", "Always-on instructions", "Tools", "History", "Retrieved context", "User message", "Reasoning"]) {
    assert.match(html, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // repo-controlled measured values
  assert.match(html, /2,412 tok/); // always-on
  assert.match(html, /920 tok/);   // tools
  // runtime segments marked
  assert.match(html, /Copilot runtime/);
  assert.match(html, /you control/);
  // exactly two "you control" badges (always-on + tools)
  assert.equal((html.match(/🔧 you control/g) || []).length, 2);
});

test("renderDashboardHtml: includes the anatomy section", () => {
  const data = buildDashboardData(audit, findings, { creditModel: "gpt-5.5", requestsPerDay: 200, generatedAt: "t" });
  const html = renderDashboardHtml(data, { cspSource: "x", nonce: "N" });
  assert.match(html, /Anatomy of a request — what you control/);
});

// ---- Phase 24: dynamic model dropdown ----
test("modelOptions: defaults when no available list", () => {
  const html = modelOptions("gpt-5.5");
  assert.match(html, /value="none"/);
  assert.match(html, /value="gpt-5.5"[^>]*selected/);
  assert.match(html, /value="claude-opus-4.7-1m-internal"/);
});

test("modelOptions: uses the supplied available list (external card)", () => {
  const html = modelOptions("claude-opus-4.8", ["claude-opus-4.8", "o3", "deepseek-v4"]);
  assert.match(html, /value="none"/);
  assert.match(html, /value="claude-opus-4.8"[^>]*selected/);
  assert.match(html, /value="o3"/);
  assert.match(html, /value="deepseek-v4"/);
  // embedded defaults are NOT shown when an external list is supplied
  assert.doesNotMatch(html, /value="gpt-5.5"/);
});

test("modelOptions: keeps a selected value not in the available list", () => {
  const html = modelOptions("custom-model", ["gpt-5.5"]);
  assert.match(html, /value="custom-model"[^>]*selected/);
});

import { modelComparisonSection } from "./dashboardHtml.js";
import type { ModelCostRow } from "./bymodel.js";

const compareRows: ModelCostRow[] = [
  { name: "gpt-5-mini", basis: "catalog", nanoAiuPerInputToken: 25000, alwaysOnNanoAiu: 60_300_000, totalNanoAiu: 209_425_000 },
  { name: "gpt-5.5", basis: "empirical", nanoAiuPerInputToken: 312500, alwaysOnNanoAiu: 753_750_000, totalNanoAiu: 2_617_812_500 },
  { name: "claude-opus-4.8", basis: "catalog", nanoAiuPerInputToken: 500000, alwaysOnNanoAiu: 1_206_000_000, totalNanoAiu: 4_188_500_000 },
];

test("modelComparisonSection: empty rows → omitted entirely", () => {
  assert.equal(modelComparisonSection([], "gpt-5.5"), "");
});

test("modelComparisonSection: one bar per model, order preserved, heading present", () => {
  const html = modelComparisonSection(compareRows, undefined);
  assert.match(html, /Model cost comparison/);
  const rowCount = (html.match(/class="bar-row clickable model-row/g) ?? []).length;
  assert.equal(rowCount, 3);
  // CLI order preserved (cheapest first).
  assert.ok(html.indexOf("gpt-5-mini") < html.indexOf("claude-opus-4.8"));
});

test("modelComparisonSection: widest bar is the most expensive (100%)", () => {
  const html = modelComparisonSection(compareRows, undefined);
  // opus-4.8 is the max → 100.0%
  assert.match(html, /width:100\.0%/);
});

test("modelComparisonSection: each row carries data-model + basis badge", () => {
  const html = modelComparisonSection(compareRows, undefined);
  assert.match(html, /data-model="gpt-5.5"/);
  assert.match(html, /basis-empirical/);
  assert.match(html, /basis-catalog/);
  assert.match(html, /measured</); // empirical badge label
  assert.match(html, /est\.</);    // catalog badge label
});

test("modelComparisonSection: selected model is highlighted", () => {
  const html = modelComparisonSection(compareRows, "gpt-5.5");
  // The selected row gets the `selected` class on its model-row.
  assert.match(html, /model-row selected" data-model="gpt-5.5"/);
});

test("modelComparisonSection: 'none' selection highlights nothing", () => {
  const html = modelComparisonSection(compareRows, "none");
  assert.doesNotMatch(html, /model-row selected/);
});

test("modelComparisonSection: model names are HTML-escaped", () => {
  const html = modelComparisonSection(
    [{ name: '<x>&"', basis: "catalog", nanoAiuPerInputToken: 1, alwaysOnNanoAiu: 1, totalNanoAiu: 1 }],
    undefined
  );
  assert.doesNotMatch(html, /data-model="<x>/);
  assert.match(html, /&lt;x&gt;/);
});

test("renderDashboardHtml: includes the comparison section + data-model handler when rows present", () => {
  const data: DashboardData = {
    root: "/r", encoding: "o200k_base", requestsPerDay: 200, generatedAt: "now",
    scopes: [{ scope: "always-on", tokens: 100, fileCount: 1 }],
    topFiles: [], findings: [], totalTokens: 100, toolsTokens: 0,
    modelComparison: compareRows,
  };
  const html = renderDashboardHtml(data, { cspSource: "vscode-resource:", nonce: "n0" });
  assert.match(html, /Model cost comparison/);
  assert.match(html, /data-model/);
  assert.match(html, /selectModel\(/); // the click handler is wired
});

test("renderDashboardHtml: no comparison section when modelComparison absent (back-compat)", () => {
  const data: DashboardData = {
    root: "/r", encoding: "o200k_base", requestsPerDay: 200, generatedAt: "now",
    scopes: [{ scope: "always-on", tokens: 100, fileCount: 1 }],
    topFiles: [], findings: [], totalTokens: 100, toolsTokens: 0,
  };
  const html = renderDashboardHtml(data, { cspSource: "vscode-resource:", nonce: "n0" });
  assert.doesNotMatch(html, /Model cost comparison/);
});
