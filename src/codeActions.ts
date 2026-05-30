import * as vscode from "vscode";
import { isSuppressionSupported } from "./suppressions.js";

const SOURCE = "tokopt";

/**
 * Finding IDs whose primary remediation is the mechanical compression
 * provided by `tokopt slim`. The Quick Fix offers an Apply + Preview
 * action only for these. Everything else gets Suppress + Learn More so
 * the user is gently steered toward a human-judgment fix.
 *
 * Deliberately excluded:
 *
 *  - `mcp-*` and `verbose-tool-descriptions` live in JSON / YAML config
 *    files. `tokopt slim` on JSON would route through TonForm, which can
 *    transform valid JSON into TOON — applying the whole-file rewrite
 *    would break MCP config. Restructuring (dropping servers, shortening
 *    description fields by hand) is the only safe fix here.
 *  - `possible-policy-tension`, `reasoning-leakage`, `polite-filler`,
 *    `format-inflation` all flag specific behavioural phrases. Slim's
 *    stopword stripping won't touch them — these are meaningful words
 *    in context, not boilerplate.
 */
export const SLIM_FIXABLE: ReadonlySet<string> = new Set<string>([
  "kitchen-sink-system-prompt",
  "verbose-auto-generated-instructions",
  "huge-agents-md",
]);

/**
 * Build the "Learn more" URL for a finding. The companion chapter lives
 * in shinyay/getting-started-with-token-optimization. We deliberately do
 * NOT try to anchor to a finding-specific subsection: the `chapter_ref`
 * field on detect findings (e.g. "Ch 14 #11" for reasoning-leakage) has
 * drifted from the actual numbered headings in the chapter, so anchored
 * URLs would 404 silently. The reader can scan or Ctrl+F.
 */
function learnMoreUrl(): string {
  return "https://github.com/shinyay/getting-started-with-token-optimization/blob/main/docs/14-anti-patterns-and-pitfalls.md";
}

export class TokoptCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const tokoptDiags = context.diagnostics.filter(
      (d) => d.source === SOURCE && typeof d.code === "string" && d.code
    );
    if (tokoptDiags.length === 0) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // Slim is file-scoped — running it twice (or showing two identical
    // Preview/Apply rows) makes no sense. If ANY visible diagnostic is
    // slim-fixable, emit a SINGLE Preview + single Apply attributed to
    // all slim-fixable diagnostics in scope. Suppress + Learn more
    // remain per-finding because they're finding-specific.
    const slimDiags = tokoptDiags.filter(
      (d) => SLIM_FIXABLE.has(d.code as string)
    );
    if (slimDiags.length > 0) {
      const preview = new vscode.CodeAction(
        `Preview tokopt slim diff for this file`,
        vscode.CodeActionKind.QuickFix
      );
      preview.diagnostics = slimDiags;
      preview.command = {
        title: "Preview slim diff",
        command: "tokopt.previewSlim",
        arguments: [document.uri],
      };
      actions.push(preview);

      const apply = new vscode.CodeAction(
        `Apply tokopt slim suggestion`,
        vscode.CodeActionKind.QuickFix
      );
      apply.diagnostics = slimDiags;
      apply.command = {
        title: "Apply slim",
        command: "tokopt.applySlim",
        arguments: [document.uri],
      };
      actions.push(apply);
    }

    const suppressAvailable = isSuppressionSupported(document.uri.fsPath);
    const seenSuppressIds = new Set<string>();
    const seenLearnIds = new Set<string>();
    for (const diag of tokoptDiags) {
      const id = diag.code as string;
      if (suppressAvailable && !seenSuppressIds.has(id)) {
        seenSuppressIds.add(id);
        const suppress = new vscode.CodeAction(
          `Suppress \`${id}\` for this file`,
          vscode.CodeActionKind.QuickFix
        );
        suppress.diagnostics = [diag];
        suppress.command = {
          title: "Suppress finding",
          command: "tokopt.suppressFinding",
          arguments: [document.uri, id],
        };
        actions.push(suppress);
      }
      if (!seenLearnIds.has(id)) {
        seenLearnIds.add(id);
        const learn = new vscode.CodeAction(
          `Learn more about \`${id}\` (Ch 14)`,
          vscode.CodeActionKind.QuickFix
        );
        learn.diagnostics = [diag];
        learn.command = {
          title: "Learn more",
          command: "tokopt.learnMore",
          arguments: [id],
        };
        actions.push(learn);
      }
    }
    return actions;
  }
}

export { learnMoreUrl };
