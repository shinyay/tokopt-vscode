import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSuppressions,
  suppressionInsertOffset,
  buildSuppressionInsert,
  isSuppressionSupported,
} from "./suppressions.js";

test("parseSuppressions extracts rule ids case-insensitively", () => {
  const ids = parseSuppressions(
    "x\n<!-- tokopt:disable=polite-filler -->\n<!--tokopt:disable=Kitchen-Sink-System-Prompt-->"
  );
  assert.deepEqual([...ids].sort(), [
    "kitchen-sink-system-prompt",
    "polite-filler",
  ]);
});

test("suppressionInsertOffset is 0 when no front matter", () => {
  assert.equal(suppressionInsertOffset("# Title\n\nbody"), 0);
});

test("suppressionInsertOffset lands after YAML front matter", () => {
  const content = "---\nname: x\ndesc: y\n---\n# Title\n";
  const off = suppressionInsertOffset(content);
  assert.equal(content.slice(0, off), "---\nname: x\ndesc: y\n---\n");
});

test("suppressionInsertOffset handles CRLF front matter", () => {
  const content = "---\r\nname: x\r\n---\r\nbody";
  const off = suppressionInsertOffset(content);
  assert.equal(content.slice(0, off), "---\r\nname: x\r\n---\r\n");
});

test("buildSuppressionInsert puts comment at top (issue #30)", () => {
  const { offset, text } = buildSuppressionInsert("# Title\nbody", "polite-filler");
  assert.equal(offset, 0);
  assert.equal(text, "<!-- tokopt:disable=polite-filler -->\n\n");
});

test("buildSuppressionInsert puts comment after front matter", () => {
  const content = "---\nname: x\n---\nbody";
  const { offset, text } = buildSuppressionInsert(content, "huge-agents-md");
  assert.equal(content.slice(0, offset), "---\nname: x\n---\n");
  assert.equal(text, "<!-- tokopt:disable=huge-agents-md -->\n\n");
});

test("isSuppressionSupported only for markdown", () => {
  assert.equal(isSuppressionSupported("a.md"), true);
  assert.equal(isSuppressionSupported("A.MARKDOWN"), true);
  assert.equal(isSuppressionSupported("x.json"), false);
});
