import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSlimArgs,
  isUnknownFlagError,
  parseRecommendedFlags,
  resolveSlimFlags,
} from "./slimArgs.js";

test("buildSlimArgs appends the given flags (issue #45/#47)", () => {
  assert.deepEqual(buildSlimArgs("/tmp/a.md", ["--enable-jp-idiom"]), [
    "slim",
    "--input",
    "/tmp/a.md",
    "--enable-jp-idiom",
  ]);
});

test("buildSlimArgs with no flags is a plain run", () => {
  assert.deepEqual(buildSlimArgs("/tmp/a.md", []), ["slim", "--input", "/tmp/a.md"]);
});

test("buildSlimArgs preserves multiple flags in order", () => {
  assert.deepEqual(buildSlimArgs("/tmp/a.md", ["--enable-jp-idiom", "--enable-jp-idiom-cosmetic"]), [
    "slim",
    "--input",
    "/tmp/a.md",
    "--enable-jp-idiom",
    "--enable-jp-idiom-cosmetic",
  ]);
});

test("isUnknownFlagError matches cobra's unknown-flag message", () => {
  assert.equal(isUnknownFlagError("Error: error: unknown flag: --enable-jp-idiom"), true);
  assert.equal(isUnknownFlagError("UNKNOWN FLAG: --enable-jp-idiom"), true);
});

test("isUnknownFlagError does not match unrelated failures", () => {
  assert.equal(isUnknownFlagError("Error: ENOENT: no such file"), false);
  assert.equal(isUnknownFlagError("slim: pipeline timed out"), false);
  assert.equal(isUnknownFlagError(""), false);
});

// --- #47: recommendations probe --------------------------------------------

test("parseRecommendedFlags extracts --enable-* flags", () => {
  const json = {
    recommendations: [
      { flag: "--enable-jp-idiom", reason: "..." },
      { flag: "--enable-jp-idiom-cosmetic", reason: "..." },
    ],
  };
  assert.deepEqual(parseRecommendedFlags(json), [
    "--enable-jp-idiom",
    "--enable-jp-idiom-cosmetic",
  ]);
});

test("parseRecommendedFlags ignores --profile recommendations", () => {
  const json = { recommendations: [{ flag: "--profile api-json", reason: "..." }] };
  assert.deepEqual(parseRecommendedFlags(json), []);
});

test("parseRecommendedFlags is empty for old CLI / malformed input", () => {
  assert.deepEqual(parseRecommendedFlags({}), []);
  assert.deepEqual(parseRecommendedFlags({ recommendations: "nope" }), []);
  assert.deepEqual(parseRecommendedFlags(null), []);
  assert.deepEqual(parseRecommendedFlags({ recommendations: [{ reason: "no flag" }] }), []);
});

test("resolveSlimFlags uses probe flags when present", () => {
  assert.deepEqual(
    resolveSlimFlags(["--enable-jp-idiom"], { probeSucceeded: true }),
    ["--enable-jp-idiom"]
  );
});

test("resolveSlimFlags falls back to jp-idiom when probe empty or failed", () => {
  assert.deepEqual(resolveSlimFlags([], { probeSucceeded: true }), ["--enable-jp-idiom"]);
  assert.deepEqual(resolveSlimFlags([], { probeSucceeded: false }), ["--enable-jp-idiom"]);
  // Even if an old CLI somehow returned flags on a failed probe, failure forces fallback.
  assert.deepEqual(resolveSlimFlags(["--x"], { probeSucceeded: false }), ["--enable-jp-idiom"]);
});
