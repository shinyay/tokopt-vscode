import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { creditModelArgs, creditRatesArgs } from "./credit.js";
import { SUPPORTED_FORMAT_VERSION } from "./tokopt.js";

const execFileAsync = promisify(execFile);

/**
 * One outlier record from `tokopt tail --format=json`.
 */
export interface TailRecord {
  tokens: number;
  raw?: Record<string, unknown>;
}

export interface TailResult {
  count: number;
  sum: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  topSharePct: number;
  topShareLabel: string;
  topRecords: TailRecord[];
  heavyTailHint?: string;
}

export type TailOutcome =
  | { kind: "ok"; result: TailResult }
  | { kind: "binary-missing" }
  | { kind: "version-mismatch"; got: unknown }
  | { kind: "error"; message: string };

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

/**
 * Run `tokopt tail --input <file> --column <col> --format=json` and parse
 * the v1 envelope. Never throws. Keeps the percentile numbers identical
 * to the CLI (this view is literally the `tokopt tail` analysis).
 */
export async function runTokoptTail(
  binaryPath: string,
  inputPath: string,
  opts: { column?: string; top?: number; creditModel?: string; creditRatesPath?: string },
  log: vscode.OutputChannel
): Promise<TailOutcome> {
  try {
    const args = [
      "tail",
      "--input",
      inputPath,
      "--column",
      opts.column ?? "tokens",
      "--top",
      String(opts.top ?? 10),
      "--format=json",
      ...creditModelArgs(opts.creditModel),
      ...creditRatesArgs(opts.creditRatesPath),
    ];
    const { stdout } = await execFileAsync(binaryPath, args, {
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      const msg = `tokopt tail emitted non-JSON output: ${String(e)}`;
      log.appendLine(msg);
      return { kind: "error", message: msg };
    }
    if (!parsed || typeof parsed !== "object") {
      return { kind: "error", message: "tokopt tail returned non-object payload" };
    }
    const p = parsed as Record<string, unknown>;
    if (p.format_version !== SUPPORTED_FORMAT_VERSION) {
      log.appendLine(
        `tokopt tail format_version mismatch: got ${JSON.stringify(p.format_version)}`
      );
      return { kind: "version-mismatch", got: p.format_version };
    }
    const num = (v: unknown): number => (typeof v === "number" ? v : 0);
    const records: TailRecord[] = [];
    if (Array.isArray(p.top_records)) {
      for (const r of p.top_records) {
        if (!r || typeof r !== "object") continue;
        const rr = r as Record<string, unknown>;
        const rec: TailRecord = { tokens: num(rr.tokens) };
        if (rr.raw && typeof rr.raw === "object") {
          rec.raw = rr.raw as Record<string, unknown>;
        }
        records.push(rec);
      }
    }

    return {
      kind: "ok",
      result: {
        count: num(p.count),
        sum: num(p.sum),
        mean: num(p.mean),
        p50: num(p.p50),
        p90: num(p.p90),
        p95: num(p.p95),
        p99: num(p.p99),
        max: num(p.max),
        topSharePct: num(p.top_share_pct),
        topShareLabel: typeof p.top_share_label === "string" ? p.top_share_label : "top 1%",
        topRecords: records,
        heavyTailHint: typeof p.heavy_tail_hint === "string" ? p.heavy_tail_hint : undefined,
      },
    };
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      log.appendLine(`tokopt binary not found at "${binaryPath}"`);
      return { kind: "binary-missing" };
    }
    const msg = `tokopt tail failed: ${String(err)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }
}
