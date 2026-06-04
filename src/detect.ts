import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
  SUPPORTED_FORMAT_VERSION as TOKOPT_SUPPORTED_FORMAT_VERSION,
} from "./tokopt.js";
import { warnBinaryMissing, warnVersionMismatch } from "./warnings.js";

const execFileAsync = promisify(execFile);

/** Re-export so detect.ts is the single import for diagnostic callers. */
export const SUPPORTED_FORMAT_VERSION = TOKOPT_SUPPORTED_FORMAT_VERSION;

/** Severity vocabulary emitted by tokopt detect.
 *
 * Mirrors `antipatterns.Severity` in
 * shinyay/getting-started-with-token-optimization
 * (internal/antipatterns/antipatterns.go).
 */
export type FindingSeverity = "info" | "warn" | "high" | "critical";

export interface Finding {
  id: string;
  title: string;
  severity: FindingSeverity;
  confidence: "measured" | "heuristic";
  /** Path relative to the detector's inferred root.
   *
   * - Directory mode (CLI arg is a dir): relative to the CLI-passed root.
   * - File mode (CLI arg is a file, tokopt v0.5.1+): relative to the root
   *   inferred from the file's location (e.g., parent of `.github/`).
   */
  location: string;
  evidence?: string;
  recommendation: string;
  est_tokens_saved: number;
  estimate_basis?: string;
  chapter_ref?: string;
}

export type DetectOutcome =
  | { kind: "ok"; findings: Finding[] }
  | { kind: "binary-missing" }
  | { kind: "version-mismatch"; got: unknown }
  | { kind: "error"; message: string };

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

function validateFinding(raw: unknown): Finding | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.title !== "string" ||
    typeof r.severity !== "string" ||
    typeof r.confidence !== "string" ||
    typeof r.location !== "string" ||
    typeof r.recommendation !== "string" ||
    typeof r.est_tokens_saved !== "number"
  ) {
    return null;
  }
  const sev = r.severity;
  if (sev !== "info" && sev !== "warn" && sev !== "high" && sev !== "critical") {
    return null;
  }
  const conf = r.confidence;
  if (conf !== "measured" && conf !== "heuristic") {
    return null;
  }
  return {
    id: r.id,
    title: r.title,
    severity: sev,
    confidence: conf,
    location: r.location,
    evidence: typeof r.evidence === "string" ? r.evidence : undefined,
    recommendation: r.recommendation,
    est_tokens_saved: r.est_tokens_saved,
    estimate_basis:
      typeof r.estimate_basis === "string" ? r.estimate_basis : undefined,
    chapter_ref:
      typeof r.chapter_ref === "string" ? r.chapter_ref : undefined,
  };
}

/**
 * Parse a `tokopt detect --format=json` payload from raw stdout.
 *
 * Factored out so callers can hand off both successful invocations AND
 * captured stdout from non-zero-exit invocations. `tokopt` emits its v1
 * error envelope (`{format_version: "v1", error: {...}}`) to stdout
 * while exiting non-zero, so `execFile` rejects with `err.stdout`
 * populated — re-using the same parser keeps semantics consistent.
 *
 * Does NOT raise the version-mismatch toast; that's the caller's job
 * (so we don't double-warn from the catch path).
 */
function parseDetectPayload(
  stdout: string,
  log: vscode.OutputChannel
): DetectOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (parseErr) {
    const msg = `tokopt detect emitted non-JSON output: ${String(parseErr)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }

  if (!parsed || typeof parsed !== "object") {
    const msg = `tokopt detect returned non-object payload: ${stdout.slice(0, 200)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }

  const payload = parsed as Record<string, unknown>;
  const version = payload.format_version;
  if (version !== SUPPORTED_FORMAT_VERSION) {
    log.appendLine(
      `tokopt detect format_version mismatch: extension supports "${SUPPORTED_FORMAT_VERSION}", got ${JSON.stringify(version)}`
    );
    return { kind: "version-mismatch", got: version };
  }

  // tokopt v1 error envelope: { format_version: "v1", error: { code, message } }.
  // v0.4.0 returns this for any file argument (FILE_NOT_FOUND); v0.5.1+ returns
  // it for unreadable paths. Surface a clean error rather than a misleading
  // "findings: undefined → []" success.
  if (payload.error && typeof payload.error === "object") {
    const errObj = payload.error as Record<string, unknown>;
    const msg =
      typeof errObj.message === "string"
        ? errObj.message
        : typeof errObj.code === "string"
          ? errObj.code
          : "tokopt detect returned an error envelope";
    log.appendLine(`tokopt detect error envelope: ${msg}`);
    return { kind: "error", message: msg };
  }

  // `findings` is null when the detector ran cleanly and found nothing —
  // a normal success case, not an error.
  const rawFindings = payload.findings;
  if (rawFindings === null || rawFindings === undefined) {
    return { kind: "ok", findings: [] };
  }
  if (!Array.isArray(rawFindings)) {
    const msg = `tokopt detect v1 payload "findings" is not an array: ${stdout.slice(0, 200)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }

  const findings: Finding[] = [];
  for (const item of rawFindings) {
    const f = validateFinding(item);
    if (f) {
      findings.push(f);
    } else {
      log.appendLine(
        `tokopt detect: skipping malformed finding: ${JSON.stringify(item).slice(0, 200)}`
      );
    }
  }
  return { kind: "ok", findings };
}

/**
 * Run `tokopt detect --format=json <target>` and return the findings.
 *
 * `target` may be either a directory (workspace-scoped scan, the
 * historical mode) or a single file (per-file scan with binary-side
 * greppy narrowing, supported by `tokopt v0.5.1+`). Older binaries
 * handed a file emit a v1 `FILE_NOT_FOUND` error envelope to stdout
 * and exit non-zero; we parse that uniformly with the success path so
 * the caller sees `{kind: "error"}` with a useful message.
 *
 * Never throws. Strict `format_version === "v1"` dispatch so a future
 * schema bump (v2) disables diagnostics with a one-time toast instead
 * of corrupting the Problems panel.
 */
export async function runTokoptDetect(
  binaryPath: string,
  target: string,
  log: vscode.OutputChannel
): Promise<DetectOutcome> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      binaryPath,
      ["detect", "--format=json", target],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
    );
    stdout = result.stdout;
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      log.appendLine(`tokopt binary not found at "${binaryPath}"`);
      warnBinaryMissing();
      return { kind: "binary-missing" };
    }
    // tokopt emits structured JSON to stdout even when it exits non-zero
    // (e.g. v0.4.0 returning a FILE_NOT_FOUND envelope when handed a file).
    // execFile rejects on non-zero exit but exposes captured stdout via
    // err.stdout — try to parse it as a v1 payload before falling back
    // to a generic error string.
    const errStdout = (err as { stdout?: unknown }).stdout;
    if (typeof errStdout === "string" && errStdout.length > 0) {
      const outcome = parseDetectPayload(errStdout, log);
      if (outcome.kind === "version-mismatch") {
        warnVersionMismatch(SUPPORTED_FORMAT_VERSION, outcome.got);
      }
      return outcome;
    }
    const msg = `tokopt detect failed: ${String(err)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }

  const outcome = parseDetectPayload(stdout, log);
  if (outcome.kind === "version-mismatch") {
    warnVersionMismatch(SUPPORTED_FORMAT_VERSION, outcome.got);
  }
  return outcome;
}
