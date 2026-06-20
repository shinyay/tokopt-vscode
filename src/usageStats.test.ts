import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, computeStats, histogram } from "./usageStats.js";

test("percentile: nearest-rank on 1..10", () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(a, 0.5), 5);
  assert.equal(percentile(a, 0.9), 9);
  assert.equal(percentile(a, 0.95), 10);
  assert.equal(percentile(a, 1.0), 10);
});

test("percentile: edge cases", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([42], 0.99), 42);
});

test("computeStats: empty → zeros", () => {
  const s = computeStats([]);
  assert.equal(s.count, 0);
  assert.equal(s.sum, 0);
  assert.equal(s.p99, 0);
});

test("computeStats: basic distribution", () => {
  const s = computeStats([10, 20, 30, 40, 50]);
  assert.equal(s.count, 5);
  assert.equal(s.sum, 150);
  assert.equal(s.mean, 30);
  assert.equal(s.min, 10);
  assert.equal(s.max, 50);
  assert.equal(s.p50, 30);
});

test("computeStats: heavy-tail share (top 1% of 100 records)", () => {
  // 99 records of 1 token + 1 record of 901 tokens = 1000 total
  const vals = [...Array(99).fill(1), 901];
  const s = computeStats(vals);
  assert.equal(s.count, 100);
  assert.equal(s.sum, 1000);
  // top 1% = 1 record = 901 → 90.1%
  assert.ok(Math.abs(s.topSharePct - 90.1) < 0.001, `got ${s.topSharePct}`);
  assert.equal(s.topShareLabel, "top 1%");
});

test("computeStats: filters negatives / NaN", () => {
  const s = computeStats([10, -5, NaN, 20, Infinity]);
  assert.equal(s.count, 2);
  assert.equal(s.sum, 30);
});

test("histogram: equal-width bins, max in last bin", () => {
  const bins = histogram([0, 0, 10], 2);
  assert.equal(bins.length, 2);
  assert.equal(bins[0].start, 0);
  assert.equal(bins[0].end, 5);
  assert.equal(bins[0].count, 2); // the two 0s
  assert.equal(bins[1].count, 1); // the 10 (max) in last bin
});

test("histogram: all-equal values → single bin", () => {
  const bins = histogram([7, 7, 7], 10);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].count, 3);
});

test("histogram: empty → []", () => {
  assert.deepEqual(histogram([], 10), []);
});
