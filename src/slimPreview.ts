import * as vscode from "vscode";

/**
 * `TextDocumentContentProvider` for the `tokopt-slim` URI scheme used by
 * the Preview Diff Quick Fix. The provider stores slimmed content in
 * memory keyed by the virtual URI string so VS Code's built-in diff view
 * (`vscode.diff`) can render the comparison without writing temp files.
 *
 * URI shape: `tokopt-slim:<file>?nonce=<n>`
 *   - <file> mirrors the original document's path so the diff editor
 *     shows a recognisable label (e.g. `tokopt-slim:copilot-instructions.md`).
 *   - <nonce> guarantees a fresh URI for every preview run so re-opening
 *     the preview after a re-edit does not show stale cached content.
 *
 * Entries are evicted after the diff editor for that URI closes (the
 * extension listens for `onDidCloseTextDocument` and removes the cache
 * entry).
 */
export class SlimPreviewContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  public static readonly scheme = "tokopt-slim";

  private readonly cache = new Map<string, string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;
  private nonceCounter = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.scheme === SlimPreviewContentProvider.scheme) {
          this.cache.delete(doc.uri.toString());
        }
      })
    );
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.cache.get(uri.toString()) ?? "";
  }

  /**
   * Register `content` for a fresh virtual URI derived from `original`
   * and return that URI. The caller passes it to `vscode.diff`.
   */
  publish(original: vscode.Uri, content: string): vscode.Uri {
    const nonce = String(++this.nonceCounter);
    const virtual = vscode.Uri.from({
      scheme: SlimPreviewContentProvider.scheme,
      path: original.path,
      query: `nonce=${nonce}`,
    });
    this.cache.set(virtual.toString(), content);
    this.onDidChangeEmitter.fire(virtual);
    return virtual;
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.cache.clear();
  }
}
