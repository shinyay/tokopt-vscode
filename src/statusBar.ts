import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { classifyCustomizationFile } from "./customizationFiles.js";
import { runTokoptCount } from "./tokopt.js";

/**
 * Filenames that, when found at a workspace folder ROOT or in `.github/`
 * inside the root, are treated as the always-on tax. Deliberately stricter
 * than {@link classifyCustomizationFile} so nested `docs/AGENTS.md` or
 * `packages/foo/copilot-instructions.md` do NOT inflate the workspace
 * total — only files at the conventional global injection points count.
 */
const ALWAYS_ON_BASENAMES = [
  "copilot-instructions.md",
  "instructions.md",
  "AGENTS.md",
] as const;

const REFRESH_DEBOUNCE_MS = 250;

interface CountCacheEntry {
  mtimeMs: number;
  size: number;
  binaryPath: string;
  tokens: number;
}

interface AggregateState {
  totalTokens: number;
  perFile: Array<{ absPath: string; relPath: string; tokens: number }>;
  errorCount: number;
}

/**
 * Owns a single workspace-tax `StatusBarItem`. Renders the always-on tax
 * (sum of tokens across well-known global customization files at the
 * workspace root + `.github/`) and, when the active editor is a recognised
 * customization file, appends its current file count.
 *
 * Refresh triggers:
 *   - activation (best-effort initial scan)
 *   - user save of an always-on file (debounced)
 *   - FileSystemWatcher create / change / delete on the strict patterns
 *   - workspace folder change
 *   - `tokopt.refreshStatusBar` command
 *   - configuration change under `tokopt.*` (binaryPath, thresholds, enable)
 */
export class TokoptStatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly cache = new Map<string, CountCacheEntry>();
  private state: AggregateState = {
    totalTokens: 0,
    perFile: [],
    errorCount: 0,
  };
  private currentFile: { path: string; tokens: number } | null = null;
  private refreshing = false;
  private pendingRefresh = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Incremented each runOnce + on cache invalidation. Stale runs check
   * `myGen === this.generation` before mutating any shared state — the
   * cache `set` calls are batched into a local map and merged only after
   * the check passes (otherwise an in-flight count from the old binary
   * could repopulate the cache after a config change).
   */
  private generation = 0;
  private currentFileSeq = 0;
  private binaryMissing = false;

  constructor(private readonly log: vscode.OutputChannel) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "tokopt.showStatusBarBreakdown";
    this.item.hide();
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.item.dispose();
  }

  /**
   * Drop a single file from the cache (e.g. on delete or invalidate).
   * Only bumps generation when the path was actually cached — otherwise
   * unrelated saves (e.g. saving foo.ts) would cancel in-flight refreshes
   * by superseding their generation token. The cache delete is a no-op
   * for uncached paths so safe to always call.
   */
  invalidate(filePath: string): void {
    if (this.cache.delete(filePath)) {
      this.generation += 1;
    }
  }

  /** Drop the entire cache (config change). */
  clearCache(): void {
    this.cache.clear();
    this.binaryMissing = false;
    this.generation += 1;
  }

  /**
   * True when `absPath` matches one of the six strict always-on locations:
   * `<root>/{filename}` or `<root>/.github/{filename}` for filename in
   * {copilot-instructions.md, instructions.md, AGENTS.md}, for any workspace
   * folder root. Used to gate save-listener + watcher refresh triggers so
   * unrelated files don't churn the scan.
   */
  isStrictAlwaysOnPath(absPath: string): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return false;
    }
    const basename = path.basename(absPath);
    if (!(ALWAYS_ON_BASENAMES as readonly string[]).includes(basename)) {
      return false;
    }
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      if (
        absPath === path.join(root, basename) ||
        absPath === path.join(root, ".github", basename)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Debounced refresh — multiple rapid invalidations (save + watcher
   * fired for the same change) collapse into a single runOnce. Coalescing
   * via `pendingRefresh` still handles the case where another refresh
   * arrives while one is in flight.
   */
  scheduleRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** Immediate refresh (activation, explicit command). */
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
   * Recompute the "/ current: N" appendix for the supplied editor (or the
   * active editor if omitted). Re-renders without re-scanning the tax.
   *
   * Snapshots a request sequence + path + binaryPath BEFORE the async
   * count call and validates after — a rapid Cmd+Tab between two files
   * (or a config change mid-count) must NOT let a stale result clobber
   * the newer state. Also short-circuits when the status bar is disabled
   * so a disabled user pays zero subprocess cost on editor switches.
   */
  async updateCurrentFile(editor?: vscode.TextEditor | undefined): Promise<void> {
    const config = vscode.workspace.getConfiguration("tokopt");
    if (config.get<boolean>("statusBar.enabled", true) === false) {
      this.currentFile = null;
      this.item.hide();
      return;
    }
    const target = editor ?? vscode.window.activeTextEditor;
    if (!target || target.document.uri.scheme !== "file") {
      this.currentFile = null;
      this.renderIfShown();
      return;
    }
    const filePath = target.document.uri.fsPath;
    const klass = classifyCustomizationFile(filePath);
    if (!klass) {
      this.currentFile = null;
      this.renderIfShown();
      return;
    }
    const binaryPath = config.get<string>("binaryPath", "tokopt") || "tokopt";
    const mySeq = ++this.currentFileSeq;
    const result = await this.countFile(filePath, binaryPath);
    // Stale-result guards (in priority order): a newer call superseded
    // us, the active editor changed, the binaryPath changed, the user
    // disabled the status bar mid-flight.
    if (this.currentFileSeq !== mySeq) {
      return;
    }
    const stillActive =
      vscode.window.activeTextEditor?.document.uri.fsPath === filePath;
    if (!stillActive) {
      return;
    }
    const currentConfig = vscode.workspace.getConfiguration("tokopt");
    if (currentConfig.get<boolean>("statusBar.enabled", true) === false) {
      return;
    }
    const currentBinary =
      currentConfig.get<string>("binaryPath", "tokopt") || "tokopt";
    if (currentBinary !== binaryPath) {
      return;
    }
    if (result.kind === "binary-missing") {
      // Don't set this.binaryMissing here — runOnce owns that flag, and
      // a stale binary-missing read could mask a working refresh. Just
      // skip updating currentFile.
      this.currentFile = null;
      this.renderIfShown();
      return;
    }
    if (result.kind === "ok") {
      this.currentFile = { path: filePath, tokens: result.tokens };
    } else {
      this.currentFile = null;
    }
    this.renderIfShown();
  }

  /** Re-render only (no scan); used after `updateCurrentFile`. */
  private renderIfShown(): void {
    if (this.binaryMissing) {
      this.item.hide();
      return;
    }
    const config = vscode.workspace.getConfiguration("tokopt");
    if (config.get<boolean>("statusBar.enabled", true) === false) {
      this.item.hide();
      return;
    }
    if (this.state.perFile.length === 0 && this.state.errorCount === 0) {
      this.item.hide();
      return;
    }
    this.render(config);
  }

  /**
   * Enumerate strict always-on locations relative to each workspace folder.
   * Pure fs.statSync — no glob walk — so this is O(folders × 6) regardless
   * of repo size. Bounded set means we never need a MAX_FILES cap.
   */
  private discoverAlwaysOnFiles(): string[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return [];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      const candidates = [
        ...ALWAYS_ON_BASENAMES.map((b) => path.join(root, b)),
        ...ALWAYS_ON_BASENAMES.map((b) => path.join(root, ".github", b)),
      ];
      for (const candidate of candidates) {
        if (seen.has(candidate)) {
          continue;
        }
        try {
          const st = fs.statSync(candidate);
          if (!st.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        seen.add(candidate);
        out.push(candidate);
      }
    }
    return out;
  }

  /** Glob string used by the FileSystemWatcher to spot strict-pattern changes. */
  static watcherGlob(): string {
    return `**/{${ALWAYS_ON_BASENAMES.join(",")},${
      ALWAYS_ON_BASENAMES.map((b) => `.github/${b}`).join(",")
    }}`;
  }

  /**
   * Count a single file via `tokopt count`. Honours an mtime+size+binaryPath
   * cache entry. Side-effect-free with respect to `this.binaryMissing` /
   * `this.currentFile` — caller validates request freshness and commits
   * any state changes.
   */
  private async countFile(
    filePath: string,
    binaryPath: string
  ): Promise<
    | { kind: "ok"; tokens: number }
    | { kind: "binary-missing" }
    | { kind: "skip" }
  > {
    let mtimeMs = 0;
    let size = 0;
    try {
      const st = fs.statSync(filePath);
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      return { kind: "skip" };
    }
    const cached = this.cache.get(filePath);
    if (
      cached &&
      cached.mtimeMs === mtimeMs &&
      cached.size === size &&
      cached.binaryPath === binaryPath
    ) {
      return { kind: "ok", tokens: cached.tokens };
    }
    const outcome = await runTokoptCount(binaryPath, filePath, this.log);
    if (outcome.kind === "binary-missing") {
      return { kind: "binary-missing" };
    }
    if (outcome.kind !== "ok") {
      return { kind: "skip" };
    }
    // Cache write is safe: the entry is keyed by mtimeMs+size+binaryPath,
    // so a stale-result write can never satisfy a future read with a
    // different binaryPath or after a file mutation.
    this.cache.set(filePath, {
      mtimeMs,
      size,
      binaryPath,
      tokens: outcome.result.tokens,
    });
    return { kind: "ok", tokens: outcome.result.tokens };
  }

  private async runOnce(): Promise<void> {
    const myGen = ++this.generation;
    const config = vscode.workspace.getConfiguration("tokopt");
    if (config.get<boolean>("statusBar.enabled", true) === false) {
      this.item.hide();
      return;
    }
    const binaryPath = config.get<string>("binaryPath", "tokopt") || "tokopt";

    const files = this.discoverAlwaysOnFiles();
    if (files.length === 0) {
      this.state = { totalTokens: 0, perFile: [], errorCount: 0 };
      this.binaryMissing = false;
      this.item.hide();
      return;
    }

    // Pending cache updates — committed only after the generation check
    // below passes. This prevents a stale runOnce (e.g. one that started
    // with the previous binaryPath) from poisoning the shared cache after
    // a config change has called `clearCache()`.
    const pendingCache = new Map<string, CountCacheEntry>();
    const perFile: Array<{ absPath: string; relPath: string; tokens: number }> = [];
    let totalTokens = 0;
    let errorCount = 0;
    let binaryMissing = false;

    for (const filePath of files) {
      let mtimeMs = 0;
      let size = 0;
      try {
        const st = fs.statSync(filePath);
        mtimeMs = st.mtimeMs;
        size = st.size;
      } catch {
        errorCount += 1;
        continue;
      }
      const cached = this.cache.get(filePath);
      let tokens: number;
      if (
        cached &&
        cached.mtimeMs === mtimeMs &&
        cached.size === size &&
        cached.binaryPath === binaryPath
      ) {
        tokens = cached.tokens;
      } else {
        const outcome = await runTokoptCount(binaryPath, filePath, this.log);
        // Bail before mutating anything if a clear()/refresh() has
        // superseded us during the async call.
        if (this.generation !== myGen) {
          return;
        }
        if (outcome.kind === "binary-missing") {
          binaryMissing = true;
          break;
        }
        if (outcome.kind !== "ok") {
          errorCount += 1;
          continue;
        }
        tokens = outcome.result.tokens;
        pendingCache.set(filePath, { mtimeMs, size, binaryPath, tokens });
      }
      totalTokens += tokens;
      perFile.push({
        absPath: filePath,
        relPath: this.relativePath(filePath),
        tokens,
      });
    }

    if (this.generation !== myGen) {
      return;
    }

    if (binaryMissing) {
      this.binaryMissing = true;
      this.item.hide();
      return;
    }

    this.binaryMissing = false;
    for (const [k, v] of pendingCache) {
      this.cache.set(k, v);
    }
    this.state = { totalTokens, perFile, errorCount };
    this.render(config);
  }

  private relativePath(absPath: string): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return absPath;
    }
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      const sep = root.endsWith(path.sep) ? root : root + path.sep;
      if (absPath.startsWith(sep)) {
        return absPath.slice(sep.length);
      }
      if (absPath === root) {
        return path.basename(absPath);
      }
    }
    return absPath;
  }

  private render(config: vscode.WorkspaceConfiguration): void {
    const warnThreshold = Math.max(
      0,
      config.get<number>("statusBar.warnThreshold", 500)
    );
    const errorThreshold = Math.max(
      0,
      config.get<number>("statusBar.errorThreshold", 1500)
    );
    const { totalTokens, errorCount, perFile } = this.state;

    const errorMarker = errorCount > 0 ? " $(warning)" : "";
    let text = `$(file-text) ${totalTokens.toLocaleString()} tokens always-on${errorMarker}`;
    if (this.currentFile && !this.isAlwaysOnPath(this.currentFile.path)) {
      text += ` / current: ${this.currentFile.tokens.toLocaleString()}`;
    }
    this.item.text = text;

    if (totalTokens >= errorThreshold) {
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else if (totalTokens >= warnThreshold) {
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    } else {
      this.item.backgroundColor = undefined;
    }

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.isTrusted = false;
    tooltip.appendMarkdown(
      `**tokopt — Always-on tax: ${totalTokens.toLocaleString()} tokens**\n\n`
    );
    tooltip.appendMarkdown(
      `Paid on every Copilot request, multiplied by every turn of every conversation.\n\n`
    );
    tooltip.appendMarkdown(
      `Files counted: ${perFile.length}`
    );
    if (errorCount > 0) {
      tooltip.appendMarkdown(
        ` (${errorCount} file${errorCount === 1 ? "" : "s"} failed to count — see "tokopt" output channel)`
      );
    }
    tooltip.appendMarkdown(`\n\n`);
    tooltip.appendMarkdown(
      `Thresholds: warn ≥ ${warnThreshold.toLocaleString()}, error ≥ ${errorThreshold.toLocaleString()}\n\n`
    );
    if (this.currentFile && !this.isAlwaysOnPath(this.currentFile.path)) {
      tooltip.appendMarkdown(
        `Current file (${path.basename(this.currentFile.path)}): ${this.currentFile.tokens.toLocaleString()} tokens (saved version)\n\n`
      );
    }
    tooltip.appendMarkdown(`Click for per-file breakdown.`);
    this.item.tooltip = tooltip;

    this.item.show();
  }

  private isAlwaysOnPath(absPath: string): boolean {
    return this.state.perFile.some((f) => f.absPath === absPath);
  }

  /**
   * Append the current breakdown to the shared output channel and reveal
   * it. Used as the click target — the issue calls for an "audit panel /
   * output" surface, and the output channel is the closest fit without
   * spawning a separate webview or virtual document.
   */
  showBreakdown(): void {
    const { totalTokens, perFile, errorCount } = this.state;
    const ts = new Date().toISOString();
    this.log.appendLine(``);
    this.log.appendLine(
      `=== tokopt status bar — Always-on tax (${ts}) ===`
    );
    if (perFile.length === 0) {
      this.log.appendLine(
        `No always-on files found in workspace root or .github/.`
      );
    } else {
      this.log.appendLine(
        `Total: ${totalTokens.toLocaleString()} tokens across ${perFile.length} file${perFile.length === 1 ? "" : "s"}`
      );
      for (const { relPath, tokens } of perFile) {
        this.log.appendLine(
          `  ${relPath}: ${tokens.toLocaleString()} tokens`
        );
      }
    }
    if (errorCount > 0) {
      this.log.appendLine(
        `Skipped ${errorCount} file${errorCount === 1 ? "" : "s"} due to errors (see entries above for details).`
      );
    }
    this.log.show(true);
  }
}
