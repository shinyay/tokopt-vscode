import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { SUPPORTED_FORMAT_VERSION } from "./tokopt.js";
import { warnBinaryMissing, warnVersionMismatch } from "./warnings.js";

const execFileAsync = promisify(execFile);

/**
 * One file row from `tokopt audit --format=json`. Schema is the same
 * stable v1 envelope as `tokopt count` (see SUPPORTED_FORMAT_VERSION).
 *
 * `scope` values from the Go CLI are exactly the three CustomizationKind
 * variants in src/customizationFiles.ts — we treat the CLI as the
 * canonical classifier and never re-classify in TypeScript (otherwise
 * scope semantics would drift between the two implementations).
 */
export interface AuditFile {
  path: string;
  category: string;
  scope: "always-on" | "conditional" | "on-demand";
  tokens: number;
  bytes: number;
  note?: string;
}

export interface AuditResult {
  root: string;
  encoding: string;
  files: AuditFile[];
  alwaysOnTotal: number;
  conditionalTotal: number;
  onDemandTotal: number;
  /** Raw stdout, preserved so the "Show in audit panel" command can dump
   * the exact JSON payload that produced the current tree state. */
  raw: string;
}

export type AuditOutcome =
  | { kind: "ok"; result: AuditResult }
  | { kind: "binary-missing" }
  | { kind: "version-mismatch"; got: unknown }
  | { kind: "error"; message: string };

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

/**
 * Run `tokopt audit --format=json <workspaceRoot>` and return a
 * structured outcome. Never throws.
 *
 * Strict `format_version === "v1"` dispatch — anything else is
 * version-mismatch, so a future v2 schema can't silently corrupt the
 * tree. Same pattern as runTokoptCount / runTokoptDetect.
 *
 * Per-file validation drops malformed rows rather than failing the
 * whole audit: a single odd entry from a future CLI extension
 * shouldn't blank out the tree.
 */
export async function runTokoptAudit(
  binaryPath: string,
  workspaceRoot: string,
  log: vscode.OutputChannel
): Promise<AuditOutcome> {
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ["audit", "--format=json", workspaceRoot],
      // Audit walks the workspace; allow more buffer/time than `count`
      // but still cap so a runaway scan can't hang the extension host.
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (parseErr) {
      const msg = `tokopt audit emitted non-JSON output: ${String(parseErr)}`;
      log.appendLine(msg);
      return { kind: "error", message: msg };
    }

    if (!parsed || typeof parsed !== "object") {
      const msg = `tokopt audit returned non-object payload: ${stdout.slice(
        0,
        200
      )}`;
      log.appendLine(msg);
      return { kind: "error", message: msg };
    }

    const payload = parsed as Record<string, unknown>;
    const version = payload.format_version;
    if (version !== SUPPORTED_FORMAT_VERSION) {
      log.appendLine(
        `tokopt audit format_version mismatch: extension supports "${SUPPORTED_FORMAT_VERSION}", got ${JSON.stringify(version)}`
      );
      warnVersionMismatch(SUPPORTED_FORMAT_VERSION, version);
      return { kind: "version-mismatch", got: version };
    }

    const root = typeof payload.root === "string" ? payload.root : workspaceRoot;
    const encoding =
      typeof payload.encoding === "string" ? payload.encoding : "o200k_base";

    const rawFiles = payload.files;
    const files: AuditFile[] = [];
    if (Array.isArray(rawFiles)) {
      for (const entry of rawFiles) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const scope = e.scope;
        if (
          scope !== "always-on" &&
          scope !== "conditional" &&
          scope !== "on-demand"
        ) {
          // Future scope we don't know how to render — skip silently
          // rather than blanking the tree.
          continue;
        }
        if (
          typeof e.path !== "string" ||
          typeof e.category !== "string" ||
          typeof e.tokens !== "number" ||
          typeof e.bytes !== "number"
        ) {
          continue;
        }
        files.push({
          path: e.path,
          category: e.category,
          scope,
          tokens: e.tokens,
          bytes: e.bytes,
          note: typeof e.note === "string" ? e.note : undefined,
        });
      }
    }

    const alwaysOnTotal =
      typeof payload.always_on_total === "number" ? payload.always_on_total : 0;
    const conditionalTotal =
      typeof payload.conditional_total === "number"
        ? payload.conditional_total
        : 0;
    const onDemandTotal =
      typeof payload.on_demand_total === "number" ? payload.on_demand_total : 0;

    return {
      kind: "ok",
      result: {
        root,
        encoding,
        files,
        alwaysOnTotal,
        conditionalTotal,
        onDemandTotal,
        raw: stdout,
      },
    };
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      log.appendLine(`tokopt binary not found at "${binaryPath}"`);
      warnBinaryMissing();
      return { kind: "binary-missing" };
    }
    const msg = `tokopt audit failed: ${String(err)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }
}
