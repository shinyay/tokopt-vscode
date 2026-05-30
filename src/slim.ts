import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { warnBinaryMissing } from "./warnings.js";

const execFileAsync = promisify(execFile);

/**
 * `tokopt slim --format=json` deliberately omits the compressed content
 * (`Content NEVER appears in JSON` per `tokopt slim --help`). To apply
 * the compression as a Quick Fix we therefore invoke text mode and parse
 * around the well-known `--- compressed content ---` delimiter — a
 * contract that `tools/tokopt/cmd/tokopt/slim_test.go` asserts on every
 * tokopt build, so a silent format change would break tokopt's own CI.
 *
 * If/when tokopt ships a content-bearing JSON envelope, swap this for a
 * strict `format_version`-dispatched parser without touching callers.
 */
const CONTENT_DELIMITER = "\n--- compressed content ---\n";
const TOKEN_LINE_RE = /^tokens:\s*(\d+)\s*->\s*(\d+)\s*\(saved\s*(-?\d+),\s*(-?[\d.]+)%\)/m;

export type SlimOutcome =
  | {
      kind: "ok";
      compressed: string;
      originalTokens: number;
      compressedTokens: number;
      savedTokens: number;
      savedPercent: number;
    }
  | { kind: "binary-missing" }
  | { kind: "error"; message: string };

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

/**
 * Run `tokopt slim --input <file>` in text mode and return the compressed
 * content together with the measured token delta. Never throws.
 *
 * Customization-file detection is left to tokopt (`--emphasis=auto`) — for
 * recognised customization paths slim disables NexusEn (English stopword
 * stripping) and preserves emphasis, so the output stays human-readable.
 * For other markdown the default lossy pipeline runs.
 */
export async function runTokoptSlim(
  binaryPath: string,
  file: string,
  log: vscode.OutputChannel
): Promise<SlimOutcome> {
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ["slim", "--input", file],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
    );

    const delimIdx = stdout.indexOf(CONTENT_DELIMITER);
    if (delimIdx < 0) {
      const msg = `tokopt slim text output missing "--- compressed content ---" delimiter (output starts: ${stdout.slice(0, 200)})`;
      log.appendLine(msg);
      return { kind: "error", message: msg };
    }

    const metadata = stdout.slice(0, delimIdx);
    // Content is everything after the delimiter line. The CLI emits a
    // trailing newline, but that is content the user authored — we keep
    // it as-is rather than trimming.
    const compressed = stdout.slice(delimIdx + CONTENT_DELIMITER.length);

    // Defensive token-line parsing: if the CLI ever changes the prose
    // line we still publish the content edit, but with savedTokens=0
    // (the after-apply toast then shows a generic message).
    const tokensMatch = metadata.match(TOKEN_LINE_RE);
    let originalTokens = 0;
    let compressedTokens = 0;
    let savedTokens = 0;
    let savedPercent = 0;
    if (tokensMatch) {
      originalTokens = Number(tokensMatch[1]);
      compressedTokens = Number(tokensMatch[2]);
      savedTokens = Number(tokensMatch[3]);
      savedPercent = Number(tokensMatch[4]);
    } else {
      log.appendLine(
        `tokopt slim: could not parse "tokens: A -> B (saved C, D%)" line from metadata; proceeding with savedTokens=0`
      );
    }

    return {
      kind: "ok",
      compressed,
      originalTokens,
      compressedTokens,
      savedTokens,
      savedPercent,
    };
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      log.appendLine(`tokopt binary not found at "${binaryPath}"`);
      warnBinaryMissing();
      return { kind: "binary-missing" };
    }
    const msg = `tokopt slim failed: ${String(err)}`;
    log.appendLine(msg);
    return { kind: "error", message: msg };
  }
}
