import * as path from "node:path";
import * as vscode from "vscode";
import { runTokoptAudit, AuditFile, AuditResult } from "./audit.js";

const REFRESH_DEBOUNCE_MS = 250;
const SCOPE_ORDER: AuditFile["scope"][] = [
  "always-on",
  "conditional",
  "on-demand",
];

const SCOPE_LABEL: Record<AuditFile["scope"], string> = {
  "always-on": "Always-on",
  conditional: "Conditional",
  "on-demand": "On-demand",
};

const SCOPE_DESCRIPTION: Record<AuditFile["scope"], string> = {
  "always-on": "paid every Copilot request",
  conditional: "paid only when invoked",
  "on-demand": "paid when triggered",
};

/**
 * Discriminated union for tree nodes. Stable IDs are derived in
 * getTreeItem so that VS Code preserves collapse state across
 * `_onDidChangeTreeData.fire()` even when category labels change
 * (they include token counts that fluctuate with edits).
 */
export type TokenCostNode =
  | { kind: "category"; scope: AuditFile["scope"]; tokens: number; fileCount: number }
  | {
      kind: "file";
      absPath: string;
      relPath: string;
      tokens: number;
      scope: AuditFile["scope"];
      category: string;
      bytes: number;
      isMarkdown: boolean;
    };

/**
 * Per-folder audit state. Each workspace folder gets its own slot so
 * the failure of one folder doesn't blank successful folders.
 */
interface FolderState {
  folderUri: string;
  binaryPath: string;
  result?: AuditResult;
  error?: string;
}

/**
 * State key set via vscode.commands.executeCommand("setContext"). The
 * package.json `viewsWelcome` `when` clauses match these to render the
 * right empty / error / ready welcome content. Always exactly one of
 * the values below — never undefined once `setState` has been called
 * at least once.
 */
type TreeUiState = "loading" | "missingBinary" | "empty" | "error" | "ready";

const STATE_CONTEXT_KEY = "tokopt.tree.state";

export class TokenCostTreeProvider
  implements vscode.TreeDataProvider<TokenCostNode>, vscode.Disposable
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<TokenCostNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Per-folder last-published-state cache. NOT a freshness shortcut —
  // every refresh re-runs `tokopt audit`. The cache exists so:
  //  (1) "Show in audit panel" can dump the exact JSON that produced
  //      the current tree even if a refresh is racing,
  //  (2) per-folder failures don't blank successful folders on the
  //      next refresh until they themselves succeed/fail again.
  private folders: Map<string, FolderState> = new Map();

  // Generation counter for in-flight cancellation. Bumped on every
  // refresh request — older runs check this after their async audit
  // returns and bail without publishing if it changed.
  private generation = 0;

  // Concurrent refresh coalescing — mirrors TokoptDiagnosticManager
  // + TokoptStatusBarManager patterns.
  private refreshing = false;
  private pendingRefresh = false;

  // Debounce timer so a burst of save/watcher events collapses to
  // one audit run.
  private debounceTimer?: NodeJS.Timeout;

  // UI state — drives both the package.json welcome content (via the
  // STATE_CONTEXT_KEY context key) and a tiny error-message field so
  // hovering an "error" welcome can still show why. Starts as
  // `undefined` so the constructor's setState("loading") actually
  // publishes the initial context key (rubber-duck post-impl M).
  private state?: TreeUiState;
  private errorMessage = "";

  // Visibility latch (rubber-duck H#1). The provider does NOT auto-run
  // any audit until the user has opened the view at least once.
  // Save / watcher events that fire BEFORE the first open will mark
  // `wantsRefreshOnceVisible` but won't spawn audit processes.
  private hasBeenVisible = false;
  private wantsRefreshOnceVisible = false;

  constructor(
    private readonly log: vscode.OutputChannel,
    private readonly resolveBinary: () => string
  ) {
    void this.setState("loading");
  }

  // ---- TreeDataProvider impl ---------------------------------------

  getTreeItem(node: TokenCostNode): vscode.TreeItem {
    if (node.kind === "category") {
      const warn = this.getWarnThreshold();
      const error = this.getErrorThreshold();
      const item = new vscode.TreeItem(
        SCOPE_LABEL[node.scope],
        node.fileCount > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      item.id = `category:${node.scope}`;
      item.description = `${node.tokens.toLocaleString()} tokens · ${node.fileCount} file${node.fileCount === 1 ? "" : "s"}`;
      item.tooltip = new vscode.MarkdownString(
        `**${SCOPE_LABEL[node.scope]}** — ${SCOPE_DESCRIPTION[node.scope]}\n\n` +
          `Total: **${node.tokens.toLocaleString()} tokens** across **${node.fileCount}** file${node.fileCount === 1 ? "" : "s"}.\n\n` +
          `Warn threshold: ${warn.toLocaleString()} · Error threshold: ${error.toLocaleString()}`
      );
      item.iconPath = iconForTokens(node.tokens, warn, error);
      item.contextValue = "tokoptCategory";
      return item;
    }
    const warn = this.getWarnThreshold();
    const error = this.getErrorThreshold();
    const item = new vscode.TreeItem(
      path.basename(node.absPath),
      vscode.TreeItemCollapsibleState.None
    );
    item.id = `file:${node.absPath}`;
    item.resourceUri = vscode.Uri.file(node.absPath);
    item.description = `${node.tokens.toLocaleString()} tokens`;
    item.tooltip = new vscode.MarkdownString(
      `**${node.relPath}**\n\n` +
        `Tokens: **${node.tokens.toLocaleString()}** (${node.scope})\n\n` +
        `Category: ${node.category}\n\n` +
        `Bytes: ${node.bytes.toLocaleString()}\n\n` +
        `_Click to open._`
    );
    item.iconPath = iconForTokens(node.tokens, warn, error);
    item.contextValue = node.isMarkdown ? "tokoptFileMarkdown" : "tokoptFileConfig";
    // Click target — opens the file. Per-row context menu entries
    // (slim / detect / open) are wired via package.json `menus`.
    item.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [vscode.Uri.file(node.absPath)],
    };
    return item;
  }

  getChildren(element?: TokenCostNode): TokenCostNode[] {
    if (this.state !== "ready") {
      // Empty children → viewsWelcome renders, gated on
      // STATE_CONTEXT_KEY in package.json.
      return [];
    }
    if (!element) {
      // Roots: one node per scope that has at least one file.
      const merged = this.mergeFiles();
      const byScope = groupByScope(merged);
      return SCOPE_ORDER.filter((scope) => byScope[scope].length > 0).map(
        (scope) => ({
          kind: "category" as const,
          scope,
          tokens: byScope[scope].reduce((sum, f) => sum + f.tokens, 0),
          fileCount: byScope[scope].length,
        })
      );
    }
    if (element.kind === "category") {
      const merged = this.mergeFiles();
      const byScope = groupByScope(merged);
      return byScope[element.scope]
        .slice()
        .sort((a, b) => b.tokens - a.tokens)
        .map((entry) => {
          const isMarkdown = isMarkdownPath(entry.absPath);
          return {
            kind: "file" as const,
            absPath: entry.absPath,
            relPath: entry.relPath,
            tokens: entry.tokens,
            scope: entry.scope,
            category: entry.category,
            bytes: entry.bytes,
            isMarkdown,
          };
        });
    }
    return [];
  }

  // ---- Public API --------------------------------------------------

  /** Called when the TreeView becomes visible for the first time, or
   *  becomes visible again after being hidden. */
  onVisibilityChange(visible: boolean): void {
    if (!visible) return;
    const firstOpen = !this.hasBeenVisible;
    this.hasBeenVisible = true;
    if (firstOpen || this.wantsRefreshOnceVisible) {
      this.wantsRefreshOnceVisible = false;
      void this.refresh();
    }
  }

  /** Debounced refresh. Multiple rapid calls collapse to one audit. */
  scheduleRefresh(): void {
    if (!this.hasBeenVisible) {
      // Lazy: defer until the user opens the view.
      this.wantsRefreshOnceVisible = true;
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** Drops all cached folder state and triggers a refresh. Bumps the
   *  generation counter so any in-flight audit's results are discarded
   *  (rubber-duck post-impl M — clearCache must invalidate in-flight). */
  clearCache(): void {
    this.generation++;
    this.folders.clear();
    if (this.hasBeenVisible) {
      void this.refresh();
    }
  }

  /** Refresh entry point — coalesces with any in-flight refresh. */
  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.pendingRefresh = false;
        await this.runOnce();
      } while (this.pendingRefresh);
    } finally {
      this.refreshing = false;
    }
  }

  /** Cached raw stdout for the "Show in audit panel" command. Empty
   *  string if nothing has been audited yet. */
  getRawAuditDump(): string {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return "";
    const parts: string[] = [];
    for (const folder of folders) {
      const state = this.folders.get(folder.uri.toString());
      if (state?.result) {
        parts.push(
          `# ${folder.name} (${folder.uri.fsPath})\n${state.result.raw.trim()}`
        );
      } else if (state?.error) {
        parts.push(`# ${folder.name} — audit failed: ${state.error}`);
      }
    }
    return parts.join("\n\n");
  }

  /** Reveals + writes a human-readable summary plus the cached raw
   *  JSON for the current tree state into the tokopt output channel. */
  showAuditDump(channel: vscode.OutputChannel): void {
    channel.show(true);
    channel.appendLine("");
    channel.appendLine("=== tokopt audit (cached snapshot) ===");
    if (this.state === "error" && this.errorMessage) {
      channel.appendLine(`(audit error: ${this.errorMessage})`);
    }
    const merged = this.mergeFiles();
    if (merged.length === 0) {
      channel.appendLine("(no customization files found)");
      return;
    }
    const byScope = groupByScope(merged);
    for (const scope of SCOPE_ORDER) {
      const entries = byScope[scope];
      if (entries.length === 0) continue;
      const total = entries.reduce((s, f) => s + f.tokens, 0);
      channel.appendLine("");
      channel.appendLine(
        `## ${SCOPE_LABEL[scope]} — ${total.toLocaleString()} tokens (${entries.length} files)`
      );
      const sorted = entries.slice().sort((a, b) => b.tokens - a.tokens);
      for (const f of sorted) {
        channel.appendLine(
          `  ${f.tokens.toString().padStart(6)} tokens  ${f.relPath}  [${f.category}]`
        );
      }
    }
    channel.appendLine("");
    channel.appendLine("--- raw JSON ---");
    channel.appendLine(this.getRawAuditDump());
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this._onDidChangeTreeData.dispose();
  }

  // ---- Internals ---------------------------------------------------

  private async runOnce(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      this.folders.clear();
      await this.setState("empty");
      this._onDidChangeTreeData.fire();
      return;
    }

    const myGen = ++this.generation;
    const binaryPath = this.resolveBinary();

    // Run all folder audits in parallel. Per-folder errors don't fail
    // the whole tree — they show as a per-folder absence in
    // `pendingFolders` and the rest still render.
    const pendingFolders = new Map<string, FolderState>();
    const settled = await Promise.allSettled(
      folders.map(async (folder) => {
        const outcome = await runTokoptAudit(binaryPath, folder.uri.fsPath, this.log);
        return { folder, outcome, binaryPath };
      })
    );

    // Stale check AFTER the long await — same pattern as
    // TokoptStatusBarManager.runOnce.
    if (this.generation !== myGen) {
      return;
    }

    let sawBinaryMissing = false;
    let sawVersionMismatch = false;
    let sawError = false;
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") {
        // Promise rejected — should never happen since runTokoptAudit
        // returns a structured outcome and doesn't throw, but log
        // defensively.
        this.log.appendLine(`audit promise rejected: ${String(outcome.reason)}`);
        sawError = true;
        continue;
      }
      const { folder, outcome: ao } = outcome.value;
      const key = folder.uri.toString();
      if (ao.kind === "ok") {
        pendingFolders.set(key, {
          folderUri: key,
          binaryPath,
          result: ao.result,
        });
      } else if (ao.kind === "binary-missing") {
        sawBinaryMissing = true;
        pendingFolders.set(key, {
          folderUri: key,
          binaryPath,
          error: "binary missing",
        });
      } else if (ao.kind === "version-mismatch") {
        sawVersionMismatch = true;
        pendingFolders.set(key, {
          folderUri: key,
          binaryPath,
          error: `version mismatch (got ${JSON.stringify(ao.got)})`,
        });
      } else {
        sawError = true;
        pendingFolders.set(key, {
          folderUri: key,
          binaryPath,
          error: ao.message,
        });
      }
    }

    // Second stale check before merging — paranoid but cheap.
    if (this.generation !== myGen) {
      return;
    }

    this.folders = pendingFolders;

    // Decide the UI state. Priority:
    //   1) Binary missing on ALL folders → missingBinary
    //   2) Any successful folder with at least one file → ready
    //   3) All folders succeeded but no files anywhere → empty
    //   4) All folders failed (not binary-missing) → error
    //   5) Default → empty (e.g. version mismatch on all)
    const anyData = [...pendingFolders.values()].some(
      (s) => s.result && s.result.files.length > 0
    );
    const allBinaryMissing =
      sawBinaryMissing &&
      [...pendingFolders.values()].every(
        (s) => s.error === "binary missing"
      );

    if (allBinaryMissing) {
      this.errorMessage = "tokopt binary not found on PATH";
      await this.setState("missingBinary");
    } else if (anyData) {
      this.errorMessage = "";
      await this.setState("ready");
    } else if (sawError || sawVersionMismatch) {
      // No usable data AND at least one folder failed. Prefer "error"
      // over "empty" so partial failures don't masquerade as a clean
      // empty workspace (rubber-duck post-impl M).
      this.errorMessage = sawVersionMismatch
        ? "tokopt version mismatch — install a compatible tokopt CLI"
        : "tokopt audit failed (see tokopt output channel)";
      await this.setState("error");
    } else {
      // All folders succeeded with zero files — truly empty workspace.
      this.errorMessage = "";
      await this.setState("empty");
    }

    this._onDidChangeTreeData.fire();
  }

  /** Merge files from all folder slots, resolving paths to absolute
   *  and dropping anything that escapes its folder root. */
  private mergeFiles(): Array<
    AuditFile & { absPath: string; relPath: string }
  > {
    const out: Array<AuditFile & { absPath: string; relPath: string }> = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const state = this.folders.get(folder.uri.toString());
      if (!state?.result) continue;
      const rootFs = folder.uri.fsPath;
      for (const f of state.result.files) {
        // L#10 defensive path resolution: resolve relative to the
        // folder root and verify the result stays under it.
        const absPath = path.resolve(rootFs, f.path);
        if (!absPath.startsWith(rootFs + path.sep) && absPath !== rootFs) {
          this.log.appendLine(
            `audit dropped path outside workspace folder: ${f.path}`
          );
          continue;
        }
        const relPath = vscode.workspace.asRelativePath(
          vscode.Uri.file(absPath),
          /*includeWorkspaceFolder*/ folders.length > 1
        );
        out.push({ ...f, absPath, relPath });
      }
    }
    return out;
  }

  private async setState(next: TreeUiState): Promise<void> {
    if (this.state === next) return;
    this.state = next;
    await vscode.commands.executeCommand(
      "setContext",
      STATE_CONTEXT_KEY,
      next
    );
  }

  private getWarnThreshold(): number {
    const cfg = vscode.workspace.getConfiguration("tokopt");
    return Math.max(0, cfg.get<number>("treeView.warnThreshold", 500));
  }

  private getErrorThreshold(): number {
    const cfg = vscode.workspace.getConfiguration("tokopt");
    const warn = this.getWarnThreshold();
    // M#8 normalization: error must be >= warn or threshold logic breaks.
    return Math.max(warn, cfg.get<number>("treeView.errorThreshold", 1500));
  }
}

// ---- Helpers --------------------------------------------------------

function isMarkdownPath(absPath: string): boolean {
  const lower = absPath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function iconForTokens(
  tokens: number,
  warn: number,
  error: number
): vscode.ThemeIcon {
  if (tokens >= error) {
    return new vscode.ThemeIcon(
      "error",
      new vscode.ThemeColor("editorError.foreground")
    );
  }
  if (tokens >= warn) {
    return new vscode.ThemeIcon(
      "warning",
      new vscode.ThemeColor("editorWarning.foreground")
    );
  }
  return new vscode.ThemeIcon(
    "pass",
    new vscode.ThemeColor("testing.iconPassed")
  );
}

function groupByScope<T extends { scope: AuditFile["scope"] }>(
  items: T[]
): Record<AuditFile["scope"], T[]> {
  const out: Record<AuditFile["scope"], T[]> = {
    "always-on": [],
    conditional: [],
    "on-demand": [],
  };
  for (const item of items) {
    out[item.scope].push(item);
  }
  return out;
}

/**
 * Glob covering every file shape that the Go audit walker recognises.
 * Used by extension.ts FileSystemWatcher so external mutations (git
 * checkout, sibling tool writes) refresh the tree even without a save
 * event from the editor. Categories live in
 * tools/tokopt/internal/audit/audit.go.
 */
export const TOKEN_COST_WATCHER_GLOB =
  "**/{copilot-instructions.md,instructions.md,AGENTS.md,SKILL.md,*.agent.md,*.chatmode.md,*.prompt.md,mcp.json,mcp-config.json}";
