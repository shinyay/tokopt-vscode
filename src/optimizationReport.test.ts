import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOptimizationReport } from "./optimizationReport.js";
import type { AuditResult } from "./audit.js";
import type { Finding } from "./detect.js";

const baseAudit: AuditResult = {
  root: "/ws",
  encoding: "o200k_base",
  files: [],
  alwaysOnTotal: 2412,
  conditionalTotal: 3926,
  onDemandTotal: 2039,
  raw: "{}",
};

const auditWithCredit: AuditResult = {
  ...baseAudit,
  credit: {
    model: "gpt-5.5",
    nanoAiuPerInputToken: 312500,
    alwaysOnNanoAiu: 753_750_000,
    conditionalNanoAiu: 1_226_875_000,
    onDemandNanoAiu: 637_187_500,
    totalNanoAiu: 2_617_812_500,
  },
};

const findings: Finding[] = [
  {
    id: "kitchen-sink-system-prompt",
    title: "Always-on instruction file is large",
    severity: "info",
    confidence: "measured",
    location: ".github/copilot-instructions.md",
    recommendation: "Cut to the smallest set of rules.",
    est_tokens_saved: 130,
  },
  {
    id: "huge-agents-md",
    title: "AGENTS.md is large",
    severity: "warn",
    confidence: "measured",
    location: "AGENTS.md",
    recommendation: "Trim to landmines and conventions only.",
    est_tokens_saved: 1282,
  },
];

test("report: header + sections present", () => {
  const md = renderOptimizationReport(auditWithCredit, findings, {
    requestsPerDay: 200,
    creditModel: "gpt-5.5",
    generatedAt: "2026-06-20T00:00:00Z",
  });
  assert.match(md, /# 🪙 Token Optimization Report/);
  assert.match(md, /## 1\. Where your tokens go/);
  assert.match(md, /## 2\. What to optimize/);
  assert.match(md, /## 3\. How to act/);
  assert.match(md, /2026-06-20T00:00:00Z/);
});

test("report: cost columns appear when credit present", () => {
  const md = renderOptimizationReport(auditWithCredit, findings, {
    requestsPerDay: 200,
    generatedAt: "t",
  });
  // always-on 753_750_000 nano = 0.75375 AIU ≈ $0.0075
  assert.match(md, /Cost \/ event/);
  assert.match(md, /0\.754 AIU/); // formatAiu(0.75375) → "0.754 AIU"
  assert.match(md, /every request/);
  // monthly projection: 0.75375 × 200 × 30 = 4522.5 AIU ≈ $45.23
  assert.match(md, /\$45\.23 \/ month/);
});

test("report: tokens-only table when no credit", () => {
  const md = renderOptimizationReport(baseAudit, findings, {
    requestsPerDay: 200,
    generatedAt: "t",
  });
  assert.doesNotMatch(md, /Cost \/ event/);
  assert.match(md, /set `tokopt\.creditModel`/);
  assert.match(md, /2,412/); // always-on token count still shown
});

test("report: savings sorted desc by est_tokens_saved", () => {
  const md = renderOptimizationReport(auditWithCredit, findings, {
    requestsPerDay: 200,
    generatedAt: "t",
  });
  // total = 130 + 1282 = 1412
  assert.match(md, /Total estimated savings: ~1,412 tokens/);
  // huge-agents-md (1282) must appear before kitchen-sink (130)
  const idxHuge = md.indexOf("huge-agents-md");
  const idxKitchen = md.indexOf("kitchen-sink-system-prompt");
  assert.ok(idxHuge < idxKitchen, "larger savings should rank first");
});

test("report: empty findings → celebratory message", () => {
  const md = renderOptimizationReport(auditWithCredit, [], {
    requestsPerDay: 200,
    generatedAt: "t",
  });
  assert.match(md, /No anti-patterns detected/);
});

test("report: requestsPerDay reflected in projection", () => {
  const md = renderOptimizationReport(auditWithCredit, findings, {
    requestsPerDay: 100,
    generatedAt: "t",
  });
  // 0.75375 × 100 × 30 = 2261.25 AIU ≈ $22.61
  assert.match(md, /\$22\.61 \/ month/);
  assert.match(md, /100 requests\/day/);
});
