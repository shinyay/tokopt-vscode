import * as path from "node:path";
import * as vscode from "vscode";
import { runTokoptAudit } from "./audit.js";
import { runTokoptDetect } from "./detect.js";
import { runReportByModel } from "./bymodel.js";
import { buildDashboardData, renderDashboardHtml } from "./dashboardHtml.js";
import { resolveCredit } from "./creditConfig.js";

/** Cryptographically-cheap nonce for the webview CSP. */
function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/**
 * Owns the singleton Token Optimization Dashboard webview. Composes
 * `tokopt audit --credit-model` + `tokopt detect` (the same data path as
 * the markdown report) and renders a graphical HTML dashboard with inline
 * SVG charts.
 *
 * Interactions (webview → extension):
 *   - openFile           → open the clicked file
 *   - refresh            → re-run audit/detect and re-render
 *   - setModel           → update `tokopt.creditModel` then re-render
 *   - setRequestsPerDay  → update `tokopt.requestsPerDay` then re-render
 */
export class TokoptDashboard implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private refreshing = false;

  constructor(
    private readonly log: vscode.OutputChannel,
    private readonly resolveBinary: () => string
  ) {}

  /** Create (or reveal an existing) dashboard panel, then refresh. */
  async show(): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (this.panel) {
      this.panel.reveal(column);
      await this.refresh();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "tokoptDashboard",
      "Token Optimization",
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.disposeChildren();
      },
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.handleMessage(msg),
      null,
      this.disposables
    );

    await this.refresh();
  }

  /** Re-render if the panel is open (e.g. after a save). No-op otherwise. */
  async refreshIfOpen(): Promise<void> {
    if (this.panel) {
      await this.refresh();
    }
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case "openFile": {
        if (typeof m.path === "string") {
          await this.openFile(m.path);
        }
        return;
      }
      case "refresh":
        await this.refresh();
        return;
      case "openReport":
        await vscode.commands.executeCommand("tokopt.showOptimizationReport");
        return;
      case "setModel": {
        // Defense-in-depth: the value originates from our own webview, but
        // cap length and reject control chars before persisting to config.
        if (
          typeof m.model === "string" &&
          m.model.length <= 80 &&
          !/[\u0000-\u001f]/.test(m.model)
        ) {
          await vscode.workspace
            .getConfiguration("tokopt")
            .update(
              "creditModel",
              m.model,
              vscode.ConfigurationTarget.Workspace
            );
          await this.refresh();
        }
        return;
      }
      case "setRequestsPerDay": {
        if (typeof m.value === "number" && Number.isFinite(m.value)) {
          await vscode.workspace
            .getConfiguration("tokopt")
            .update(
              "requestsPerDay",
              Math.max(0, Math.round(m.value)),
              vscode.ConfigurationTarget.Workspace
            );
          await this.refresh();
        }
        return;
      }
      default:
        return;
    }
  }

  /** Resolve a (possibly root-relative) path against the first folder. */
  private async openFile(target: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const abs = path.isAbsolute(target)
      ? target
      : folder
        ? path.join(folder.uri.fsPath, target)
        : target;
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(abs)
      );
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      this.log.appendLine(`dashboard openFile failed for ${abs}: ${String(err)}`);
    }
  }

  private async refresh(): Promise<void> {
    if (!this.panel || this.refreshing) return;
    this.refreshing = true;
    try {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        this.panel.webview.html = this.shell(
          "Open a folder to analyze its Copilot customization cost."
        );
        return;
      }
      const config = vscode.workspace.getConfiguration("tokopt");
      const binaryPath = this.resolveBinary();
      const credit = resolveCredit(config, this.log);
      const creditModel = credit.model;
      const requestsPerDay = credit.requestsPerDay;

      const [auditOutcome, detectOutcome, modelRows] = await Promise.all([
        runTokoptAudit(
          binaryPath,
          folder.uri.fsPath,
          this.log,
          creditModel,
          credit.ratesPath
        ),
        runTokoptDetect(binaryPath, folder.uri.fsPath, this.log),
        runReportByModel(
          binaryPath,
          folder.uri.fsPath,
          this.log,
          credit.ratesPath
        ),
      ]);

      if (auditOutcome.kind !== "ok") {
        this.panel.webview.html = this.shell(
          `Could not run <code>tokopt audit</code> (${auditOutcome.kind}). ` +
            `Check the “tokopt” output channel and that the binary is on PATH.`
        );
        return;
      }
      const findings =
        detectOutcome.kind === "ok" ? detectOutcome.findings : [];

      const data = buildDashboardData(auditOutcome.result, findings, {
        creditModel: creditModel === "none" ? undefined : creditModel,
        requestsPerDay,
        generatedAt: new Date().toISOString(),
        availableModels: credit.available,
        availableModelsBasis: credit.basisByModel,
        modelComparison: modelRows,
      });

      const nonce = makeNonce();
      this.panel.webview.html = renderDashboardHtml(data, {
        cspSource: this.panel.webview.cspSource,
        nonce,
      });
    } finally {
      this.refreshing = false;
    }
  }

  /** Minimal themed shell for error / empty states. */
  private shell(message: string): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-editor-background); padding: 24px; }
  .box { border: 1px solid var(--vscode-panel-border); border-radius: 8px;
    padding: 20px; max-width: 560px; }
  code { font-family: var(--vscode-editor-font-family, monospace); }
</style></head>
<body><h1>🪙 Token Optimization Dashboard</h1>
<div class="box">${message}</div></body></html>`;
  }

  private disposeChildren(): void {
    while (this.disposables.length) {
      try {
        this.disposables.pop()?.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    this.disposeChildren();
    this.panel?.dispose();
    this.panel = undefined;
  }
}
