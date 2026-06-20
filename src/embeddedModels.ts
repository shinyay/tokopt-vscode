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

/**
 * Parse `tokopt models --format json` stdout into model names. PURE and
 * vscode-free so it can be unit-tested without spawning a process. Returns []
 * on malformed input.
 */
export function parseModelsJson(stdout: string): string[] {
  try {
    const o = JSON.parse(stdout) as { models?: Array<{ name?: unknown }> };
    if (Array.isArray(o?.models)) {
      return o.models
        .map((m) => (typeof m?.name === "string" ? m.name : undefined))
        .filter((n): n is string => Boolean(n));
    }
  } catch {
    /* ignore — fall through to [] */
  }
  return [];
}

/** Returns the cached embedded model list, or undefined if not yet fetched. */
export function getEmbeddedModels(): string[] | undefined {
  return cache;
}

/** Test-only: reset the module cache so cases don't leak into each other. */
export function resetEmbeddedModelsCache(): void {
  cache = undefined;
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
    const names = parseModelsJson(stdout);
    if (names.length > 0) {
      cache = names;
      return names;
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
