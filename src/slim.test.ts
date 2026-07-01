import test from "node:test";
import assert from "node:assert/strict";
import { buildSlimArgs, isUnknownFlagError } from "./slimArgs.js";

test("buildSlimArgs passes --enable-jp-idiom by default (issue #45)", () => {
  assert.deepEqual(buildSlimArgs("/tmp/a.md", { jpIdiom: true }), [
    "slim",
    "--input",
    "/tmp/a.md",
    "--enable-jp-idiom",
  ]);
});

test("buildSlimArgs omits the flag for the backward-compat retry", () => {
  assert.deepEqual(buildSlimArgs("/tmp/a.md", { jpIdiom: false }), [
    "slim",
    "--input",
    "/tmp/a.md",
  ]);
});

test("isUnknownFlagError matches cobra's unknown-flag message", () => {
  assert.equal(
    isUnknownFlagError("Error: error: unknown flag: --enable-jp-idiom"),
    true
  );
  assert.equal(isUnknownFlagError("UNKNOWN FLAG: --enable-jp-idiom"), true);
});

test("isUnknownFlagError does not match unrelated failures", () => {
  assert.equal(isUnknownFlagError("Error: ENOENT: no such file"), false);
  assert.equal(isUnknownFlagError("slim: pipeline timed out"), false);
  assert.equal(isUnknownFlagError(""), false);
});
