import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { runTokoptTail } from "./tail.js";
import { resolveCredit } from "./creditConfig.js";
import { histogram, computeStats, type UsageStats } from "./usageStats.js";
import {
  loadCopilotCliRows,
  loadFileRows,
  type UsageRow,
} from "./usageLog.js";
import { renderUsageHtml, type UsageViewData } from "./usageDashboardHtml.js";

function makeNonce(): string {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

type Source =
  | { kind: "copilot-cli" }
  | { kind: "file"; path: string; column: string };

/**
 * Owns the singleton Usage Analysis webview. Loads usage rows (Copilot CLI
 * logs or a picked JSONL/CSV), runs `tokopt tail` for the percentile stats
 * (so the numbers match the CLI), computes the histogram in-process, and
 * renders a graphical distribution + heavy-tail view.
 *
 * Privacy: only token counts + session metadata are ever read or written
 * (see usageLog.extractUsageRow); conversation content is never touched.
 */
export class UsageAnalysisPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private source: Source = { kind: "copilot-cli" };
  private refreshing = false;

  constructor(
    private readonly log: vscode.OutputChannel,
    private readonly resolveBinary: () => string
  ) {}

  async show(): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (this.panel) {
      this.panel.reveal(column);
      await this.refresh();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "tokoptUsageAnalysis",
      "Usage Analysis",
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
      (m) => void this.handleMessage(m),
      null,
      this.disposables
    );
    await this.refresh();
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case "refresh":
        await this.refresh();
        return;
      case "pickFile": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Analyze usage log",
          filters: { "Usage logs": ["jsonl", "ndjson", "csv", "json"] },
        });
        if (picked && picked[0]) {
          this.source = { kind: "file", path: picked[0].fsPath, column: "tokens" };
          await this.refresh();
        }
        return;
      }
      case "setModel": {
        if (typeof m.model === "string") {
          await vscode.workspace
            .getConfiguration("tokopt")
            .update("creditModel", m.model, vscode.ConfigurationTarget.Workspace);
          await this.refresh();
        }
        return;
      }
      default:
        return;
    }
  }

  private async refresh(): Promise<void> {
    if (!this.panel || this.refreshing) return;
    this.refreshing = true;
    let tmpFile: string | undefined;
    try {
      const config = vscode.workspace.getConfiguration("tokopt");
      const binaryPath = this.resolveBinary();
      const credit = resolveCredit(config, this.log);
      const creditModel = credit.model;
      const maxSessions = config.get<number>("usage.maxSessions", 500);

      // 1. Load rows (token counts + metadata only)
      let rows: UsageRow[];
      let sourceLabel: string;
      if (this.source.kind === "file") {
        rows = loadFileRows(this.source.path, this.source.column);
        sourceLabel = `File · ${path.basename(this.source.path)} · ${rows.length} records`;
      } else {
        rows = loadCopilotCliRows(maxSessions);
        sourceLabel = `Copilot CLI · ${rows.length} sessions`;
      }

      const nonce = makeNonce();
      if (rows.length === 0) {
        this.panel.webview.html = renderUsageHtml(
          this.emptyData(sourceLabel, creditModel, credit.available),
          { cspSource: this.panel.webview.cspSource, nonce }
        );
        return;
      }

      // 2. Write a temp JSONL (tokens + meta only) and run `tokopt tail`
      tmpFile = path.join(
        os.tmpdir(),
        `tokopt-usage-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
      );
      fs.writeFileSync(
        tmpFile,
        rows
          .map((r) =>
            JSON.stringify({
              tokens: r.tokens,
              nano_aiu: r.nanoAiu ?? 0,
              session: r.sessionId ?? "",
              model: r.model ?? "",
            })
          )
          .join("\n"),
        "utf8"
      );

      const tail = await runTokoptTail(
        binaryPath,
        tmpFile,
        { column: "tokens", top: 10, creditModel, creditRatesPath: credit.ratesPath },
        this.log
      );

      // 3. Stats — prefer the CLI's tail numbers; fall back to in-process.
      const values = rows.map((r) => r.tokens);
      let stats: UsageStats;
      if (tail.kind === "ok") {
        stats = {
          count: tail.result.count,
          sum: tail.result.sum,
          mean: tail.result.mean,
          p50: tail.result.p50,
          p90: tail.result.p90,
          p95: tail.result.p95,
          p99: tail.result.p99,
          max: tail.result.max,
          min: Math.min(...values),
          topSharePct: tail.result.topSharePct,
          topShareLabel: "top 1%",
        };
      } else {
        stats = computeStats(values);
      }

      // 4. Histogram + richer outliers from our own rows (full metadata)
      const bins = histogram(values, 24);
      const outliers = [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
      const totalNanoAiu = rows.reduce((s, r) => s + (r.nanoAiu ?? 0), 0);

      const data: UsageViewData = {
        sourceLabel,
        recordCount: rows.length,
        stats,
        histogram: bins,
        outliers,
        totalNanoAiu: totalNanoAiu > 0 ? totalNanoAiu : undefined,
        creditModel: creditModel === "none" ? undefined : creditModel,
        availableModels: credit.available,
        generatedAt: new Date().toISOString(),
      };
      this.panel.webview.html = renderUsageHtml(data, {
        cspSource: this.panel.webview.cspSource,
        nonce,
      });
    } finally {
      if (tmpFile) {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          /* best-effort cleanup */
        }
      }
      this.refreshing = false;
    }
  }

  private emptyData(
    sourceLabel: string,
    creditModel: string,
    available: string[]
  ): UsageViewData {
    return {
      sourceLabel,
      recordCount: 0,
      stats: computeStats([]),
      histogram: [],
      outliers: [],
      creditModel: creditModel === "none" ? undefined : creditModel,
      availableModels: available,
      generatedAt: new Date().toISOString(),
    };
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
