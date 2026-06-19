import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  donutSvg,
  hbarSvg,
  buildDashboardData,
  renderDashboardHtml,
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
