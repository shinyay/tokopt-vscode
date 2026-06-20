import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelsJson } from "./embeddedModels.js";

test("parseModelsJson: extracts sorted-as-given model names", () => {
  const stdout = JSON.stringify({
    format_version: "v1",
    rate_source: "embedded",
    models: [
      { name: "claude-opus-4.8", basis: "catalog", nano_aiu_per_input_token: 500000 },
      { name: "gpt-5.5", basis: "empirical", nano_aiu_per_input_token: 312500 },
    ],
  });
  assert.deepEqual(parseModelsJson(stdout), ["claude-opus-4.8", "gpt-5.5"]);
});

test("parseModelsJson: ignores entries without a string name", () => {
  const stdout = JSON.stringify({
    models: [{ name: "a" }, { nano_aiu_per_input_token: 1 }, { name: 42 }],
  });
  assert.deepEqual(parseModelsJson(stdout), ["a"]);
});

test("parseModelsJson: returns [] on malformed JSON", () => {
  assert.deepEqual(parseModelsJson("{not json"), []);
});

test("parseModelsJson: returns [] when models is missing or not an array", () => {
  assert.deepEqual(parseModelsJson(JSON.stringify({ rate_source: "x" })), []);
  assert.deepEqual(parseModelsJson(JSON.stringify({ models: {} })), []);
});

test("parseModelsJson: empty models array yields []", () => {
  assert.deepEqual(parseModelsJson(JSON.stringify({ models: [] })), []);
});
