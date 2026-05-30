import * as path from "node:path";

/**
 * Classification of a Copilot customization file by cost class.
 *
 * - `always-on`:  paid on every Copilot request (e.g. copilot-instructions.md)
 * - `conditional`: paid only when invoked (e.g. agents, chat modes)
 * - `on-demand`:  paid when matched/triggered (e.g. skills, prompt commands)
 */
export type CustomizationKind = "always-on" | "conditional" | "on-demand";

export interface CustomizationClass {
  kind: CustomizationKind;
  /** Short label shown in the CodeLens, e.g. "always-on". */
  label: string;
  /** Plain-English suffix shown after the label, e.g. "paid every request". */
  description: string;
}

/**
 * Classify a file by absolute or workspace-relative path.
 *
 * Returns `null` if the file is NOT a recognised Copilot customization asset,
 * in which case no CodeLens should be shown.
 *
 * Rules are conservative — we only match well-known shapes documented in
 * the VS Code Copilot customization spec and the agent-skills.io format.
 */
export function classifyCustomizationFile(
  filePath: string
): CustomizationClass | null {
  const basename = path.basename(filePath);
  const lower = filePath.toLowerCase();

  // Always-on: top-level Copilot instructions
  if (
    basename === "copilot-instructions.md" ||
    basename === "instructions.md" ||
    lower.endsWith("/.github/copilot-instructions.md")
  ) {
    return {
      kind: "always-on",
      label: "always-on",
      description: "paid every request",
    };
  }

  // Always-on: AGENTS.md (agent-skills.io spec — sent on every agent step).
  // Matched by basename so both `AGENTS.md` at the repo root and
  // `.github/AGENTS.md` (the two locations `tokopt detect`'s
  // `huge-agents-md` finding targets — antipatterns.go:446) light up.
  // False positives on `docs/AGENTS.md` are tolerated: a CodeLens hint is
  // not a destructive change, and the user can ignore it.
  if (basename === "AGENTS.md") {
    return {
      kind: "always-on",
      label: "always-on",
      description: "paid every agent step",
    };
  }

  // Conditional: agent definitions, chat modes
  if (lower.endsWith(".agent.md")) {
    return {
      kind: "conditional",
      label: "conditional",
      description: "paid when agent invoked",
    };
  }
  if (lower.endsWith(".chatmode.md")) {
    return {
      kind: "conditional",
      label: "conditional",
      description: "paid when chat mode activated",
    };
  }

  // On-demand: skills, prompt commands
  if (basename === "SKILL.md") {
    return {
      kind: "on-demand",
      label: "on-demand",
      description: "paid when skill loads",
    };
  }
  if (lower.endsWith(".prompt.md")) {
    return {
      kind: "on-demand",
      label: "on-demand",
      description: "paid when slash command invoked",
    };
  }

  return null;
}
