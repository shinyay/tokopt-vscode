/**
 * Usage-log statistics — PURE, dependency-free, unit-testable.
 *
 * Mirrors the math behind `tokopt tail` (percentiles + heavy-tail share)
 * and adds histogram binning for the chart. No `vscode` import.
 */

export interface UsageStats {
  count: number;
  sum: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  /** Share of the total contributed by the top `topShareFraction` of records. */
  topSharePct: number;
  topShareLabel: string;
}

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

/**
 * Nearest-rank percentile on a sorted ascending array. `q` in [0,1].
 * Returns 0 for an empty array.
 */
export function percentile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const rank = Math.ceil(q * n);
  const idx = Math.min(n - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/**
 * Compute distribution stats over a list of token (or any numeric) values.
 * `topShareFraction` defaults to 0.01 (the top 1% of records).
 */
export function computeStats(
  values: number[],
  topShareFraction = 0.01
): UsageStats {
  const clean = values.filter((v) => typeof v === "number" && isFinite(v) && v >= 0);
  const n = clean.length;
  if (n === 0) {
    return {
      count: 0, sum: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0,
      max: 0, min: 0, topSharePct: 0, topShareLabel: "top 1%",
    };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);

  // Heavy-tail share: how much of the total the largest k records hold.
  const k = Math.max(1, Math.ceil(n * topShareFraction));
  const topSum = sorted.slice(n - k).reduce((s, v) => s + v, 0);
  const topSharePct = sum > 0 ? (topSum / sum) * 100 : 0;
  const pctLabel = topShareFraction >= 0.01
    ? `top ${Math.round(topShareFraction * 100)}%`
    : `top ${k} of ${n}`;

  return {
    count: n,
    sum,
    mean: sum / n,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[n - 1],
    min: sorted[0],
    topSharePct,
    topShareLabel: pctLabel,
  };
}

/**
 * Bucket values into `binCount` equal-width bins spanning [min,max].
 * Returns empty array for empty input. The max value falls in the last bin.
 */
export function histogram(values: number[], binCount = 20): HistogramBin[] {
  const clean = values.filter((v) => typeof v === "number" && isFinite(v) && v >= 0);
  if (clean.length === 0 || binCount < 1) return [];
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (max === min) {
    return [{ start: min, end: max, count: clean.length }];
  }
  const width = (max - min) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of clean) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1; // max → last bin
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  return bins;
}
