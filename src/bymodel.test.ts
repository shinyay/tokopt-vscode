import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByModelJson } from "./bymodel.js";

const sample = JSON.stringify({
  format_version: "v1",
  encoding: "o200k_base",
  rate_source: "embedded",
  repo: { always_on_total: 2412, total: 8377 },
  models: [
    {
      name: "gpt-5-mini",
      basis: "catalog",
      nano_aiu_per_input_token: 25000,
      always_on_nano_aiu: 60_300_000,
      total_nano_aiu: 209_425_000,
    },
    {
      name: "claude-opus-4.8",
      basis: "catalog",
      nano_aiu_per_input_token: 500000,
      always_on_nano_aiu: 1_206_000_000,
      total_nano_aiu: 4_188_500_000,
    },
  ],
});

test("parseByModelJson: extracts rows preserving CLI order", () => {
  const rows = parseByModelJson(sample);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "gpt-5-mini");
  assert.equal(rows[0].basis, "catalog");
  assert.equal(rows[0].alwaysOnNanoAiu, 60_300_000);
  assert.equal(rows[1].name, "claude-opus-4.8");
  assert.equal(rows[1].totalNanoAiu, 4_188_500_000);
});

test("parseByModelJson: malformed JSON → []", () => {
  assert.deepEqual(parseByModelJson("{not json"), []);
});

test("parseByModelJson: missing/empty models → []", () => {
  assert.deepEqual(parseByModelJson(JSON.stringify({ repo: {} })), []);
  assert.deepEqual(parseByModelJson(JSON.stringify({ models: [] })), []);
  assert.deepEqual(parseByModelJson(JSON.stringify({ models: {} })), []);
});

test("parseByModelJson: rows without a string name are skipped", () => {
  const rows = parseByModelJson(
    JSON.stringify({
      models: [
        { name: "ok", always_on_nano_aiu: 1 },
        { name: 5, always_on_nano_aiu: 1 },
        { basis: "x", always_on_nano_aiu: 1 },
      ],
    })
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["ok"]
  );
});

test("parseByModelJson: invalid total/rate coerce to 0 (always-on still required)", () => {
  const rows = parseByModelJson(
    JSON.stringify({
      models: [
        { name: "m", always_on_nano_aiu: 42, total_nano_aiu: null, nano_aiu_per_input_token: "x" },
      ],
    })
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].alwaysOnNanoAiu, 42);
  assert.equal(rows[0].totalNanoAiu, 0);
  assert.equal(rows[0].nanoAiuPerInputToken, 0);
  assert.equal(rows[0].basis, "");
});

test("parseByModelJson: rows with missing/invalid always_on cost are skipped", () => {
  const rows = parseByModelJson(
    JSON.stringify({
      models: [
        { name: "good", always_on_nano_aiu: 100, total_nano_aiu: 200 },
        { name: "no-cost" }, // missing always_on → skipped
        { name: "neg", always_on_nano_aiu: -5 }, // negative → skipped
        { name: "nan", always_on_nano_aiu: "x" }, // non-number → skipped
        { name: "zero-ok", always_on_nano_aiu: 0 }, // 0 is valid (zero-token repo)
      ],
    })
  );
  assert.deepEqual(rows.map((r) => r.name), ["good", "zero-ok"]);
});
