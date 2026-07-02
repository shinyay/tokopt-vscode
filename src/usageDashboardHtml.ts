import { escapeHtml, modelOptions, modelBasisCaveat } from "./dashboardHtml.js";
import {
  formatAiu,
  formatUsd,
  nanoAiuToAiu,
  nanoAiuToUsd,
} from "./credit.js";
import type { UsageStats, HistogramBin } from "./usageStats.js";
import type { UsageRow } from "./usageLog.js";

/**
 * PURE rendering for the Usage Analysis webview — token/credit consumption
 * distribution (percentiles + heavy-tail + histogram) over a usage log.
 * No `vscode` import; charts are dependency-free inline SVG.
 */

export interface UsageViewData {
  sourceLabel: string;
  recordCount: number;
  stats: UsageStats;
  histogram: HistogramBin[];
  /** Top-N outlier rows (largest token consumers), already sorted desc. */
  outliers: UsageRow[];
  /** Sum of nano-AIU across all rows (when available). */
  totalNanoAiu?: number;
  creditModel?: string;
  availableModels?: string[];
  availableModelsBasis?: Record<string, string>;
  generatedAt: string;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/** Histogram as inline SVG (vertical bars). Pure. */
export function histogramSvg(bins: HistogramBin[]): string {
  if (bins.length === 0) {
    return `<p class="empty">No data to chart.</p>`;
  }
  const w = 640;
  const h = 160;
  const padB = 22;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const bw = w / bins.length;
  const bars = bins
    .map((b, i) => {
      const bh = (b.count / maxCount) * (h - padB);
      const x = i * bw;
      const y = h - padB - bh;
      const title = `${compact(b.start)}–${compact(b.end)} tok: ${b.count}`;
      return (
        `<rect x="${(x + 1).toFixed(1)}" y="${y.toFixed(1)}" ` +
        `width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" ` +
        `fill="var(--vscode-charts-blue)"><title>${escapeHtml(title)}</title></rect>`
      );
    })
    .join("");
  const first = compact(bins[0].start);
  const last = compact(bins[bins.length - 1].end);
  const axis =
    `<text x="0" y="${h - 6}" class="hx">${escapeHtml(first)}</text>` +
    `<text x="${w}" y="${h - 6}" text-anchor="end" class="hx">${escapeHtml(last)} tokens</text>`;
  return (
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" ` +
    `preserveAspectRatio="none" role="img" aria-label="Token distribution histogram" ` +
    `class="histogram">${bars}${axis}</svg>`
  );
}

/** Percentile bars (p50…max) as a small horizontal bar chart. Pure. */
export function percentileBars(stats: UsageStats): string {
  const rows: Array<{ label: string; value: number }> = [
    { label: "p50 (median)", value: stats.p50 },
    { label: "p90", value: stats.p90 },
    { label: "p95", value: stats.p95 },
    { label: "p99", value: stats.p99 },
    { label: "max", value: stats.max },
  ];
  const max = Math.max(stats.max, 1);
  const items = rows
    .map((r) => {
      const pct = (r.value / max) * 100;
      return (
        `<div class="pbar-row" aria-label="${escapeHtml(
          `${r.label}: ${r.value.toLocaleString()} tokens`
        )}">` +
        `<div class="pbar-label">${escapeHtml(r.label)}</div>` +
        `<div class="pbar-track"><div class="pbar-fill" style="width:${pct.toFixed(
          1
        )}%"></div></div>` +
        `<div class="pbar-value">${r.value.toLocaleString()}</div>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="pbars">${items}</div>`;
}

function metricCard(label: string, value: string, sub?: string, accent?: string): string {
  const a = accent ? ` style="border-left:3px solid var(${accent})"` : "";
  return (
    `<div class="card"${a}>` +
    `<div class="card-label">${escapeHtml(label)}</div>` +
    `<div class="card-value">${escapeHtml(value)}</div>` +
    (sub ? `<div class="card-sub">${escapeHtml(sub)}</div>` : "") +
    `</div>`
  );
}

export function renderUsageHtml(
  data: UsageViewData,
  ctx: { cspSource: string; nonce: string }
): string {
  const hasCredit = !!data.creditModel && data.creditModel !== "none";
  const s = data.stats;

  const cards: string[] = [];
  cards.push(metricCard("Sessions analyzed", data.recordCount.toLocaleString(),
    data.sourceLabel, "--vscode-charts-blue"));
  cards.push(metricCard("Total input tokens", compact(s.sum),
    hasCredit && data.totalNanoAiu
      ? `${formatAiu(nanoAiuToAiu(data.totalNanoAiu))} ≈ ${formatUsd(nanoAiuToUsd(data.totalNanoAiu))}`
      : `mean ${compact(s.mean)}/session`));
  cards.push(metricCard("Median (p50)", s.p50.toLocaleString(), "typical session"));
  cards.push(metricCard("p99", s.p99.toLocaleString(),
    `max ${s.max.toLocaleString()}`, "--vscode-charts-orange"));

  const heavyTail =
    `<div class="heavy">💡 <strong>${s.topShareLabel}</strong> of sessions account for ` +
    `<strong>${s.topSharePct.toFixed(1)}%</strong> of all input tokens — the heavy tail is where the spend hides.</div>`;

  const outliers =
    data.outliers.length === 0
      ? `<p class="empty">No sessions to rank.</p>`
      : `<table class="otable"><thead><tr><th>#</th><th>Tokens</th>` +
        (hasCredit ? `<th>Cost</th>` : ``) +
        `<th>Reqs</th><th>Model</th><th>Session</th></tr></thead><tbody>` +
        data.outliers
          .map((r, i) => {
            const cost =
              hasCredit && r.nanoAiu
                ? `<td>${formatUsd(nanoAiuToUsd(r.nanoAiu))}</td>`
                : hasCredit
                  ? `<td>—</td>`
                  : ``;
            const sid = r.sessionId
              ? `<code>${escapeHtml(r.sessionId.slice(0, 8))}</code>`
              : "—";
            return (
              `<tr><td>${i + 1}</td>` +
              `<td>${r.tokens.toLocaleString()}</td>` +
              cost +
              `<td>${r.requests ?? "—"}</td>` +
              `<td>${escapeHtml(r.model ?? "—")}</td>` +
              `<td>${sid}</td></tr>`
            );
          })
          .join("") +
        `</tbody></table>`;

  const csp =
    `default-src 'none'; img-src ${ctx.cspSource} https: data:; ` +
    `style-src ${ctx.cspSource} 'unsafe-inline'; script-src 'nonce-${ctx.nonce}';`;

  const modelNote = hasCredit
    ? `Cost model: <strong>${escapeHtml(data.creditModel as string)}</strong> · 1 AIU = $0.01${modelBasisCaveat(
        data.creditModel,
        data.availableModelsBasis
      )}`
    : `Set a cost model to project AI Credits / USD.`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Usage Analysis</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size,13px);
    color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 20px 40px; margin: 0; }
  h1 { font-size: 1.4em; margin: 0 0 2px; }
  h2 { font-size: 1.05em; margin: 24px 0 10px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
  .subtle { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 14px 0 4px; }
  .toolbar label { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); border-radius: 4px; padding: 3px 6px; font-size: 0.9em; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 0.9em; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 8px; }
  .card { background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px 14px; }
  .card-label { font-size: 0.78em; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .04em; }
  .card-value { font-size: 1.7em; font-weight: 600; margin-top: 4px; }
  .card-sub { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 3px; }
  .histogram { display: block; }
  .hx { fill: var(--vscode-descriptionForeground); font-size: 11px; }
  .pbars { display: flex; flex-direction: column; gap: 6px; max-width: 620px; }
  .pbar-row { display: grid; grid-template-columns: 110px 1fr 90px; gap: 10px; align-items: center; }
  .pbar-label { font-size: 0.85em; }
  .pbar-track { background: var(--vscode-input-background, rgba(127,127,127,.15)); border-radius: 4px; height: 14px; overflow: hidden; }
  .pbar-fill { height: 100%; border-radius: 4px; background: var(--vscode-charts-purple, var(--vscode-charts-blue)); min-width: 2px; }
  .pbar-value { text-align: right; font-variant-numeric: tabular-nums; font-size: 0.85em; }
  .heavy { margin: 14px 0; padding: 10px 12px; border-radius: 6px; border-left: 3px solid var(--vscode-charts-orange); background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); font-size: 0.92em; }
  table.otable { border-collapse: collapse; width: 100%; font-size: 0.86em; }
  table.otable th, table.otable td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  table.otable th { color: var(--vscode-descriptionForeground); font-weight: 600; }
  table.otable td { font-variant-numeric: tabular-nums; }
  code { font-family: var(--vscode-editor-font-family, monospace); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .footnote { margin-top: 28px; font-size: 0.78em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); padding-top: 10px; }
</style></head>
<body>
  <h1>📉 Usage Analysis</h1>
  <div class="subtle">${escapeHtml(data.sourceLabel)} · token-consumption distribution (the same analysis as <code>tokopt tail</code>)</div>
  <div class="toolbar">
    <label for="model">Cost model</label>
    <select id="model">${modelOptions(
      data.creditModel,
      data.availableModels,
      data.availableModelsBasis
    )}</select>
    <button id="refresh">↻ Refresh</button>
    <button id="pick" class="secondary">📂 Pick log file…</button>
    <span class="subtle">${modelNote}</span>
  </div>

  ${data.recordCount === 0
    ? `<div class="heavy">No usage records found. Copilot CLI logs live in <code>~/.copilot/session-state/</code>; or pick a JSONL/CSV file with a <code>tokens</code> column.</div>`
    : `
  <div class="cards">${cards.join("")}</div>

  <h2>Distribution</h2>
  ${histogramSvg(data.histogram)}

  <h2>Percentiles</h2>
  ${percentileBars(s)}

  <h2>The heavy tail — your most expensive sessions</h2>
  ${heavyTail}
  ${outliers}
  `}

  <div class="footnote">
    Generated ${escapeHtml(data.generatedAt)}.
    🔒 Privacy: this view reads <strong>only token counts, model names and session ids</strong> from
    Copilot CLI logs — never your prompts or replies.
    VS Code Copilot Chat does not persist per-request usage, so this analyzes Copilot CLI usage (or a file you pick).
  </div>

  <script nonce="${ctx.nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
    document.getElementById("pick").addEventListener("click", () => vscode.postMessage({ type: "pickFile" }));
    document.getElementById("model").addEventListener("change", (e) => vscode.postMessage({ type: "setModel", model: e.target.value }));
  </script>
</body></html>`;
}
