import * as vscode from "vscode";

/**
 * Shared one-time warning latches across every tokopt CLI invocation
 * (count, detect, audit, …). Without this, a user would see one
 * "binary missing" toast per command type — annoying and redundant.
 */
let warnedBinaryMissing = false;
let warnedVersionMismatch = false;

const INSTALL_HINT =
  "tokopt CLI not found. Install: curl -fsSL https://raw.githubusercontent.com/shinyay/tokopt/main/scripts/install.sh | sh";

export function warnBinaryMissing(): void {
  if (warnedBinaryMissing) {
    return;
  }
  warnedBinaryMissing = true;
  const action = "Show install instructions";
  vscode.window
    .showInformationMessage(INSTALL_HINT, action)
    .then((picked) => {
      if (picked === action) {
        vscode.env.openExternal(
          vscode.Uri.parse("https://github.com/shinyay/tokopt#install")
        );
      }
    });
}

export function warnVersionMismatch(supported: string, got: unknown): void {
  if (warnedVersionMismatch) {
    return;
  }
  warnedVersionMismatch = true;
  vscode.window.showWarningMessage(
    `tokopt-vscode supports format_version "${supported}", but the tokopt CLI emitted ${JSON.stringify(got)}. CodeLens and diagnostics are disabled until the extension is updated.`
  );
}

/** Reset latches; exposed for tests and for configuration changes that
 * effectively reset the runtime (e.g. user changed `tokopt.binaryPath`). */
export function resetWarnings(): void {
  warnedBinaryMissing = false;
  warnedVersionMismatch = false;
}
