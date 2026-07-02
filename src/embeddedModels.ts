import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as vscode from "vscode";

const execFileAsync = promisify(execFile);

/**
 * Discovers, from the installed tokopt binary, which models its embedded rate
 * card can project cost for. This keeps the model picker in sync with whatever
 * binary the user has on PATH instead of hardcoding a list that drifts as the
 * embedded card grows.
 *
 * The result is cached at module scope and read synchronously by
 * {@link resolveCredit} (via {@link getEmbeddedModels}). The cache is
 * (re)populated by {@link refreshEmbeddedModels} on activation and whenever
 * `tokopt.binaryPath` changes. Until the first successful fetch — or against an
 * older binary without `tokopt models` — callers fall back to the hardcoded
 * CREDIT_MODELS list, so cost projection degrades gracefully rather than
 * breaking.
 */
let cache: string[] | undefined;
let detailCache: EmbeddedModel[] | undefined;

/**
 * A model the embedded rate card can project cost for, paired with the
 * trustworthiness of its rate: `empirical` (calibrated/measured) vs `catalog`
 * (list-price upper bound). `basis` is "" when the binary doesn't report one.
 */
export interface EmbeddedModel {
  name: string;
  basis: string;
}

/**
 * Parse `tokopt models --format json` stdout into name+basis pairs. PURE and
 * vscode-free so it can be unit-tested without spawning a process. Entries
 * without a string `name` are dropped; a missing/non-string `basis` becomes "".
 * Returns [] on malformed input.
 */
export function parseModelsJsonDetailed(stdout: string): EmbeddedModel[] {
  try {
    const o = JSON.parse(stdout) as {
      models?: Array<{ name?: unknown; basis?: unknown }>;
    };
    if (Array.isArray(o?.models)) {
      return o.models
        .filter((m): m is { name: string; basis?: unknown } =>
          typeof m?.name === "string" && m.name !== ""
        )
        .map((m) => ({
          name: m.name,
          basis: typeof m.basis === "string" ? m.basis : "",
        }));
    }
  } catch {
    /* ignore — fall through to [] */
  }
  return [];
}

/**
 * Parse `tokopt models --format json` stdout into model names. Kept for
 * backward compatibility with callers that only need names; derived from
 * {@link parseModelsJsonDetailed} so the extraction rules stay in one place.
 */
export function parseModelsJson(stdout: string): string[] {
  return parseModelsJsonDetailed(stdout).map((m) => m.name);
}

/**
 * Build a name→basis map, restricted to `available` and dropping empty-basis
 * entries. PURE. Lets a caller annotate exactly the models a picker offers
 * (e.g. an external rate card narrows `available` to a subset) without leaking
 * basis for models that aren't selectable. Empty inputs yield {}.
 */
export function basisMapFromModels(
  detailed: readonly EmbeddedModel[] | undefined,
  available: readonly string[]
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!detailed || detailed.length === 0) {
    return map;
  }
  const allowed = new Set(available);
  for (const m of detailed) {
    if (m.basis && allowed.has(m.name)) {
      map[m.name] = m.basis;
    }
  }
  return map;
}

/** Returns the cached embedded model list, or undefined if not yet fetched. */
export function getEmbeddedModels(): string[] | undefined {
  return cache;
}

/**
 * Returns the cached embedded models with their `basis`, or undefined if not
 * yet fetched. Used to annotate the cost-model picker with a measured/est.
 * indicator.
 */
export function getEmbeddedModelsDetailed(): EmbeddedModel[] | undefined {
  return detailCache;
}

/** Test-only: reset the module cache so cases don't leak into each other. */
export function resetEmbeddedModelsCache(): void {
  cache = undefined;
  detailCache = undefined;
}

/**
 * Run `tokopt models --format json`, cache the model names, and return them.
 * Best-effort: on any failure (binary missing, old binary without the
 * subcommand, non-JSON output) the cache is left untouched and [] is returned,
 * so callers keep using the hardcoded fallback.
 */
export async function refreshEmbeddedModels(
  binaryPath: string,
  log?: vscode.OutputChannel
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ["models", "--format=json"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 }
    );
    const detailed = parseModelsJsonDetailed(stdout);
    if (detailed.length > 0) {
      detailCache = detailed;
      cache = detailed.map((m) => m.name);
      return cache;
    }
    log?.appendLine(
      "tokopt models returned no models; using built-in model list"
    );
  } catch (e) {
    log?.appendLine(
      `tokopt models unavailable (${String(e)}); using built-in model list`
    );
  }
  return [];
}
