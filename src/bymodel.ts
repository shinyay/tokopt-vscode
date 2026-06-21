import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as vscode from "vscode";
import { creditRatesArgs } from "./credit.js";

const execFileAsync = promisify(execFile);

/**
 * One model's projected cost for the audited repo, from
 * `tokopt report --by-model --format=json`. Mirrors the CLI's per-model row
 * (see internal/report/bymodel.go). The CLI is the canonical source of the
 * projection + ordering; we never recompute it here.
 */
export interface ModelCostRow {
  name: string;
  basis: string;
  nanoAiuPerInputToken: number;
  alwaysOnNanoAiu: number;
  totalNanoAiu: number;
}

/**
 * Parse `tokopt report --by-model --format=json` stdout into rows. PURE and
 * vscode-free so it can be unit-tested without spawning a process. Returns []
 * on malformed input or an unexpected shape (older binaries that don't know
 * the command emit an error to stderr and non-JSON / nothing to stdout).
 *
 * The CLI already sorts models cheapest-first; we preserve that order.
 */
export function parseByModelJson(stdout: string): ModelCostRow[] {
  try {
    const o = JSON.parse(stdout) as {
      models?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(o?.models)) {
      return [];
    }
    const rows: ModelCostRow[] = [];
    for (const m of o.models) {
      if (typeof m?.name !== "string") {
        continue;
      }
      // A row without a usable always-on cost is malformed (or a schema we
      // don't understand) — skip it rather than render it as a fake 0-cost
      // (which would sort cheapest and mislead).
      const alwaysOn = m.always_on_nano_aiu;
      if (typeof alwaysOn !== "number" || !Number.isFinite(alwaysOn) || alwaysOn < 0) {
        continue;
      }
      rows.push({
        name: m.name,
        basis: typeof m.basis === "string" ? m.basis : "",
        nanoAiuPerInputToken: num(m.nano_aiu_per_input_token),
        alwaysOnNanoAiu: alwaysOn,
        totalNanoAiu: num(m.total_nano_aiu),
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Run `tokopt report --by-model --format=json` for the workspace and return
 * the per-model cost ranking. Best-effort: on any failure (binary missing, an
 * older binary without the `report --by-model` command, non-zero exit, or
 * non-JSON output) it logs and returns [], so the dashboard simply omits the
 * comparison section instead of breaking.
 *
 * Requires tokopt CLI >= 0.10.0. See COMPATIBILITY.md.
 */
export async function runReportByModel(
  binaryPath: string,
  workspaceRoot: string,
  log: vscode.OutputChannel,
  creditRatesPath?: string
): Promise<ModelCostRow[]> {
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      [
        "report",
        "--by-model",
        "--format=json",
        ...creditRatesArgs(creditRatesPath),
        workspaceRoot,
      ],
      // Optional, fast-failing: an older CLI without `report --by-model`
      // rejects immediately; a healthy run is sub-second. Keep the timeout
      // tight so this optional section never holds the dashboard for long.
      { timeout: 8_000, maxBuffer: 4 * 1024 * 1024 }
    );
    const rows = parseByModelJson(stdout);
    if (rows.length === 0) {
      log.appendLine(
        "tokopt report --by-model returned no rows; omitting model comparison"
      );
    }
    return rows;
  } catch (e) {
    log.appendLine(
      `tokopt report --by-model unavailable (${String(e)}); omitting model comparison (needs CLI >= 0.10.0)`
    );
    return [];
  }
}
