import type { AuditResult, AuditFile } from "./audit.js";
import type { Finding } from "./detect.js";
import {
  formatAiu,
  formatUsd,
  nanoAiuToAiu,
  nanoAiuToUsd,
  projectMonthlyUsd,
} from "./credit.js";

/**
 * PURE rendering for the graphical Token Optimization Dashboard (Webview).
 *
 * No `vscode` import — takes already-parsed data and returns an HTML
 * string. Charts are dependency-free inline SVG so the webview needs no
 * external resources (CSP-safe) and the chart math is unit-testable with
 * `node --test`. Colours use VS Code's `--vscode-charts-*` theme
 * variables so the dashboard matches the active editor theme.
 */

export type Scope = AuditFile["scope"];

export interface DashboardFile {
  relPath: string;
  absPath: string;
  tokens: number;
  scope: Scope;
  category: string;
}

export interface DashboardFinding {
  id: string;
  severity: Finding["severity"];
  location: string;
  recommendation: string;
  estTokensSaved: number;
}

export interface DashboardScope {
  scope: Scope;
  tokens: number;
  fileCount: number;
  nanoAiu?: number;
}

export interface DashboardData {
  root: string;
  encoding: string;
  creditModel?: string;
  requestsPerDay: number;
  generatedAt: string;
  scopes: DashboardScope[];
  topFiles: DashboardFile[];
  findings: DashboardFinding[];
  totalTokens: number;
  alwaysOnNanoAiu?: number;
  totalNanoAiu?: number;
}

export const SCOPE_META: Record<
  Scope,
  { label: string; chartVar: string; cadence: string }
> = {
  "always-on": {
    label: "Always-on",
    chartVar: "--vscode-charts-red",
    cadence: "every request",
  },
  conditional: {
    label: "Conditional",
    chartVar: "--vscode-charts-blue",
    cadence: "per invocation",
  },
  "on-demand": {
    label: "On-demand",
    chartVar: "--vscode-charts-green",
    cadence: "per use",
  },
};

const SCOPE_ORDER: Scope[] = ["always-on", "conditional", "on-demand"];

const SEVERITY_META: Record<
  Finding["severity"],
  { label: string; chartVar: string; rank: number }
> = {
  critical: { label: "critical", chartVar: "--vscode-charts-red", rank: 0 },
  high: { label: "high", chartVar: "--vscode-charts-orange", rank: 1 },
  warn: { label: "warn", chartVar: "--vscode-charts-yellow", rank: 2 },
  info: { label: "info", chartVar: "--vscode-charts-blue", rank: 3 },
};

/** HTML-escape a string for safe interpolation into element text/attrs. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Map the parsed audit + detect results into the flat, vscode-free
 * DashboardData the renderer consumes. `topFileLimit` caps the per-file
 * bar chart so huge workspaces stay readable.
 */
export function buildDashboardData(
  audit: AuditResult,
  findings: Finding[],
  opts: {
    creditModel?: string;
    requestsPerDay: number;
    generatedAt: string;
    topFileLimit?: number;
  }
): DashboardData {
  const limit = opts.topFileLimit ?? 14;
  const credit = audit.credit;

  const scopeTokens: Record<Scope, number> = {
    "always-on": audit.alwaysOnTotal,
    conditional: audit.conditionalTotal,
    "on-demand": audit.onDemandTotal,
  };
  const scopeNano: Record<Scope, number | undefined> = {
    "always-on": credit?.alwaysOnNanoAiu,
    conditional: credit?.conditionalNanoAiu,
    "on-demand": credit?.onDemandNanoAiu,
  };
  const fileCounts: Record<Scope, number> = {
    "always-on": 0,
    conditional: 0,
    "on-demand": 0,
  };
  for (const f of audit.files) {
    fileCounts[f.scope] += 1;
  }

  const scopes: DashboardScope[] = SCOPE_ORDER.map((scope) => ({
    scope,
    tokens: scopeTokens[scope],
    fileCount: fileCounts[scope],
    nanoAiu: scopeNano[scope],
  }));

  const topFiles: DashboardFile[] = [...audit.files]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit)
    .map((f) => ({
      relPath: f.path,
      absPath: f.path,
      tokens: f.tokens,
      scope: f.scope,
      category: f.category,
    }));

  const dashFindings: DashboardFinding[] = [...findings]
    .sort((a, b) => {
      if (b.est_tokens_saved !== a.est_tokens_saved) {
        return b.est_tokens_saved - a.est_tokens_saved;
      }
      return SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank;
    })
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      location: f.location,
      recommendation: f.recommendation,
      estTokensSaved: f.est_tokens_saved,
    }));

  return {
    root: audit.root,
    encoding: audit.encoding,
    creditModel: opts.creditModel,
    requestsPerDay: opts.requestsPerDay,
    generatedAt: opts.generatedAt,
    scopes,
    topFiles,
    findings: dashFindings,
    totalTokens:
      audit.alwaysOnTotal + audit.conditionalTotal + audit.onDemandTotal,
    alwaysOnNanoAiu: credit?.alwaysOnNanoAiu,
    totalNanoAiu: credit?.totalNanoAiu,
  };
}

interface DonutSegment {
  label: string;
  value: number;
  colorVar: string;
}

/**
 * Render a donut chart as inline SVG. Each segment is a circle whose
 * stroke-dasharray draws exactly its fraction of the circumference,
 * positioned with a negative stroke-dashoffset accumulator. Rotated -90°
 * so the first segment starts at 12 o'clock.
 *
 * Exposed (and pure) so the segment geometry is unit-testable.
 */
export function donutSvg(
  segments: DonutSegment[],
  opts: { size?: number; thickness?: number; centerLabel?: string; centerSub?: string } = {}
): string {
  const size = opts.size ?? 160;
  const thickness = opts.thickness ?? 26;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);

  let acc = 0;
  const arcs: string[] = [];
  if (total > 0) {
    for (const seg of segments) {
      const frac = Math.max(0, seg.value) / total;
      const dash = frac * circ;
      if (dash <= 0) continue;
      arcs.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" ` +
          `stroke="var(${seg.colorVar})" stroke-width="${thickness}" ` +
          `stroke-dasharray="${dash.toFixed(3)} ${circ.toFixed(3)}" ` +
          `stroke-dashoffset="${(-acc).toFixed(3)}" ` +
          `transform="rotate(-90 ${cx} ${cy})" />`
      );
      acc += dash;
    }
  } else {
    arcs.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" ` +
        `stroke="var(--vscode-charts-lines)" stroke-width="${thickness}" opacity="0.3" />`
    );
  }

  const center = opts.centerLabel
    ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-center">${escapeHtml(
        opts.centerLabel
      )}</text>` +
      (opts.centerSub
        ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-sub">${escapeHtml(
            opts.centerSub
          )}</text>`
        : "")
    : "";

  return (
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" ` +
    `role="img" class="donut">${arcs.join("")}${center}</svg>`
  );
}

interface BarRow {
  label: string;
  sublabel?: string;
  value: number;
  valueLabel: string;
  colorVar: string;
  path?: string;
}

/**
 * Render a horizontal bar chart. Bar width is value/max of the chart
 * area. Rows with a `path` are marked clickable (the webview script
 * posts an openFile message). Pure → bar width math is testable.
 */
export function hbarSvg(rows: BarRow[]): string {
  if (rows.length === 0) {
    return `<p class="empty">Nothing to chart.</p>`;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  const items = rows
    .map((r) => {
      const pct = Math.max(0, (r.value / max) * 100);
      const clickable = r.path ? " clickable" : "";
      const dataAttr = r.path
        ? ` data-path="${escapeHtml(r.path)}" tabindex="0" role="button"`
        : "";
      const sub = r.sublabel
        ? `<span class="bar-sub">${escapeHtml(r.sublabel)}</span>`
        : "";
      return (
        `<div class="bar-row${clickable}"${dataAttr}>` +
        `<div class="bar-label" title="${escapeHtml(r.label)}">${escapeHtml(
          r.label
        )}${sub}</div>` +
        `<div class="bar-track">` +
        `<div class="bar-fill" style="width:${pct.toFixed(
          1
        )}%;background:var(${r.colorVar})"></div>` +
        `</div>` +
        `<div class="bar-value">${escapeHtml(r.valueLabel)}</div>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="bars">${items}</div>`;
}

function metricCard(opts: {
  label: string;
  value: string;
  sub?: string;
  accentVar?: string;
}): string {
  const accent = opts.accentVar
    ? ` style="border-left:3px solid var(${opts.accentVar})"`
    : "";
  return (
    `<div class="card"${accent}>` +
    `<div class="card-label">${escapeHtml(opts.label)}</div>` +
    `<div class="card-value">${escapeHtml(opts.value)}</div>` +
    (opts.sub ? `<div class="card-sub">${escapeHtml(opts.sub)}</div>` : "") +
    `</div>`
  );
}

function modelOptions(selected: string | undefined): string {
  const models = [
    "none",
    "gpt-5.5",
    "claude-opus-4.7-1m-internal",
    "gemini-3.1-pro-preview",
    "mai-code-1-flash-internal",
  ];
  const sel = selected && selected !== "" ? selected : "none";
  return models
    .map(
      (m) =>
        `<option value="${escapeHtml(m)}"${
          m === sel ? " selected" : ""
        }>${escapeHtml(m === "none" ? "none (tokens only)" : m)}</option>`
    )
    .join("");
}

/** Total estimated savings across findings. */
function totalSavings(findings: DashboardFinding[]): number {
  return findings.reduce((s, f) => s + Math.max(0, f.estTokensSaved), 0);
}

export function renderDashboardHtml(
  data: DashboardData,
  ctx: { cspSource: string; nonce: string }
): string {
  const hasCredit = !!data.creditModel && data.creditModel !== "none";

  // ---- Metric cards ----
  const alwaysOn = data.scopes.find((s) => s.scope === "always-on");
  const cards: string[] = [];
  cards.push(
    metricCard({
      label: "Always-on tax",
      value: `${(alwaysOn?.tokens ?? 0).toLocaleString()} tok`,
      sub:
        hasCredit && data.alwaysOnNanoAiu
          ? `~${formatUsd(
              projectMonthlyUsd(data.alwaysOnNanoAiu, data.requestsPerDay)
            )}/mo · paid every request`
          : "paid on every request",
      accentVar: "--vscode-charts-red",
    })
  );
  cards.push(
    metricCard({
      label: "Total customization",
      value: `${data.totalTokens.toLocaleString()} tok`,
      sub:
        hasCredit && data.totalNanoAiu
          ? `${formatAiu(nanoAiuToAiu(data.totalNanoAiu))} ≈ ${formatUsd(
              nanoAiuToUsd(data.totalNanoAiu)
            )} / event-set`
          : `${data.scopes.reduce((s, x) => s + x.fileCount, 0)} files`,
    })
  );
  const saveable = totalSavings(data.findings);
  cards.push(
    metricCard({
      label: "Potential savings",
      value: `~${saveable.toLocaleString()} tok`,
      sub: `across ${data.findings.length} finding${
        data.findings.length === 1 ? "" : "s"
      }`,
      accentVar: "--vscode-charts-green",
    })
  );
  const worst = data.findings[0];
  cards.push(
    metricCard({
      label: "Anti-patterns",
      value: `${data.findings.length}`,
      sub: worst ? `top: ${worst.id}` : "none detected 🎉",
      accentVar: worst
        ? SEVERITY_META[worst.severity].chartVar
        : "--vscode-charts-green",
    })
  );

  // ---- Scope donut + legend ----
  const donut = donutSvg(
    SCOPE_ORDER.map((scope) => ({
      label: SCOPE_META[scope].label,
      value: data.scopes.find((s) => s.scope === scope)?.tokens ?? 0,
      colorVar: SCOPE_META[scope].chartVar,
    })),
    {
      centerLabel: `${data.totalTokens.toLocaleString()}`,
      centerSub: "tokens",
    }
  );
  const legend = data.scopes
    .map((s) => {
      const meta = SCOPE_META[s.scope];
      const pct =
        data.totalTokens > 0
          ? ((s.tokens / data.totalTokens) * 100).toFixed(0)
          : "0";
      const cost =
        hasCredit && s.nanoAiu !== undefined
          ? ` · ${formatAiu(nanoAiuToAiu(s.nanoAiu))} ≈ ${formatUsd(
              nanoAiuToUsd(s.nanoAiu)
            )}/${meta.cadence.split(" ").pop()}`
          : "";
      return (
        `<li><span class="swatch" style="background:var(${meta.chartVar})"></span>` +
        `<span class="legend-label">${escapeHtml(meta.label)}</span>` +
        `<span class="legend-val">${s.tokens.toLocaleString()} tok · ${pct}% · ${
          s.fileCount
        } file${s.fileCount === 1 ? "" : "s"}${escapeHtml(cost)}</span></li>`
      );
    })
    .join("");

  // ---- Top files bar chart ----
  const fileBars = hbarSvg(
    data.topFiles.map((f) => ({
      label: f.relPath,
      sublabel: SCOPE_META[f.scope].label,
      value: f.tokens,
      valueLabel: `${f.tokens.toLocaleString()}`,
      colorVar: SCOPE_META[f.scope].chartVar,
      path: f.absPath,
    }))
  );

  // ---- Savings bar chart + finding cards ----
  const savingsBars = hbarSvg(
    data.findings
      .filter((f) => f.estTokensSaved > 0)
      .map((f) => ({
        label: f.id,
        sublabel: f.location,
        value: f.estTokensSaved,
        valueLabel: `~${f.estTokensSaved.toLocaleString()}`,
        colorVar: SEVERITY_META[f.severity].chartVar,
      }))
  );

  const findingCards =
    data.findings.length === 0
      ? `<p class="empty">No anti-patterns detected — nothing to trim. 🎉</p>`
      : data.findings
          .map((f) => {
            const meta = SEVERITY_META[f.severity];
            const saved =
              f.estTokensSaved > 0
                ? `<span class="finding-saved">~${f.estTokensSaved.toLocaleString()} tok</span>`
                : "";
            return (
              `<div class="finding" style="border-left:3px solid var(${meta.chartVar})">` +
              `<div class="finding-head">` +
              `<span class="sev" style="background:var(${meta.chartVar})">${escapeHtml(
                meta.label
              )}</span>` +
              `<span class="finding-id">${escapeHtml(f.id)}</span>` +
              saved +
              `</div>` +
              `<div class="finding-loc clickable" data-path="${escapeHtml(
                f.location
              )}" tabindex="0" role="button">${escapeHtml(f.location)}</div>` +
              `<div class="finding-rec">${escapeHtml(f.recommendation)}</div>` +
              `</div>`
            );
          })
          .join("");

  const csp =
    `default-src 'none'; ` +
    `img-src ${ctx.cspSource} https: data:; ` +
    `style-src ${ctx.cspSource} 'unsafe-inline'; ` +
    `script-src 'nonce-${ctx.nonce}';`;

  const modelNote = hasCredit
    ? `Cost model: <strong>${escapeHtml(
        data.creditModel as string
      )}</strong> · 1 AIU = $0.01 · monthly assumes ${data.requestsPerDay.toLocaleString()} req/day`
    : `Set a cost model to project AI Credits / USD.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Token Optimization Dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 20px 40px;
    margin: 0;
  }
  h1 { font-size: 1.4em; margin: 0 0 2px; }
  h2 { font-size: 1.05em; margin: 26px 0 10px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
  .subtle { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 14px 0 4px; }
  .toolbar label { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  select, input[type="number"] {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
    border-radius: 4px; padding: 3px 6px; font-size: 0.9em;
  }
  input[type="number"] { width: 70px; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 0.9em;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 8px; }
  .card {
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px; padding: 12px 14px;
  }
  .card-label { font-size: 0.78em; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .04em; }
  .card-value { font-size: 1.7em; font-weight: 600; margin-top: 4px; }
  .card-sub { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 3px; }
  .scope-wrap { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
  .donut { flex: 0 0 auto; }
  .donut-center { fill: var(--vscode-foreground); font-size: 22px; font-weight: 600; }
  .donut-sub { fill: var(--vscode-descriptionForeground); font-size: 11px; }
  ul.legend { list-style: none; padding: 0; margin: 0; }
  ul.legend li { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 0.9em; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto; }
  .legend-label { font-weight: 600; min-width: 90px; }
  .legend-val { color: var(--vscode-descriptionForeground); }
  .bars { display: flex; flex-direction: column; gap: 5px; }
  .bar-row { display: grid; grid-template-columns: minmax(140px, 240px) 1fr 70px; gap: 10px; align-items: center; padding: 2px 4px; border-radius: 4px; }
  .bar-row.clickable { cursor: pointer; }
  .bar-row.clickable:hover { background: var(--vscode-list-hoverBackground); }
  .bar-label { font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-sub { color: var(--vscode-descriptionForeground); font-size: 0.82em; margin-left: 6px; }
  .bar-track { background: var(--vscode-input-background, rgba(127,127,127,.15)); border-radius: 4px; height: 14px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; min-width: 2px; }
  .bar-value { text-align: right; font-variant-numeric: tabular-nums; font-size: 0.85em; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 760px) { .two-col { grid-template-columns: 1fr; } }
  .findings { display: flex; flex-direction: column; gap: 8px; }
  .finding { background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px 10px; }
  .finding-head { display: flex; align-items: center; gap: 8px; }
  .sev { color: #fff; font-size: 0.72em; padding: 1px 7px; border-radius: 10px; text-transform: uppercase; letter-spacing: .03em; }
  .finding-id { font-weight: 600; font-size: 0.9em; }
  .finding-saved { margin-left: auto; color: var(--vscode-charts-green); font-size: 0.85em; font-weight: 600; }
  .finding-loc { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8em; color: var(--vscode-textLink-foreground); margin: 3px 0; }
  .clickable { cursor: pointer; }
  .clickable:hover { text-decoration: underline; }
  .finding-rec { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .footnote { margin-top: 28px; font-size: 0.78em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); padding-top: 10px; }
</style>
</head>
<body>
  <h1>🪙 Token Optimization Dashboard</h1>
  <div class="subtle">${escapeHtml(data.root)} · encoding ${escapeHtml(
    data.encoding
  )}</div>
  <div class="toolbar">
    <label for="model">Cost model</label>
    <select id="model">${modelOptions(data.creditModel)}</select>
    <label for="rpd">Requests/day</label>
    <input id="rpd" type="number" min="0" value="${data.requestsPerDay}" />
    <button id="refresh">↻ Refresh</button>
    <span class="subtle">${modelNote}</span>
  </div>

  <div class="cards">${cards.join("")}</div>

  <h2>Where your tokens go</h2>
  <div class="scope-wrap">
    ${donut}
    <ul class="legend">${legend}</ul>
  </div>

  <div class="two-col">
    <div>
      <h2>Heaviest files</h2>
      ${fileBars}
    </div>
    <div>
      <h2>Savings opportunities</h2>
      ${
        savingsBars.includes("Nothing")
          ? `<p class="empty">No measurable savings — clean workspace. 🎉</p>`
          : savingsBars
      }
    </div>
  </div>

  <h2>Anti-patterns &amp; recommendations</h2>
  <div class="findings">${findingCards}</div>

  <div class="footnote">
    Generated ${escapeHtml(data.generatedAt)} · click a file or finding to open it.
    ${
      hasCredit
        ? "Cost is an estimate from an empirical Copilot-CLI rate card; real billing varies with cache hits, output and reasoning tokens."
        : ""
    }
  </div>

  <script nonce="${ctx.nonce}">
    const vscode = acquireVsCodeApi();
    function openPath(p) { if (p) vscode.postMessage({ type: "openFile", path: p }); }
    document.querySelectorAll("[data-path]").forEach((el) => {
      el.addEventListener("click", () => openPath(el.getAttribute("data-path")));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPath(el.getAttribute("data-path")); }
      });
    });
    document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
    document.getElementById("model").addEventListener("change", (e) =>
      vscode.postMessage({ type: "setModel", model: e.target.value }));
    document.getElementById("rpd").addEventListener("change", (e) =>
      vscode.postMessage({ type: "setRequestsPerDay", value: Number(e.target.value) }));
  </script>
</body>
</html>`;
}
