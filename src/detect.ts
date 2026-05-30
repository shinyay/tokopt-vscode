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
  /** Path relative to the detect root that was passed on the CLI. */
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
 * Run `tokopt detect --format=json <rootDir>` and return the findings.
 *
 * `tokopt detect` is **directory-scoped** — it walks a workspace and
 * emits findings keyed by `location` (path relative to rootDir). The
 * diagnostic manager fans those findings out to per-URI collections.
 *
 * Never throws. Strict `format_version === "v1"` dispatch so a future
 * schema bump (v2) disables diagnostics with a one-time toast instead
 * of corrupting the Problems panel.
 */
export async function runTokoptDetect(
  binaryPath: string,
  rootDir: string,
  log: vscode.OutputChannel
): Promise<DetectOutcome> {
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ["detect", "--format=json", rootDir],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
    );

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
      warnVersionMismatch(SUPPORTED_FORMAT_VERSION, version);
      return { kind: "version-mismatch", got: version };
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
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      log.appendLine(`tokopt binary not found at "${binaryPath}"`);
      warnBinaryMissing();
      return { kind: "binary-missing" };
    }
    const msg = `tokopt detect failed: ${String(err)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }
}
