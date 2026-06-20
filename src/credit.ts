import type { CustomizationKind } from "./customizationFiles.js";

/**
 * Cost projection helpers — convert raw token counts into nano-AIU,
 * AI Credits (AIU) and USD using the `tokopt --credit-model` rate card.
 *
 * Conversion constants (canonical, see
 * shinyay/getting-started-with-token-optimization
 * website/docs/foundations/glossary.en.md):
 *   - 1 AIU       = 1e9 nano-AIU
 *   - 1 AIU       = $0.01 USD
 *   - therefore $ = nano_aiu / 1e11
 *
 * This module is intentionally PURE: it imports no `vscode` API and only
 * a single type from customizationFiles.ts. That keeps it unit-testable
 * with `node --test` and prevents the test bundle from pulling in the
 * VS Code shim.
 */

/** 1 AIU = 1e9 nano-AIU. */
export const NANO_PER_AIU = 1e9;

/** 1 AIU = $0.01 USD. */
export const USD_PER_AIU = 0.01;

/** Models supported by the embedded tokopt rate card (v0.6.x). */
export const CREDIT_MODELS = [
  "gpt-5.5",
  "claude-opus-4.7-1m-internal",
  "gemini-3.1-pro-preview",
  "mai-code-1-flash-internal",
] as const;

export type CreditModel = (typeof CREDIT_MODELS)[number];

/** Sentinel meaning "do not project costs". */
export const CREDIT_MODEL_NONE = "none";

/** nano-AIU → AIU. */
export function nanoAiuToAiu(nano: number): number {
  return nano / NANO_PER_AIU;
}

/** AIU → USD. */
export function aiuToUsd(aiu: number): number {
  return aiu * USD_PER_AIU;
}

/** nano-AIU → USD (1 AIU = 1e9 nano-AIU = $0.01 ⇒ $ = nano / 1e11). */
export function nanoAiuToUsd(nano: number): number {
  return aiuToUsd(nanoAiuToAiu(nano));
}

/**
 * Format an AIU amount for inline display. Uses 3 significant decimals
 * for small values so per-request costs (e.g. 0.197) stay readable, and
 * thousands separators for large monthly totals.
 */
export function formatAiu(aiu: number): string {
  if (aiu === 0) {
    return "0 AIU";
  }
  if (aiu < 1) {
    return `${aiu.toFixed(3)} AIU`;
  }
  if (aiu < 100) {
    return `${aiu.toFixed(2)} AIU`;
  }
  return `${Math.round(aiu).toLocaleString()} AIU`;
}

/** Format a USD amount. Sub-cent values keep 4 decimals; larger ones 2. */
export function formatUsd(usd: number): string {
  if (usd === 0) {
    return "$0";
  }
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  if (usd < 100) {
    return `$${usd.toFixed(2)}`;
  }
  return `$${Math.round(usd).toLocaleString()}`;
}

/**
 * Resolve the `--credit-model` CLI args for a configured model value.
 * Returns [] when projection is disabled (undefined / empty / "none"),
 * so existing call sites stay byte-for-byte identical when the feature
 * is off (backward compatibility).
 */
export function creditModelArgs(model: string | undefined | null): string[] {
  if (!model || model === CREDIT_MODEL_NONE) {
    return [];
  }
  return ["--credit-model", model];
}

/**
 * Resolve the `--credit-rates` CLI args for an external rate-card path.
 * Returns [] when no path is set. The CLI only consults this flag when
 * `--credit-model` is also passed.
 */
export function creditRatesArgs(ratesPath: string | undefined | null): string[] {
  if (!ratesPath) {
    return [];
  }
  return ["--credit-rates", ratesPath];
}

/**
 * Parse the `models` object of a tokopt rate-card.json into its model
 * names. Returns [] on malformed input. PURE — unit-testable; the fs read
 * happens in the caller (creditConfig.ts) so this stays vscode/fs-free.
 */
export function parseRateCardModels(jsonContent: string): string[] {
  try {
    const o = JSON.parse(jsonContent) as Record<string, unknown>;
    const models = o?.models;
    if (models && typeof models === "object") {
      return Object.keys(models as Record<string, unknown>);
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** True when a configured model value should trigger cost projection. */
export function isCreditEnabled(model: string | undefined | null): boolean {
  return creditModelArgs(model).length > 0;
}

/** Monthly AIU for a per-request nano-AIU figure (always-on only). */
export function projectMonthlyAiu(
  nanoAiuPerRequest: number,
  requestsPerDay: number
): number {
  return nanoAiuToAiu(nanoAiuPerRequest) * requestsPerDay * 30;
}

/** Monthly USD for a per-request nano-AIU figure (always-on only). */
export function projectMonthlyUsd(
  nanoAiuPerRequest: number,
  requestsPerDay: number
): number {
  return aiuToUsd(projectMonthlyAiu(nanoAiuPerRequest, requestsPerDay));
}

/**
 * Build the cost suffix appended to a CodeLens / status line.
 *
 * The phrasing is scope-aware because the billing cadence differs:
 *   - always-on  → paid on EVERY request, so we show per-request cost
 *                  PLUS a monthly projection (the headline number that
 *                  makes always-on bloat tangible).
 *   - conditional → paid only when the agent/chat-mode is invoked.
 *   - on-demand   → paid only when the skill/prompt is triggered.
 *
 * Returns "" when nanoAiu is non-positive (nothing meaningful to show).
 */
export function formatCostSuffix(opts: {
  nanoAiu: number;
  kind: CustomizationKind;
  requestsPerDay: number;
}): string {
  const { nanoAiu, kind, requestsPerDay } = opts;
  if (!(nanoAiu > 0)) {
    return "";
  }
  const aiu = nanoAiuToAiu(nanoAiu);
  if (kind === "always-on") {
    const monthlyUsd = projectMonthlyUsd(nanoAiu, requestsPerDay);
    return `≈ ${formatAiu(aiu)}/req · ~${formatUsd(monthlyUsd)}/mo`;
  }
  if (kind === "conditional") {
    return `≈ ${formatAiu(aiu)}/invocation`;
  }
  return `≈ ${formatAiu(aiu)}/use`;
}
