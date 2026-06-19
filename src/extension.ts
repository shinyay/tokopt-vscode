import * as vscode from "vscode";
import { TokoptCodeLensProvider } from "./codeLens.js";
import { CountResult } from "./tokopt.js";
import { CustomizationKind, classifyCustomizationFile } from "./customizationFiles.js";
import {
  formatAiu,
  formatUsd,
  nanoAiuToAiu,
  nanoAiuToUsd,
  projectMonthlyAiu,
  projectMonthlyUsd,
} from "./credit.js";
import { TokoptDiagnosticManager } from "./diagnostics.js";
import { TokoptStatusBarManager } from "./statusBar.js";
import {
  TokenCostTreeProvider,
  TOKEN_COST_WATCHER_GLOB,
  TokenCostNode,
} from "./tokenCost.js";
import { runTokoptDetect } from "./detect.js";
import { runTokoptAudit } from "./audit.js";
import { renderOptimizationReport } from "./optimizationReport.js";
import { resetWarnings } from "./warnings.js";
import {
  SLIM_FIXABLE,
  TokoptCodeActionProvider,
  learnMoreUrl,
} from "./codeActions.js";
import { SlimPreviewContentProvider } from "./slimPreview.js";
import { runTokoptSlim } from "./slim.js";
import { formatSuppressionComment } from "./suppressions.js";

function resolveBinary(): string {
  const config = vscode.workspace.getConfiguration("tokopt");
  return config.get<string>("binaryPath", "tokopt") || "tokopt";
}

/**
 * Markdown-family languageIds that hold Copilot customization prose.
 *
 * VS Code Insiders 1.117+ and the official `github.copilot-chat` extension
 * register dedicated languageIds for these filename patterns:
 *   - `agent`        → `*.agent.md` (legacy)
 *   - `chatagent`    → `*.agent.md` AND `*.chatmode.md` (current — GH Copilot
 *                       Chat 1.125+ uses this internal id; "Agent" is the
 *                       display name only — see #28 and #29)
 *   - `instructions` → `copilot-instructions.md`, `instructions.md`
 *   - `chatmode`     → `*.chatmode.md` (legacy — being deprecated by GH
 *                       Copilot Chat to `chatagent`)
 *   - `prompt`       → `*.prompt.md`              (added in v0.6.5, #26)
 *   - `skill`        → `SKILL.md`                 (added in v0.6.5, #27)
 *
 * Providers that previously matched `language: "markdown"` only would
 * silently fail on the exact files this extension is most valuable for.
 * See:
 *   - https://github.com/shinyay/tokopt-vscode/issues/18 (instructions/agent)
 *   - https://github.com/shinyay/tokopt-vscode/issues/26 (prompt)
 *   - https://github.com/shinyay/tokopt-vscode/issues/27 (skill)
 *   - https://github.com/shinyay/tokopt-vscode/issues/28 (chatagent vs agent —
 *                       the GH Copilot Chat extension exposes display name
 *                       "Agent" but internal id `chatagent`, which a naive
 *                       inspector cannot see without clicking through
 *                       Select Language Mode)
 *   - https://github.com/shinyay/tokopt-vscode/issues/29 (chatmode→agent
 *                       deprecation: `*.chatmode.md` now also gets
 *                       `chatagent` languageId via the same registration)
 *
 * On older VS Code versions these languageIds are not registered, and
 * the entries are simply unused (no negative effect on coverage because
 * `markdown` still matches everything as a fallback there).
 */
const COPILOT_CUSTOMIZATION_LANGS: readonly vscode.DocumentFilter[] = [
  { language: "markdown", scheme: "file" },
  { language: "agent", scheme: "file" },
  { language: "chatagent", scheme: "file" },
  { language: "instructions", scheme: "file" },
  { language: "chatmode", scheme: "file" },
  { language: "prompt", scheme: "file" },
  { language: "skill", scheme: "file" },
];

const COPILOT_CUSTOMIZATION_LANG_IDS: ReadonlySet<string> = new Set(
  COPILOT_CUSTOMIZATION_LANGS.map((f) => f.language as string)
);

/**
 * Defense-in-depth check matching the SLIM_FIXABLE allow-list semantics.
 * The CodeActionProvider only offers Apply/Preview when a SLIM_FIXABLE
 * diagnostic is present (all 3 of which target markdown). This guard
 * makes the same constraint hold for any programmatic invocation of
 * `tokopt.applySlim` / `tokopt.previewSlim` (e.g. keybinding, another
 * extension calling executeCommand) so that a JSON / YAML MCP config
 * cannot be silently rewritten through TonForm.
 *
 * Accepts the four markdown-family languageIds because Copilot
 * customization files (`*.agent.md`, `copilot-instructions.md`,
 * `*.chatmode.md`) are markdown-on-disk; the slim pipeline already
 * routes them safely via path-based emphasis detection.
 */
function isSlimSafeTarget(doc: vscode.TextDocument): boolean {
  if (COPILOT_CUSTOMIZATION_LANG_IDS.has(doc.languageId)) {
    return true;
  }
  const lower = doc.uri.fsPath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

/**
 * Per-URI in-flight tracker for applySlim/previewSlim. A second click on
 * the same file while a slim run is in flight is silently ignored — we
 * don't want two replace-whole-buffer edits racing each other.
 */
const slimInFlight = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("tokopt");
  context.subscriptions.push(log);

  const provider = new TokoptCodeLensProvider(log);
  context.subscriptions.push(provider);

  const diagnostics = new TokoptDiagnosticManager(log);
  context.subscriptions.push(diagnostics);

  const statusBar = new TokoptStatusBarManager(log);
  context.subscriptions.push(statusBar);

  const tokenCost = new TokenCostTreeProvider(log, resolveBinary);
  context.subscriptions.push(tokenCost);
  const tokenCostView = vscode.window.createTreeView("tokoptTokenCost", {
    treeDataProvider: tokenCost,
    showCollapseAll: true,
  });
  context.subscriptions.push(tokenCostView);
  context.subscriptions.push(
    tokenCostView.onDidChangeVisibility((e) =>
      tokenCost.onVisibilityChange(e.visible)
    )
  );
  // The visibility event is not guaranteed to fire an initial "currently
  // visible" tick. If activation happened via `onView:tokoptTokenCost`
  // (user opened the panel as the trigger), the view is already visible
  // when we get here; explicitly seed the latch.
  if (tokenCostView.visible) {
    tokenCost.onVisibilityChange(true);
  }

  // FileSystemWatcher for the token-cost tree — broader glob than the
  // status bar's strict tax (audit walks recursively, so any *.agent.md
  // or SKILL.md anywhere should refresh the tree).
  const tokenCostWatcher = vscode.workspace.createFileSystemWatcher(
    TOKEN_COST_WATCHER_GLOB
  );
  context.subscriptions.push(tokenCostWatcher);
  context.subscriptions.push(
    tokenCostWatcher.onDidCreate(() => tokenCost.scheduleRefresh()),
    tokenCostWatcher.onDidChange(() => tokenCost.scheduleRefresh()),
    tokenCostWatcher.onDidDelete(() => tokenCost.scheduleRefresh())
  );

  // Watch the strict always-on locations for create/change/delete events
  // outside of save-listener coverage (external edits, file deletions,
  // git checkout flipping files in/out). Save events also fire here for
  // internal edits — the debounce inside scheduleRefresh collapses both
  // into a single refresh.
  const watcher = vscode.workspace.createFileSystemWatcher(
    TokoptStatusBarManager.watcherGlob()
  );
  context.subscriptions.push(watcher);
  context.subscriptions.push(
    watcher.onDidCreate((uri) => {
      if (statusBar.isStrictAlwaysOnPath(uri.fsPath)) {
        statusBar.scheduleRefresh();
      }
    }),
    watcher.onDidChange((uri) => {
      if (statusBar.isStrictAlwaysOnPath(uri.fsPath)) {
        statusBar.scheduleRefresh();
      }
    }),
    watcher.onDidDelete((uri) => {
      if (statusBar.isStrictAlwaysOnPath(uri.fsPath)) {
        statusBar.invalidate(uri.fsPath);
        statusBar.scheduleRefresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      statusBar.clearCache();
      void statusBar.refresh();
      void statusBar.updateCurrentFile();
      tokenCost.clearCache();
    })
  );

  const slimPreview = new SlimPreviewContentProvider();
  context.subscriptions.push(slimPreview);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      SlimPreviewContentProvider.scheme,
      slimPreview
    )
  );

  // Markdown-family selector — provider does its own path-based filtering
  // inside. Covers `markdown` plus the dedicated languageIds VS Code 1.117+
  // assigns to Copilot customization files (see COPILOT_CUSTOMIZATION_LANGS
  // and #18 for the silent-failure history).
  const codeLensSelector: vscode.DocumentSelector = [
    ...COPILOT_CUSTOMIZATION_LANGS,
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(codeLensSelector, provider)
  );

  // Quick-Fix provider deliberately covers the markdown family + json + yaml
  // because detect findings target all of them (markdown family for
  // instructions/agents/chatmodes, json/yaml for MCP config). The provider
  // itself only returns actions when context.diagnostics contains a
  // `source === "tokopt"` entry, so there's no per-file gating to think
  // about — the data does the work.
  const codeActionSelector: vscode.DocumentSelector = [
    ...COPILOT_CUSTOMIZATION_LANGS,
    { language: "json", scheme: "file" },
    { language: "jsonc", scheme: "file" },
    { language: "yaml", scheme: "file" },
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      codeActionSelector,
      new TokoptCodeActionProvider(),
      { providedCodeActionKinds: TokoptCodeActionProvider.providedCodeActionKinds }
    )
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
      // Refresh diagnostics when EITHER the file is a recognised
      // customization asset OR it currently has tokopt diagnostics
      // published. The second clause catches:
      //   • files flagged by a rule whose target isn't (yet) in
      //     classifyCustomizationFile,
      //   • suppression edits (the user just added <!-- tokopt:disable=… -->),
      //   • slim-apply edits that should drop or reshape existing findings.
      if (
        classifyCustomizationFile(doc.uri.fsPath) ||
        diagnostics.hasDiagnosticsFor(doc.uri)
      ) {
        void diagnostics.refresh();
      }
      // Status bar: only refresh the tax when the saved file is a strict
      // always-on candidate — unrelated saves (e.g. foo.ts) must not
      // invalidate the cache (would cancel in-flight scans by bumping
      // generation) or trigger a wasted scan. Current-file appendix is
      // recomputed unconditionally; it's cheap thanks to the mtime cache.
      if (statusBar.isStrictAlwaysOnPath(doc.uri.fsPath)) {
        statusBar.invalidate(doc.uri.fsPath);
        statusBar.scheduleRefresh();
      }
      void statusBar.updateCurrentFile();

      // Token-cost tree: refresh when the saved file is anywhere the
      // CLI walker would pick up (broader than status bar). Permissive
      // classifier here is intentional — false positives are a wasted
      // audit, false negatives leave the tree stale after the user
      // creates a new customization file.
      if (classifyCustomizationFile(doc.uri.fsPath)) {
        tokenCost.scheduleRefresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void statusBar.updateCurrentFile(editor);
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
      statusBar.clearCache();
      void statusBar.refresh();
      void statusBar.updateCurrentFile();
      tokenCost.clearCache();
    })
  );

  // Initial diagnostic scan on activation (best-effort; no blocking).
  void diagnostics.refresh();
  void statusBar.refresh();
  void statusBar.updateCurrentFile();
  // Token-cost tree refresh is LAZY: deferred until the view becomes
  // visible (rubber-duck H#1 — don't audit large workspaces for users
  // who never open the panel). `onDidChangeVisibility` above handles
  // the first-open trigger.

  // Click handler for the headline CodeLens.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.showBreakdown",
      (uri: vscode.Uri, count: CountResult, kind: CustomizationKind) => {
        const filename = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
        const bytesPerToken = count.bytes / Math.max(count.tokens, 1);
        const lines = [
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
        ];

        // Cost projection section (Feature: credit projection). Only shown
        // when a credit model is configured and the CLI returned nano-AIU.
        if (count.nanoAiu && count.nanoAiu > 0) {
          const config = vscode.workspace.getConfiguration("tokopt");
          const requestsPerDay = config.get<number>("requestsPerDay", 200);
          const aiu = nanoAiuToAiu(count.nanoAiu);
          const usd = nanoAiuToUsd(count.nanoAiu);
          lines.push(
            ``,
            `Cost projection (model: ${count.creditModel ?? "?"}):`,
            `  • ${formatAiu(aiu)} ≈ ${formatUsd(usd)} per ${
              kind === "always-on"
                ? "request"
                : kind === "conditional"
                  ? "invocation"
                  : "use"
            }`
          );
          if (kind === "always-on") {
            const monthlyAiu = projectMonthlyAiu(count.nanoAiu, requestsPerDay);
            const monthlyUsd = projectMonthlyUsd(count.nanoAiu, requestsPerDay);
            lines.push(
              `  • At ${requestsPerDay.toLocaleString()} requests/day → ${formatAiu(
                monthlyAiu
              )} ≈ ${formatUsd(monthlyUsd)} per month`,
              `    (always-on tax is paid on every request — slimming this file compounds)`
            );
          }
        }

        lines.push(
          ``,
          `Run \`tokopt anatomy "${uri.fsPath}"\` for a per-segment breakdown (auto-classifies the segment),`,
          `or \`tokopt detect "${uri.fsPath}"\` to surface structural anti-patterns.`
        );
        vscode.window.showInformationMessage(lines.join("\n"), { modal: true });
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

  context.subscriptions.push(
    vscode.commands.registerCommand("tokopt.refreshStatusBar", () => {
      statusBar.clearCache();
      void statusBar.refresh();
      void statusBar.updateCurrentFile();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("tokopt.showStatusBarBreakdown", () => {
      statusBar.showBreakdown();
    })
  );

  // ---- Workspace Optimization Report ----------------------------------
  //
  // Composes `tokopt audit --credit-model X` (cost) with `tokopt detect`
  // (savings) into a single markdown document opened in a new editor tab.
  // This is the "executive dashboard" surface: where the tokens go, what
  // to trim, and how much it saves — in tokens AND AI Credits / USD.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.showOptimizationReport",
      async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode.window.showWarningMessage(
            "tokopt: open a folder to generate an optimization report."
          );
          return;
        }
        const config = vscode.workspace.getConfiguration("tokopt");
        const binaryPath =
          config.get<string>("binaryPath", "tokopt") || "tokopt";
        const creditModel = config.get<string>("creditModel", "none");
        const requestsPerDay = config.get<number>("requestsPerDay", 200);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "tokopt: building optimization report…",
          },
          async () => {
            const root = folder.uri.fsPath;
            const [auditOutcome, detectOutcome] = await Promise.all([
              runTokoptAudit(binaryPath, root, log, creditModel),
              runTokoptDetect(binaryPath, root, log),
            ]);

            if (auditOutcome.kind !== "ok") {
              void vscode.window.showErrorMessage(
                `tokopt: could not run audit (${auditOutcome.kind}). See the tokopt output channel.`
              );
              return;
            }
            const findings =
              detectOutcome.kind === "ok" ? detectOutcome.findings : [];

            const markdown = renderOptimizationReport(
              auditOutcome.result,
              findings,
              {
                requestsPerDay,
                creditModel:
                  creditModel === "none" ? undefined : creditModel,
                generatedAt: new Date().toISOString(),
              }
            );

            const doc = await vscode.workspace.openTextDocument({
              language: "markdown",
              content: markdown,
            });
            await vscode.window.showTextDocument(doc, { preview: false });
          }
        );
      }
    )
  );

  // ---- Token-cost TreeView commands -----------------------------------
  //
  // openFile / slimFile / detectFile are wired to the per-row context
  // menu via package.json `menus.view/item/context`. VS Code passes the
  // resolved TokenCostNode as the first argument. Refresh + showAuditPanel
  // are palette-visible and don't take arguments.

  context.subscriptions.push(
    vscode.commands.registerCommand("tokopt.tree.refresh", () => {
      // clearCache() bumps the generation counter, drops the per-folder
      // map, and (if the view has ever been opened) triggers a fresh
      // audit. The refresh() mutex coalesces concurrent calls so no
      // explicit second refresh is needed here.
      tokenCost.clearCache();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.tree.openFile",
      async (node?: TokenCostNode) => {
        if (!node || node.kind !== "file") return;
        await vscode.commands.executeCommand(
          "vscode.open",
          vscode.Uri.file(node.absPath)
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.tree.slimFile",
      async (node?: TokenCostNode) => {
        if (!node || node.kind !== "file") return;
        if (!node.isMarkdown) {
          // Defense in depth — the context menu only surfaces slim on
          // tokoptFileMarkdown via the `when` clause in package.json,
          // but a keybinding or executeCommand could still hit this.
          vscode.window.showWarningMessage(
            "tokopt slim only operates on markdown files. This file is not slim-safe."
          );
          return;
        }
        await vscode.commands.executeCommand(
          "tokopt.applySlim",
          vscode.Uri.file(node.absPath)
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.tree.detectFile",
      async (node?: TokenCostNode) => {
        if (!node || node.kind !== "file") return;
        // tokopt v0.5.1+ supports `detect <FILE>` with binary-side root
        // inference + greppy narrowing (shipped in PR #106 of
        // shinyay/getting-started-with-token-optimization). Older
        // binaries return a v1 error envelope which surfaces as
        // outcome.kind === "error" with a "FILE_NOT_FOUND" /
        // "not a directory" message — we add an upgrade hint below.
        const outcome = await runTokoptDetect(
          resolveBinary(),
          node.absPath,
          log
        );
        log.show(true);
        log.appendLine("");
        log.appendLine(`=== tokopt detect (${node.relPath}) ===`);
        if (outcome.kind !== "ok") {
          log.appendLine(`detect did not return findings: ${outcome.kind}`);
          if (outcome.kind === "error") {
            log.appendLine(outcome.message);
            if (/not a directory|FILE_NOT_FOUND/i.test(outcome.message)) {
              log.appendLine(
                "Hint: per-file Quick Detect requires tokopt v0.5.1 or newer. " +
                  "Upgrade with: curl -fsSL https://raw.githubusercontent.com/shinyay/tokopt/main/scripts/install.sh | sh"
              );
            }
          }
          return;
        }
        if (outcome.findings.length === 0) {
          log.appendLine(
            "(no findings for this file — congrats, it's clean)"
          );
          return;
        }
        for (const f of outcome.findings) {
          log.appendLine(
            `[${f.severity.toUpperCase()}] ${f.id}: ${f.title}`
          );
          log.appendLine(`  recommendation: ${f.recommendation}`);
          if (f.est_tokens_saved > 0) {
            log.appendLine(
              `  estimated savings: ${f.est_tokens_saved.toLocaleString()} tokens`
            );
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokopt.tree.showAuditPanel", () => {
      tokenCost.showAuditDump(log);
    })
  );

  // Quick-Fix commands.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.applySlim",
      async (uri?: vscode.Uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
          vscode.window.showWarningMessage(
            "tokopt: no file selected for Apply slim."
          );
          return;
        }
        await applySlim(target, log);
        // The post-apply file is in-memory (not saved). Save listener will
        // refresh diagnostics once the user persists the edit.
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.previewSlim",
      async (uri?: vscode.Uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
          vscode.window.showWarningMessage(
            "tokopt: no file selected for Preview slim."
          );
          return;
        }
        await previewSlim(target, slimPreview, log);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.suppressFinding",
      async (uri?: vscode.Uri, id?: string) => {
        if (!uri || !id) {
          vscode.window.showWarningMessage(
            "tokopt: suppress action invoked without a finding."
          );
          return;
        }
        await suppressFinding(uri, id);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokopt.learnMore",
      async (_id?: string) => {
        await vscode.env.openExternal(vscode.Uri.parse(learnMoreUrl()));
      }
    )
  );

  // Log the effective state — AND the extension's own setting with VS Code's
  // global `editor.codeLens`. Without this, `editor.codeLens=false` silently
  // suppresses all CodeLens rendering while the log still claims it's enabled,
  // misleading anyone debugging missing CodeLens. See
  // https://github.com/shinyay/tokopt-vscode/issues/20.
  const tokoptCodeLensEnabled = vscode.workspace
    .getConfiguration("tokopt")
    .get<boolean>("codeLens.enabled", true);
  const editorCodeLensEnabled = vscode.workspace
    .getConfiguration("editor")
    .get<boolean>("codeLens", true);
  const codeLensEffective = tokoptCodeLensEnabled && editorCodeLensEnabled;
  const codeLensSuppressionHint =
    tokoptCodeLensEnabled && !editorCodeLensEnabled
      ? " (global editor.codeLens=false suppresses rendering)"
      : "";
  const diagnosticsEnabled = vscode.workspace
    .getConfiguration("tokopt")
    .get<boolean>("diagnostics.enabled", true);

  log.appendLine(
    `tokopt-vscode activated (CodeLens enabled: ${codeLensEffective}${codeLensSuppressionHint}, Diagnostics enabled: ${diagnosticsEnabled}, Quick Fix: ${SLIM_FIXABLE.size} slim-fixable rule(s) registered)`
  );
}

/**
 * Run slim on the on-disk version of `uri` and replace the editor buffer
 * with the compressed content as a single, undoable WorkspaceEdit. Refuses
 * to overwrite an unsaved buffer — the user is prompted to save first so
 * slim runs against the bytes they intend to ship. Aborts if the buffer
 * changes between save and edit-application (race detection).
 */
async function applySlim(
  uri: vscode.Uri,
  log: vscode.OutputChannel
): Promise<void> {
  const key = uri.toString();
  if (slimInFlight.has(key)) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  if (!isSlimSafeTarget(doc)) {
    vscode.window.showWarningMessage(
      `tokopt slim only operates on markdown files. ${doc.languageId} files are not slim-safe (would route through TonForm and may break valid config).`
    );
    return;
  }
  if (doc.isDirty) {
    const pick = await vscode.window.showWarningMessage(
      "tokopt slim runs on the saved file. Save this file before applying?",
      { modal: true },
      "Save and apply",
      "Cancel"
    );
    if (pick !== "Save and apply") {
      return;
    }
    const saved = await doc.save();
    if (!saved) {
      return;
    }
  }

  // Snapshot the buffer state we just slim'd against. If the user types
  // into the document during the async slim run, applying the whole-buffer
  // replace would silently discard their edits.
  const baselineVersion = doc.version;

  slimInFlight.add(key);
  let slim;
  try {
    slim = await runTokoptSlim(resolveBinary(), uri.fsPath, log);
  } finally {
    slimInFlight.delete(key);
  }
  if (slim.kind !== "ok") {
    if (slim.kind === "error") {
      vscode.window.showErrorMessage(
        `tokopt slim failed (see "tokopt" output channel for details).`
      );
    }
    return;
  }
  if (slim.savedTokens <= 0 || slim.compressed === doc.getText()) {
    vscode.window.showInformationMessage(
      "tokopt slim found no mechanical savings for this file. Consider restructuring instead."
    );
    return;
  }
  if (doc.version !== baselineVersion) {
    vscode.window.showWarningMessage(
      "tokopt: file was edited while slim was running. Re-run Apply slim to apply against the current buffer."
    );
    return;
  }

  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, fullRange, slim.compressed);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showErrorMessage(
      "tokopt: workspace edit refused; file may be read-only."
    );
    return;
  }
  vscode.window.showInformationMessage(
    `tokopt slim: -${slim.savedTokens} tokens (${slim.savedPercent.toFixed(1)}%). Mechanical compression only — structural findings may persist.`
  );
}

async function previewSlim(
  uri: vscode.Uri,
  preview: SlimPreviewContentProvider,
  log: vscode.OutputChannel
): Promise<void> {
  const key = uri.toString();
  if (slimInFlight.has(key)) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  if (!isSlimSafeTarget(doc)) {
    vscode.window.showWarningMessage(
      `tokopt slim only operates on markdown files. ${doc.languageId} files are not slim-safe (would route through TonForm and may break valid config).`
    );
    return;
  }
  if (doc.isDirty) {
    const pick = await vscode.window.showWarningMessage(
      "tokopt slim runs on the saved file. Save this file before previewing?",
      { modal: true },
      "Save and preview",
      "Cancel"
    );
    if (pick !== "Save and preview") {
      return;
    }
    const saved = await doc.save();
    if (!saved) {
      return;
    }
  }

  slimInFlight.add(key);
  let slim;
  try {
    slim = await runTokoptSlim(resolveBinary(), uri.fsPath, log);
  } finally {
    slimInFlight.delete(key);
  }
  if (slim.kind !== "ok") {
    if (slim.kind === "error") {
      vscode.window.showErrorMessage(
        `tokopt slim failed (see "tokopt" output channel for details).`
      );
    }
    return;
  }
  const virtual = preview.publish(uri, slim.compressed);
  const filename = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
  await vscode.commands.executeCommand(
    "vscode.diff",
    uri,
    virtual,
    `${filename} ↔ tokopt slim (-${slim.savedTokens} tokens, ${slim.savedPercent.toFixed(1)}%)`,
    { preview: true }
  );
}

/**
 * Append `<!-- tokopt:disable=<id> -->` to the document via an in-memory
 * WorkspaceEdit. We do NOT auto-save — saving here would silently persist
 * any unrelated unsaved edits the user already had in the buffer. The
 * suppression takes effect on the user's next Cmd+S (or its equivalent).
 */
async function suppressFinding(uri: vscode.Uri, id: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const insertAt = doc.positionAt(doc.getText().length);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, insertAt, formatSuppressionComment(id));
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showErrorMessage(
      "tokopt: could not insert suppression comment."
    );
    return;
  }
  vscode.window.showInformationMessage(
    `tokopt: added suppression for "${id}". Save the file to clear the diagnostic.`
  );
}

export function deactivate(): void {
  // All disposables are tracked in context.subscriptions.
}
