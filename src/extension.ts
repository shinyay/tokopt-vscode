import * as vscode from "vscode";
import { TokoptCodeLensProvider } from "./codeLens.js";
import { CountResult } from "./tokopt.js";
import { CustomizationKind, classifyCustomizationFile } from "./customizationFiles.js";
import { TokoptDiagnosticManager } from "./diagnostics.js";
import { resetWarnings } from "./warnings.js";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("tokopt");
  context.subscriptions.push(log);

  const provider = new TokoptCodeLensProvider(log);
  context.subscriptions.push(provider);

  const diagnostics = new TokoptDiagnosticManager(log);
  context.subscriptions.push(diagnostics);

  // Markdown selector — provider does its own path-based filtering inside.
  const selector: vscode.DocumentSelector = [
    { language: "markdown", scheme: "file" },
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, provider)
  );

  // Refresh on save:
  //   - CodeLens: invalidate cache for the saved file, re-trigger.
  //   - Diagnostics: re-run detect against the whole workspace, but only
  //     when the saved file is a Copilot customization asset (avoids
  //     thrashing detect on every unrelated edit).
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      provider.invalidate(doc.uri);
      provider.refresh();
      if (classifyCustomizationFile(doc.uri.fsPath)) {
        void diagnostics.refresh();
      }
    })
  );

  // Refresh on configuration change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("tokopt")) {
        return;
      }
      // Pointing at a different binary effectively resets runtime, so
      // re-arm the one-time warning latches — otherwise a new bad path
      // would silently fail without ever toasting the user.
      if (e.affectsConfiguration("tokopt.binaryPath")) {
        resetWarnings();
      }
      provider.clearCache();
      provider.refresh();
      void diagnostics.refresh();
    })
  );

  // Initial diagnostic scan on activation (best-effort; no blocking).
  void diagnostics.refresh();

  // Click handler for the headline CodeLens.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.showBreakdown",
      (uri: vscode.Uri, count: CountResult, kind: CustomizationKind) => {
        const filename = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
        const bytesPerToken = count.bytes / Math.max(count.tokens, 1);
        const detail = [
          `File: ${filename}`,
          `Tokens: ${count.tokens.toLocaleString()} (${kind})`,
          `Bytes: ${count.bytes.toLocaleString()} (${bytesPerToken.toFixed(2)} bytes/token, encoding ${count.encoding})`,
          ``,
          `Cost class: ${kind}`,
          kind === "always-on"
            ? "  • Multiplied by every Copilot request — highest leverage to slim."
            : kind === "conditional"
              ? "  • Only paid when the agent is explicitly invoked."
              : "  • Only paid when the skill is triggered or the slash command is run.",
          ``,
          `Run \`tokopt anatomy --user "${uri.fsPath}"\` for a per-segment breakdown,`,
          `or \`tokopt detect "${uri.fsPath}"\` to surface structural anti-patterns.`,
        ].join("\n");
        vscode.window.showInformationMessage(detail, { modal: true });
      }
    )
  );

  // Manual diagnostic commands (also surface in the command palette).
  context.subscriptions.push(
    vscode.commands.registerCommand("tokopt.refreshDiagnostics", () => {
      void diagnostics.refresh();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("tokopt.clearDiagnostics", () => {
      diagnostics.clear();
    })
  );

  log.appendLine(
    `tokopt-vscode activated (CodeLens enabled: ${vscode.workspace
      .getConfiguration("tokopt")
      .get<boolean>("codeLens.enabled", true)}, Diagnostics enabled: ${vscode.workspace
      .getConfiguration("tokopt")
      .get<boolean>("diagnostics.enabled", true)})`
  );
}

export function deactivate(): void {
  // All disposables are tracked in context.subscriptions.
}
