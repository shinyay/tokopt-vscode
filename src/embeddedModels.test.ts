import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseModelsJson,
  parseModelsJsonDetailed,
  basisMapFromModels,
} from "./embeddedModels.js";

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

test("parseModelsJsonDetailed: retains basis alongside name", () => {
  const stdout = JSON.stringify({
    models: [
      { name: "claude-opus-4.8", basis: "catalog", nano_aiu_per_input_token: 500000 },
      { name: "gpt-5.5", basis: "empirical", nano_aiu_per_input_token: 312500 },
    ],
  });
  assert.deepEqual(parseModelsJsonDetailed(stdout), [
    { name: "claude-opus-4.8", basis: "catalog" },
    { name: "gpt-5.5", basis: "empirical" },
  ]);
});

test("parseModelsJsonDetailed: missing/non-string basis becomes empty string", () => {
  const stdout = JSON.stringify({
    models: [{ name: "a" }, { name: "b", basis: 42 }],
  });
  assert.deepEqual(parseModelsJsonDetailed(stdout), [
    { name: "a", basis: "" },
    { name: "b", basis: "" },
  ]);
});

test("parseModelsJsonDetailed: drops entries without a string name", () => {
  const stdout = JSON.stringify({
    models: [{ name: "a", basis: "empirical" }, { basis: "catalog" }, { name: 7 }],
  });
  assert.deepEqual(parseModelsJsonDetailed(stdout), [
    { name: "a", basis: "empirical" },
  ]);
});

test("parseModelsJsonDetailed: returns [] on malformed JSON", () => {
  assert.deepEqual(parseModelsJsonDetailed("{nope"), []);
});

test("parseModelsJsonDetailed: drops empty-string names (parity with parseModelsJson)", () => {
  const stdout = JSON.stringify({
    models: [{ name: "a", basis: "empirical" }, { name: "" }, { name: "b" }],
  });
  assert.deepEqual(parseModelsJsonDetailed(stdout), [
    { name: "a", basis: "empirical" },
    { name: "b", basis: "" },
  ]);
  assert.deepEqual(parseModelsJson(stdout), ["a", "b"]);
});

test("basisMapFromModels: maps only available models with a non-empty basis", () => {
  const detailed = [
    { name: "gpt-5.5", basis: "empirical" },
    { name: "claude-opus-4.8", basis: "catalog" },
    { name: "mystery", basis: "" },
  ];
  const map = basisMapFromModels(detailed, [
    "gpt-5.5",
    "claude-opus-4.8",
    "mystery",
    "not-in-detail",
  ]);
  assert.deepEqual(map, {
    "gpt-5.5": "empirical",
    "claude-opus-4.8": "catalog",
  });
});

test("basisMapFromModels: excludes models absent from available", () => {
  const detailed = [{ name: "gpt-5.5", basis: "empirical" }];
  assert.deepEqual(basisMapFromModels(detailed, ["claude-opus-4.8"]), {});
});

test("basisMapFromModels: undefined/empty detail yields {}", () => {
  assert.deepEqual(basisMapFromModels(undefined, ["gpt-5.5"]), {});
  assert.deepEqual(basisMapFromModels([], ["gpt-5.5"]), {});
});
