import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUsageRow, parseJsonlRows, parseCsvRows } from "./usageLog.js";

const shutdownLine = JSON.stringify({
  type: "session.shutdown",
  timestamp: "2026-06-20T00:00:00Z",
  data: {
    currentTokens: 11932,
    modelMetrics: {
      "claude-opus-4.7-1m-internal": {
        requests: { count: 90, cost: 8 },
        usage: { inputTokens: 19304952, outputTokens: 106071 },
        totalNanoAiu: 2956585650000,
      },
      "gpt-5.5": {
        requests: { count: 10 },
        usage: { inputTokens: 500 },
        totalNanoAiu: 156250000,
      },
    },
  },
});

test("extractUsageRow: sums input tokens + nanoAiu + requests across models", () => {
  const row = extractUsageRow(shutdownLine, "sess-123");
  assert.ok(row);
  assert.equal(row!.tokens, 19304952 + 500);
  assert.equal(row!.nanoAiu, 2956585650000 + 156250000);
  assert.equal(row!.requests, 100);
  assert.equal(row!.sessionId, "sess-123");
  assert.equal(row!.timestamp, "2026-06-20T00:00:00Z");
  assert.match(row!.model!, /claude-opus-4\.7-1m-internal/);
  assert.match(row!.model!, /gpt-5\.5/);
});

test("extractUsageRow: non-shutdown line → null", () => {
  assert.equal(extractUsageRow(JSON.stringify({ type: "session.start" })), null);
  assert.equal(extractUsageRow("not json at all"), null);
  assert.equal(extractUsageRow(""), null);
});

test("extractUsageRow: shutdown without modelMetrics → null", () => {
  const line = JSON.stringify({ type: "session.shutdown", data: { currentTokens: 100 } });
  assert.equal(extractUsageRow(line), null);
});

test("extractUsageRow: never reads message content (privacy)", () => {
  const line = JSON.stringify({
    type: "session.shutdown",
    data: {
      user_message: "SECRET PROMPT",
      assistant_response: "SECRET REPLY",
      modelMetrics: { m: { usage: { inputTokens: 5 }, totalNanoAiu: 1 } },
    },
  });
  const row = extractUsageRow(line);
  assert.ok(row);
  // row carries only numeric/meta fields — no message text anywhere
  assert.equal(JSON.stringify(row).includes("SECRET"), false);
});

test("parseJsonlRows: reads token column + optional nano_aiu/session", () => {
  const content =
    JSON.stringify({ tokens: 100, nano_aiu: 5, session: "a" }) +
    "\n" +
    JSON.stringify({ tokens: 200 }) +
    "\nnot-json\n";
  const rows = parseJsonlRows(content, "tokens");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tokens, 100);
  assert.equal(rows[0].nanoAiu, 5);
  assert.equal(rows[0].sessionId, "a");
  assert.equal(rows[1].tokens, 200);
});

test("parseCsvRows: header-based column lookup", () => {
  const csv = "id,tokens,model\n1,300,gpt\n2,400,claude\nbad\n";
  const rows = parseCsvRows(csv, "tokens");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tokens, 300);
  assert.equal(rows[1].tokens, 400);
});

test("parseCsvRows: missing column → []", () => {
  assert.deepEqual(parseCsvRows("a,b\n1,2\n", "tokens"), []);
});
