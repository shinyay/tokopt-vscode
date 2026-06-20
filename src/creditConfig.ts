import * as fs from "node:fs";
import * as vscode from "vscode";
import { CREDIT_MODELS, parseRateCardModels } from "./credit.js";
import { getEmbeddedModels } from "./embeddedModels.js";

/**
 * Resolved credit configuration, derived from the user's settings and the
 * active rate card (embedded or external). Centralizes the logic so every
 * surface (CodeLens, status bar, tree, dashboards) agrees on:
 *   - which models are actually projectable (`available`),
 *   - the effective model (falls back to "none" if the configured model is
 *     not in the active card — so an invalid setting degrades to
 *     tokens-only instead of erroring the CLI and hiding the CodeLens),
 *   - the external rate-card path to pass via `--credit-rates`.
 */
export interface ResolvedCredit {
  /** Effective model: "none" or a name present in `available`. */
  model: string;
  /** External rate-card path (only when set, readable, and a model is active). */
  ratesPath?: string;
  /** Model names the active card can project (excludes "none"). */
  available: string[];
  requestsPerDay: number;
}

export function resolveCredit(
  config: vscode.WorkspaceConfiguration,
  log?: vscode.OutputChannel
): ResolvedCredit {
  const requestsPerDay = config.get<number>("requestsPerDay", 200);
  const rawModel = (config.get<string>("creditModel", "none") || "none").trim();
  const ratesPathRaw = (config.get<string>("creditRatesPath", "") || "").trim();

  // Default projectable set = the binary's embedded card (discovered via
  // `tokopt models`, cached). Falls back to the hardcoded list until the
  // first successful fetch or against an older binary without the command.
  let available: string[] = [...(getEmbeddedModels() ?? CREDIT_MODELS)];
  let ratesPath: string | undefined;

  if (ratesPathRaw) {
    try {
      const content = fs.readFileSync(ratesPathRaw, "utf8");
      const models = parseRateCardModels(content);
      if (models.length > 0) {
        // An external card OVERRIDES the embedded default in the CLI, so
        // the projectable set becomes exactly the external card's models.
        available = models;
        ratesPath = ratesPathRaw;
      } else {
        log?.appendLine(
          `tokopt.creditRatesPath has no models: ${ratesPathRaw} (using embedded card)`
        );
      }
    } catch (e) {
      log?.appendLine(
        `tokopt.creditRatesPath unreadable: ${ratesPathRaw} (${String(e)}) — using embedded card`
      );
    }
  }

  const model =
    rawModel === "none" || available.includes(rawModel) ? rawModel : "none";

  return {
    model,
    // Only pass --credit-rates when a model from the external card is active.
    ratesPath: model !== "none" ? ratesPath : undefined,
    available,
    requestsPerDay,
  };
}
