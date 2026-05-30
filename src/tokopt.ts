import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

/**
 * Schema version that this extension knows how to read. The tokopt CLI
 * emits `format_version` at the top of every --format=json payload
 * (success and error). If we see anything other than this value, we
 * fail closed: log + skip + show a one-time warning, never crash.
 *
 * See: tools/tokopt/docs/cli-json-schema.md in shinyay/getting-started-with-token-optimization
 */
export const SUPPORTED_FORMAT_VERSION = "v1";

export interface CountResult {
  path: string;
  encoding: string;
  tokens: number;
  bytes: number;
}

export type CountOutcome =
  | { kind: "ok"; result: CountResult }
  | { kind: "binary-missing" }
  | { kind: "version-mismatch"; got: unknown }
  | { kind: "error"; message: string };

let warnedBinaryMissing = false;
let warnedVersionMismatch = false;

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

/**
 * Run `tokopt count --format=json <filePath>` and return a structured
 * outcome. Never throws.
 *
 * Dispatches strictly on `format_version === SUPPORTED_FORMAT_VERSION`
 * — anything else (including missing) is treated as a version mismatch
 * so future v2 schemas don't silently corrupt the UI.
 */
export async function runTokoptCount(
  binaryPath: string,
  filePath: string,
  log: vscode.OutputChannel
): Promise<CountOutcome> {
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ["count", "--format=json", filePath],
      { timeout: 10_000, maxBuffer: 1024 * 1024 }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (parseErr) {
      const msg = `tokopt count emitted non-JSON output: ${String(parseErr)}`;
      log.appendLine(msg);
      return { kind: "error", message: msg };
    }

    if (!parsed || typeof parsed !== "object") {
      const msg = `tokopt count returned non-object payload: ${stdout.slice(0, 200)}`;
      log.appendLine(msg);
      return { kind: "error", message: msg };
    }

    const payload = parsed as Record<string, unknown>;
    const version = payload.format_version;
    if (version !== SUPPORTED_FORMAT_VERSION) {
      log.appendLine(
        `tokopt format_version mismatch: extension supports "${SUPPORTED_FORMAT_VERSION}", got ${JSON.stringify(version)}`
      );
      if (!warnedVersionMismatch) {
        warnedVersionMismatch = true;
        vscode.window.showWarningMessage(
          `tokopt CodeLens disabled: tokopt CLI emits format_version=${JSON.stringify(version)} but this extension supports "${SUPPORTED_FORMAT_VERSION}". Update the extension to match.`
        );
      }
      return { kind: "version-mismatch", got: version };
    }

    if (
      typeof payload.tokens !== "number" ||
      typeof payload.bytes !== "number" ||
      typeof payload.path !== "string" ||
      typeof payload.encoding !== "string"
    ) {
      const msg = `tokopt v1 payload missing expected fields: ${stdout.slice(0, 200)}`;
      log.appendLine(msg);
      return { kind: "error", message: msg };
    }

    return {
      kind: "ok",
      result: {
        path: payload.path,
        encoding: payload.encoding,
        tokens: payload.tokens,
        bytes: payload.bytes,
      },
    };
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      log.appendLine(`tokopt binary not found at "${binaryPath}"`);
      if (!warnedBinaryMissing) {
        warnedBinaryMissing = true;
        const action = "Show install instructions";
        vscode.window
          .showInformationMessage(
            `tokopt CLI not found. Token-cost CodeLens is disabled. Install: curl -fsSL https://raw.githubusercontent.com/shinyay/tokopt/main/scripts/install.sh | sh`,
            action
          )
          .then((picked) => {
            if (picked === action) {
              vscode.env.openExternal(
                vscode.Uri.parse("https://github.com/shinyay/tokopt#install")
              );
            }
          });
      }
      return { kind: "binary-missing" };
    }
    const msg = `tokopt count failed: ${String(err)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }
}

/** Reset the one-time warning latches. Exposed for tests. */
export function resetWarnings(): void {
  warnedBinaryMissing = false;
  warnedVersionMismatch = false;
}
