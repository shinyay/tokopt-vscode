import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NANO_PER_AIU,
  USD_PER_AIU,
  nanoAiuToAiu,
  aiuToUsd,
  nanoAiuToUsd,
  formatAiu,
  formatUsd,
  creditModelArgs,
  creditRatesArgs,
  parseRateCardModels,
  isCreditEnabled,
  projectMonthlyAiu,
  projectMonthlyUsd,
  formatCostSuffix,
} from "./credit.js";

test("conversion constants", () => {
  assert.equal(NANO_PER_AIU, 1e9);
  assert.equal(USD_PER_AIU, 0.01);
});

test("nanoAiuToAiu: 1e9 nano = 1 AIU", () => {
  assert.equal(nanoAiuToAiu(1e9), 1);
  assert.equal(nanoAiuToAiu(196_875_000), 0.196875);
  assert.equal(nanoAiuToAiu(0), 0);
});

test("aiuToUsd: 1 AIU = $0.01", () => {
  assert.equal(aiuToUsd(1), 0.01);
  assert.equal(aiuToUsd(100), 1);
});

test("nanoAiuToUsd: nano / 1e11", () => {
  // 630 tokens @ gpt-5.5 (312500 nano/token) = 196_875_000 nano
  assert.equal(nanoAiuToUsd(196_875_000), 0.00196875);
});

test("formatAiu: tiered precision", () => {
  assert.equal(formatAiu(0), "0 AIU");
  assert.equal(formatAiu(0.196875), "0.197 AIU");
  assert.equal(formatAiu(12.5), "12.50 AIU");
  assert.equal(formatAiu(4522.5), "4,523 AIU");
});

test("formatUsd: tiered precision", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.00196875), "$0.0020");
  assert.equal(formatUsd(45.22), "$45.22");
  assert.equal(formatUsd(4522.5), "$4,523");
});

test("creditModelArgs: disabled cases return []", () => {
  assert.deepEqual(creditModelArgs(undefined), []);
  assert.deepEqual(creditModelArgs(null), []);
  assert.deepEqual(creditModelArgs(""), []);
  assert.deepEqual(creditModelArgs("none"), []);
});

test("creditModelArgs: enabled returns flag pair", () => {
  assert.deepEqual(creditModelArgs("gpt-5.5"), ["--credit-model", "gpt-5.5"]);
  assert.deepEqual(creditModelArgs("mai-code-1-flash-internal"), [
    "--credit-model",
    "mai-code-1-flash-internal",
  ]);
});

test("creditRatesArgs: path → flag pair; empty → []", () => {
  assert.deepEqual(creditRatesArgs("/tmp/rates.json"), [
    "--credit-rates",
    "/tmp/rates.json",
  ]);
  assert.deepEqual(creditRatesArgs(undefined), []);
  assert.deepEqual(creditRatesArgs(""), []);
});

test("parseRateCardModels: returns model keys; malformed → []", () => {
  const card = JSON.stringify({
    format_version: 1,
    models: { "claude-opus-4.8": { nano_aiu_per_input_token: 500000 }, "o3": {} },
  });
  assert.deepEqual(parseRateCardModels(card), ["claude-opus-4.8", "o3"]);
  assert.deepEqual(parseRateCardModels("not json"), []);
  assert.deepEqual(parseRateCardModels("{}"), []);
});

test("isCreditEnabled mirrors creditModelArgs", () => {
  assert.equal(isCreditEnabled(undefined), false);
  assert.equal(isCreditEnabled("none"), false);
  assert.equal(isCreditEnabled("gpt-5.5"), true);
});

test("projectMonthlyAiu: per-request nano × reqs/day × 30", () => {
  // always-on total 2412 tokens @ gpt-5.5 = 753_750_000 nano/request
  // 0.75375 AIU/req × 200 req/day × 30 = 4522.5 AIU/month
  assert.equal(projectMonthlyAiu(753_750_000, 200), 4522.5);
});

test("projectMonthlyUsd: monthly AIU × $0.01", () => {
  assert.equal(projectMonthlyUsd(753_750_000, 200), 45.225);
});

test("formatCostSuffix: always-on shows per-req + monthly", () => {
  const s = formatCostSuffix({
    nanoAiu: 753_750_000,
    kind: "always-on",
    requestsPerDay: 200,
  });
  assert.equal(s, "≈ 0.754 AIU/req · ~$45.23/mo");
});

test("formatCostSuffix: conditional shows per-invocation", () => {
  const s = formatCostSuffix({
    nanoAiu: 88_000_000,
    kind: "conditional",
    requestsPerDay: 200,
  });
  assert.equal(s, "≈ 0.088 AIU/invocation");
});

test("formatCostSuffix: on-demand shows per-use", () => {
  const s = formatCostSuffix({
    nanoAiu: 53_125_000,
    kind: "on-demand",
    requestsPerDay: 200,
  });
  assert.equal(s, "≈ 0.053 AIU/use");
});

test("formatCostSuffix: zero/negative nano returns empty", () => {
  assert.equal(
    formatCostSuffix({ nanoAiu: 0, kind: "always-on", requestsPerDay: 200 }),
    ""
  );
  assert.equal(
    formatCostSuffix({ nanoAiu: -5, kind: "always-on", requestsPerDay: 200 }),
    ""
  );
});
