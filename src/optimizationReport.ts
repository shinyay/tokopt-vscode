import type { AuditResult } from "./audit.js";
import type { Finding } from "./detect.js";
import {
  formatAiu,
  formatUsd,
  nanoAiuToAiu,
  nanoAiuToUsd,
  projectMonthlyAiu,
  projectMonthlyUsd,
} from "./credit.js";

/**
 * Renders the Workspace Optimization Report — a single markdown document
 * that fuses `tokopt audit` (where the tokens/cost are) with
 * `tokopt detect` (what to trim and by how much).
 *
 * PURE FUNCTION: takes already-parsed data + options, returns a markdown
 * string. No `vscode` import, no I/O — `import type` for AuditResult /
 * Finding is erased by esbuild, so this module stays unit-testable with
 * `node --test`.
 */

export interface OptimizationReportOptions {
  /** Configured requests/day used for always-on monthly projection. */
  requestsPerDay: number;
  /** Credit model name (for display); cost columns appear only when the
   * audit result carries a `credit` block. */
  creditModel?: string;
  /** Wall-clock timestamp string for the header (injected for testability). */
  generatedAt: string;
}

function severityRank(s: Finding["severity"]): number {
  switch (s) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "warn":
      return 2;
    default:
      return 3;
  }
}

function severityBadge(s: Finding["severity"]): string {
  switch (s) {
    case "critical":
      return "🔴 critical";
    case "high":
      return "🟠 high";
    case "warn":
      return "🟡 warn";
    default:
      return "🔵 info";
  }
}

/**
 * Build the cost-summary table. When the audit carries a credit block we
 * add AIU + monthly-USD columns; otherwise it's tokens-only (still useful).
 */
function renderCostSummary(audit: AuditResult): string[] {
  const lines: string[] = [];
  const credit = audit.credit;
  const totalTokens =
    audit.alwaysOnTotal + audit.conditionalTotal + audit.onDemandTotal;

  if (credit) {
    lines.push(
      `| Scope | Tokens | Cost / event | Billing cadence |`,
      `|---|---:|---:|---|`,
      `| **Always-on** | ${audit.alwaysOnTotal.toLocaleString()} | ${formatAiu(
        nanoAiuToAiu(credit.alwaysOnNanoAiu)
      )} ≈ ${formatUsd(
        nanoAiuToUsd(credit.alwaysOnNanoAiu)
      )} | **every request** |`,
      `| Conditional | ${audit.conditionalTotal.toLocaleString()} | ${formatAiu(
        nanoAiuToAiu(credit.conditionalNanoAiu)
      )} ≈ ${formatUsd(
        nanoAiuToUsd(credit.conditionalNanoAiu)
      )} | per agent/chat-mode invocation |`,
      `| On-demand | ${audit.onDemandTotal.toLocaleString()} | ${formatAiu(
        nanoAiuToAiu(credit.onDemandNanoAiu)
      )} ≈ ${formatUsd(
        nanoAiuToUsd(credit.onDemandNanoAiu)
      )} | per skill/prompt trigger |`,
      `| **Total** | **${totalTokens.toLocaleString()}** | ${formatAiu(
        nanoAiuToAiu(credit.totalNanoAiu)
      )} ≈ ${formatUsd(nanoAiuToUsd(credit.totalNanoAiu))} | — |`
    );
  } else {
    lines.push(
      `| Scope | Tokens | Billing cadence |`,
      `|---|---:|---|`,
      `| **Always-on** | ${audit.alwaysOnTotal.toLocaleString()} | **every request** |`,
      `| Conditional | ${audit.conditionalTotal.toLocaleString()} | per agent/chat-mode invocation |`,
      `| On-demand | ${audit.onDemandTotal.toLocaleString()} | per skill/prompt trigger |`,
      `| **Total** | **${totalTokens.toLocaleString()}** | — |`
    );
  }
  return lines;
}

/**
 * The headline number: how much the always-on overhead costs per month at
 * the configured request volume. Only rendered when credit data exists.
 */
function renderAlwaysOnProjection(
  audit: AuditResult,
  opts: OptimizationReportOptions
): string[] {
  const credit = audit.credit;
  if (!credit || credit.alwaysOnNanoAiu <= 0) {
    return [];
  }
  const monthlyAiu = projectMonthlyAiu(
    credit.alwaysOnNanoAiu,
    opts.requestsPerDay
  );
  const monthlyUsd = projectMonthlyUsd(
    credit.alwaysOnNanoAiu,
    opts.requestsPerDay
  );
  return [
    `> 💸 **Always-on overhead**: at ${opts.requestsPerDay.toLocaleString()} requests/day, the ${audit.alwaysOnTotal.toLocaleString()}-token always-on tax costs about **${formatAiu(
      monthlyAiu
    )} ≈ ${formatUsd(
      monthlyUsd
    )} / month** — paid before you write a single line of a prompt.`,
  ];
}

/**
 * Savings opportunities table — findings sorted by est_tokens_saved desc,
 * then severity. Includes the total potential savings.
 */
function renderSavings(findings: Finding[]): string[] {
  const lines: string[] = [];
  const ranked = [...findings].sort((a, b) => {
    if (b.est_tokens_saved !== a.est_tokens_saved) {
      return b.est_tokens_saved - a.est_tokens_saved;
    }
    return severityRank(a.severity) - severityRank(b.severity);
  });

  const totalSaveable = ranked.reduce((sum, f) => sum + f.est_tokens_saved, 0);

  if (ranked.length === 0) {
    lines.push(`No anti-patterns detected — nothing to trim. 🎉`);
    return lines;
  }

  lines.push(
    `**Total estimated savings: ~${totalSaveable.toLocaleString()} tokens** across ${ranked.length} finding(s).`,
    ``,
    `| Severity | Finding | Est. tokens saved | File |`,
    `|---|---|---:|---|`
  );
  for (const f of ranked) {
    const saved =
      f.est_tokens_saved > 0
        ? `~${f.est_tokens_saved.toLocaleString()}`
        : "—";
    lines.push(
      `| ${severityBadge(f.severity)} | ${f.id} | ${saved} | \`${f.location}\` |`
    );
  }
  lines.push(``, `### Recommended actions`, ``);
  for (const f of ranked) {
    lines.push(
      `- **${f.id}** (\`${f.location}\`): ${f.recommendation}` +
        (f.est_tokens_saved > 0
          ? ` _(~${f.est_tokens_saved.toLocaleString()} tokens)_`
          : "")
    );
  }
  return lines;
}

export function renderOptimizationReport(
  audit: AuditResult,
  findings: Finding[],
  opts: OptimizationReportOptions
): string {
  const lines: string[] = [];

  lines.push(
    `# 🪙 Token Optimization Report`,
    ``,
    `> Generated by tokopt-vscode · ${opts.generatedAt}`,
    `> Workspace: \`${audit.root}\` · encoding \`${audit.encoding}\``,
    audit.credit
      ? `> Cost model: \`${audit.credit.model}\` (1 AIU = $0.01; ${audit.credit.nanoAiuPerInputToken.toLocaleString()} nano-AIU/input-token)`
      : `> Cost model: _none_ — set \`tokopt.creditModel\` to project AI Credit / USD cost.`,
    ``,
    `## 1. Where your tokens go`,
    ``
  );
  lines.push(...renderCostSummary(audit));
  lines.push(``);
  lines.push(...renderAlwaysOnProjection(audit, opts));
  lines.push(``);

  lines.push(`## 2. What to optimize`, ``);
  lines.push(...renderSavings(findings));
  lines.push(``);

  lines.push(
    `## 3. How to act`,
    ``,
    `- Open any flagged file: the **Problems panel** shows the finding; **Cmd+.** offers a Quick Fix (Apply slim / Preview / Suppress).`,
    `- **Always-on files** (\`copilot-instructions.md\`, \`AGENTS.md\`) are the highest leverage — every trimmed token is paid back on _every_ request.`,
    `- Re-run **tokopt: Show Optimization Report** after edits to watch the numbers drop.`,
    ``,
    `---`,
    audit.credit
      ? `_Cost projection is an estimate from an empirical Copilot-CLI rate card; actual billing varies with cache hits, output, and reasoning tokens. Monthly figures assume ${opts.requestsPerDay.toLocaleString()} requests/day._`
      : `_Tip: set \`tokopt.creditModel\` (e.g. \`gpt-5.5\`) to see this report in AI Credits and dollars._`
  );

  return lines.join("\n");
}
