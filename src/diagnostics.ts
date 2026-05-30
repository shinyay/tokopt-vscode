import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Finding, FindingSeverity, runTokoptDetect } from "./detect.js";
import { isSuppressionSupported, parseSuppressions } from "./suppressions.js";

const SOURCE = "tokopt";

/**
 * Lookup `<!-- tokopt:disable=<id> -->` markers in a file's text, with a
 * cache that lives for the duration of a single `runOnce` so we never
 * re-read the same file for findings that target it multiple times.
 *
 * Reads are best-effort: any I/O failure logs once and returns an empty
 * suppression set (fail-open — visibility beats silent muting on errors).
 */
function suppressionsFor(
  absPath: string,
  cache: Map<string, Set<string>>,
  log: vscode.OutputChannel
): Set<string> {
  const hit = cache.get(absPath);
  if (hit) {
    return hit;
  }
  if (!isSuppressionSupported(absPath)) {
    const empty = new Set<string>();
    cache.set(absPath, empty);
    return empty;
  }
  let parsed: Set<string>;
  try {
    const content = fs.readFileSync(absPath, "utf8");
    parsed = parseSuppressions(content);
  } catch (err) {
    log.appendLine(
      `tokopt: failed to read suppressions from ${absPath}: ${String(err)}`
    );
    parsed = new Set<string>();
  }
  cache.set(absPath, parsed);
  return parsed;
}

/**
 * Resolve a detect finding's `location` to an absolute path WITHIN the
 * scanned root. Returns null if the location is empty, escapes the root
 * via `..`, isn't a real file on disk, or matches one of the known
 * free-form aggregate forms (e.g. MCP overload emits comma-separated
 * server names, not a path).
 */
function resolveFindingPath(rootFs: string, location: string): string | null {
  if (!location || location.includes(",") || location.includes(" ")) {
    return null;
  }
  const absPath = path.resolve(rootFs, location);
  const rootWithSep = rootFs.endsWith(path.sep) ? rootFs : rootFs + path.sep;
  if (absPath !== rootFs && !absPath.startsWith(rootWithSep)) {
    return null;
  }
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return absPath;
}

function mapSeverity(s: FindingSeverity): vscode.DiagnosticSeverity {
  switch (s) {
    case "critical":
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "warn":
      return vscode.DiagnosticSeverity.Warning;
    case "info":
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function formatMessage(f: Finding): string {
  const parts: string[] = [f.title];
  if (f.evidence) {
    parts.push(`— ${f.evidence}`);
  }
  parts.push(`Fix: ${f.recommendation}`);
  if (f.est_tokens_saved > 0) {
    parts.push(`(~${f.est_tokens_saved} tokens saved)`);
  }
  if (f.chapter_ref) {
    parts.push(`[${f.chapter_ref}]`);
  }
  return parts.join(" ");
}

function findingToDiagnostic(f: Finding): vscode.Diagnostic {
  // Findings carry file-level Location but no line number. Anchor to a
  // zero-width range at the top of the file so the entry appears in the
  // Problems panel without claiming a fake position inside the file.
  const range = new vscode.Range(0, 0, 0, 0);
  const diag = new vscode.Diagnostic(
    range,
    formatMessage(f),
    mapSeverity(f.severity)
  );
  diag.source = SOURCE;
  diag.code = f.id;
  return diag;
}

/**
 * Owns a single `DiagnosticCollection` and (re)populates it by invoking
 * `tokopt detect` against each workspace folder.
 *
 * Refresh triggers:
 *   - extension activation (best-effort initial scan)
 *   - user save (only files that match the customization predicate)
 *   - explicit `tokopt.refreshDiagnostics` command
 *   - configuration change to `tokopt.binaryPath`
 */
export class TokoptDiagnosticManager implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private refreshing = false;
  private pendingRefresh = false;
  /**
   * Incremented every time the published state is invalidated (refresh
   * start, explicit clear). An in-flight `runOnce` that started under
   * an older generation discards its results instead of overwriting a
   * newer cleared/refreshed state.
   */
  private generation = 0;

  constructor(private readonly log: vscode.OutputChannel) {
    this.collection = vscode.languages.createDiagnosticCollection("tokopt");
  }

  dispose(): void {
    this.collection.dispose();
  }

  /**
   * Whether any tokopt diagnostic is currently published for `uri`. Used
   * by the save listener so that a save which clears (via suppression) or
   * mutates (via slim apply) an already-flagged file always re-scans,
   * even when the file's path doesn't match the customization predicate
   * (e.g. an arbitrary markdown file flagged by a future rule).
   */
  hasDiagnosticsFor(uri: vscode.Uri): boolean {
    const arr = this.collection.get(uri);
    return !!arr && arr.length > 0;
  }

  /** Trigger a workspace-wide rescan. Coalesces concurrent calls. */
  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
    this.refreshing = true;
    try {
      await this.runOnce();
      while (this.pendingRefresh) {
        this.pendingRefresh = false;
        await this.runOnce();
      }
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Drop all currently published diagnostics and invalidate any in-flight
   * scan so its results cannot republish stale findings.
   */
  clear(): void {
    this.generation += 1;
    this.collection.clear();
  }

  private async runOnce(): Promise<void> {
    const myGen = ++this.generation;
    const config = vscode.workspace.getConfiguration("tokopt");
    if (config.get<boolean>("diagnostics.enabled", true) === false) {
      this.collection.clear();
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.collection.clear();
      return;
    }
    const binaryPath =
      config.get<string>("binaryPath", "tokopt") || "tokopt";

    // Collect everything into a side map first, then publish atomically.
    // This avoids the Problems panel flickering empty for the 30s a slow
    // scan can take, and lets us bail cleanly if our generation is stale.
    const pending = new Map<string, vscode.Diagnostic[]>();
    // Per-file suppression cache, scoped to this single runOnce so
    // subsequent refreshes pick up new `<!-- tokopt:disable=... -->`
    // markers without staleness.
    const suppressionCache = new Map<string, Set<string>>();

    for (const folder of folders) {
      const rootFs = folder.uri.fsPath;
      const outcome = await runTokoptDetect(binaryPath, rootFs, this.log);
      if (this.generation !== myGen) {
        // Someone called clear() or started another refresh while we
        // were running. Drop this batch — they own the published state.
        return;
      }
      if (outcome.kind !== "ok") {
        // binary-missing / version-mismatch / error already logged + toasted
        // by runTokoptDetect. Nothing else to do; leave diagnostics empty.
        continue;
      }

      for (const f of outcome.findings) {
        const absPath = resolveFindingPath(rootFs, f.location);
        if (!absPath) {
          this.log.appendLine(
            `tokopt detect: skipping finding with non-file location ${JSON.stringify(f.location)} (id=${f.id})`
          );
          continue;
        }
        const suppressed = suppressionsFor(absPath, suppressionCache, this.log);
        if (suppressed.has(f.id)) {
          continue;
        }
        const uri = vscode.Uri.file(absPath).toString();
        const arr = pending.get(uri) ?? [];
        arr.push(findingToDiagnostic(f));
        pending.set(uri, arr);
      }
    }

    if (this.generation !== myGen) {
      return;
    }
    this.collection.clear();
    for (const [uriStr, diags] of pending) {
      this.collection.set(vscode.Uri.parse(uriStr), diags);
    }
  }
}
