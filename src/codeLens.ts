import * as vscode from "vscode";
import { classifyCustomizationFile } from "./customizationFiles.js";
import { CountResult, runTokoptCount } from "./tokopt.js";

interface CacheEntry {
  documentVersion: number;
  tokens: number;
  bytes: number;
}

/**
 * CodeLens provider that shows a single inline annotation at the top of
 * any recognised Copilot customization file:
 *
 *   ▸ 1,394 tokens (conditional, paid when agent invoked)  ▸ Show breakdown
 *
 * - Token count comes from `tokopt count --format=json` (v1 envelope).
 * - Cost class comes from path-pattern classification (no CLI call).
 * - Cache key: document.uri + document.version → re-counts only when the
 *   document is saved (VS Code bumps version on every keystroke, but we
 *   intentionally do not re-count on dirty buffers to avoid spawning a
 *   subprocess per keystroke).
 *
 * Failure modes (all silent — no UI noise, just an output-channel log):
 * - binary missing  → no CodeLens (one-time install hint)
 * - version mismatch → no CodeLens (one-time upgrade warning)
 * - other errors    → no CodeLens (logged to output channel)
 */
export class TokoptCodeLensProvider implements vscode.CodeLensProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly log: vscode.OutputChannel) {}

  /** Trigger re-render of all CodeLenses (e.g. after a save or config change). */
  refresh(): void {
    this.emitter.fire();
  }

  /** Drop cached count for a single document. Called on save. */
  invalidate(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
  }

  /** Drop the entire cache. Called when configuration changes. */
  clearCache(): void {
    this.cache.clear();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration("tokopt");
    if (config.get<boolean>("codeLens.enabled", true) === false) {
      return [];
    }

    if (document.uri.scheme !== "file") {
      return [];
    }

    const klass = classifyCustomizationFile(document.uri.fsPath);
    if (!klass) {
      return [];
    }

    const count = await this.getCount(document, config);
    if (!count) {
      return [];
    }

    const range = new vscode.Range(0, 0, 0, 0);
    const headline = `▸ ${count.tokens.toLocaleString()} tokens (${klass.label}, ${klass.description})`;
    const headlineLens = new vscode.CodeLens(range, {
      title: headline,
      command: "tokopt.showBreakdown",
      arguments: [document.uri, count, klass.kind],
    });

    return [headlineLens];
  }

  private async getCount(
    document: vscode.TextDocument,
    config: vscode.WorkspaceConfiguration
  ): Promise<CountResult | null> {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.documentVersion === document.version) {
      return {
        path: document.uri.fsPath,
        encoding: "o200k_base",
        tokens: cached.tokens,
        bytes: cached.bytes,
      };
    }

    const binaryPath = config.get<string>("binaryPath", "tokopt") || "tokopt";
    const outcome = await runTokoptCount(
      binaryPath,
      document.uri.fsPath,
      this.log
    );

    if (outcome.kind !== "ok") {
      return null;
    }

    this.cache.set(key, {
      documentVersion: document.version,
      tokens: outcome.result.tokens,
      bytes: outcome.result.bytes,
    });
    return outcome.result;
  }

  dispose(): void {
    this.emitter.dispose();
    this.cache.clear();
  }
}
