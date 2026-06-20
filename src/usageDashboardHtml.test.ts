import { test } from "node:test";
import assert from "node:assert/strict";
import { histogramSvg, percentileBars, renderUsageHtml, type UsageViewData } from "./usageDashboardHtml.js";
import { computeStats, histogram } from "./usageStats.js";

const values = [100, 200, 300, 400, 500, 600, 9000];
const data: UsageViewData = {
  sourceLabel: "Copilot CLI · 7 sessions",
  recordCount: 7,
  stats: computeStats(values),
  histogram: histogram(values, 10),
  outliers: [
    { tokens: 9000, nanoAiu: 2_812_500_000, requests: 90, model: "gpt-5.5", sessionId: "abcdef12-0000" },
    { tokens: 600, requests: 5, model: "claude", sessionId: "12345678-1111" },
  ],
  totalNanoAiu: 3_000_000_000,
  creditModel: "gpt-5.5",
  generatedAt: "2026-06-20T00:00:00Z",
};

test("histogramSvg: renders bars + axis", () => {
  const svg = histogramSvg(histogram(values, 5));
  assert.match(svg, /<svg /);
  assert.match(svg, /<rect /);
  assert.match(svg, /aria-label="Token distribution histogram"/);
});

test("histogramSvg: empty → message", () => {
  assert.match(histogramSvg([]), /No data to chart/);
});

test("percentileBars: 5 rows with aria-labels", () => {
  const html = percentileBars(computeStats(values));
  assert.match(html, /p50 \(median\)/);
  assert.match(html, /p99/);
  assert.match(html, /max/);
  assert.match(html, /aria-label="max:/);
});

test("renderUsageHtml: full doc, CSP, nonce, charts, heavy-tail, privacy", () => {
  const html = renderUsageHtml(data, { cspSource: "vscode-resource:", nonce: "NONCE1" });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /script-src 'nonce-NONCE1'/);
  assert.match(html, /<script nonce="NONCE1">/);
  assert.match(html, /📉 Usage Analysis/);
  assert.match(html, /Distribution/);
  assert.match(html, /heavy tail/i);
  // outlier table with the big session
  assert.match(html, /9,000/);
  assert.match(html, /abcdef12/);
  // privacy note
  assert.match(html, /only token counts/);
  assert.match(html, /never your prompts/);
});

test("renderUsageHtml: cost column appears with credit model", () => {
  const html = renderUsageHtml(data, { cspSource: "x", nonce: "N" });
  assert.match(html, /<th>Cost<\/th>/);
});

test("renderUsageHtml: no credit → tokens-only, enable hint, no cost column", () => {
  const noCredit: UsageViewData = { ...data, creditModel: undefined, totalNanoAiu: undefined };
  const html = renderUsageHtml(noCredit, { cspSource: "x", nonce: "N" });
  assert.doesNotMatch(html, /<th>Cost<\/th>/);
  assert.match(html, /Set a cost model/);
});

test("renderUsageHtml: zero records → friendly empty state", () => {
  const empty: UsageViewData = { ...data, recordCount: 0, outliers: [], histogram: [] };
  const html = renderUsageHtml(empty, { cspSource: "x", nonce: "N" });
  assert.match(html, /No usage records found/);
});
