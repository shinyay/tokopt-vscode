/**
 * Pure, `vscode`-free helpers that decide *what* `tokopt slim` may do to a
 * given document. Kept import-free so they are unit-testable under
 * `node --test` (the test bundle marks `vscode` external). Consumed by
 * extension.ts. See tokopt-vscode #50.
 *
 * Two capability tiers, because `tokopt slim` does two structurally different
 * things depending on the input:
 *
 *   - **Markdown-family prose** (Copilot customization files): slim compresses
 *     the prose *in place* and the result is still valid markdown. Safe to
 *     **apply** (overwrite the buffer) and to **preview**.
 *
 *   - **YAML / JSON**: slim routes through TonForm, which converts the document
 *     into **TOON** — a *different representation*. The data is lossless and
 *     recoverable, but overwriting a `.yaml` / `.json` file with TOON makes it
 *     **no longer valid YAML/JSON**, breaking any tool that consumes it as
 *     config (Kubernetes, GitHub Actions, MCP configs, …). So these are
 *     **preview-only**: the read-only diff surfaces the token savings without
 *     ever overwriting the file. `apply` is deliberately withheld.
 */

/**
 * Markdown-family languageIds that hold Copilot customization prose. This is
 * the single source of truth; extension.ts derives its `DocumentFilter[]` from
 * this list so provider registration and the slim capability check cannot
 * drift apart.
 *
 * VS Code Insiders 1.117+ and the `github.copilot-chat` extension register
 * dedicated languageIds for these filename patterns:
 *   - `agent`        → `*.agent.md` (legacy)
 *   - `chatagent`    → `*.agent.md` AND `*.chatmode.md` (current internal id)
 *   - `instructions` → `copilot-instructions.md`, `instructions.md`
 *   - `chatmode`     → `*.chatmode.md` (legacy)
 *   - `prompt`       → `*.prompt.md`
 *   - `skill`        → `SKILL.md`
 *
 * On older VS Code versions these ids are simply unused: `markdown` (plus the
 * `.md`/`.markdown` extension fallback below) still matches everything.
 */
export const MARKDOWN_FAMILY_LANG_IDS: readonly string[] = [
  "markdown",
  "agent",
  "chatagent",
  "instructions",
  "chatmode",
  "prompt",
  "skill",
];

const MARKDOWN_FAMILY_LANG_ID_SET: ReadonlySet<string> = new Set(
  MARKDOWN_FAMILY_LANG_IDS
);

/**
 * What `tokopt slim` is allowed to do to a document:
 *   - `"apply"`   — overwrite-in-place is safe (also previewable).
 *   - `"preview"` — read-only diff only; overwriting would corrupt the file's
 *                   format (YAML/JSON → TOON).
 *   - `"none"`    — slim does not target this file type.
 */
export type SlimCapability = "apply" | "preview" | "none";

function hasExt(fsPath: string, ...exts: string[]): boolean {
  const lower = fsPath.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

/**
 * Decide the slim capability for a document from its languageId and path.
 *
 * Precedence is deliberately **extension-first for config formats**: `tokopt
 * slim` chooses its pipeline from the *file extension / content* (a `.yaml`/
 * `.yml`/`.json`/`.jsonc` file is always converted to TOON), not from VS Code's
 * languageId. So a file with a config-format extension is capped at `preview`
 * even if its language mode has been manually overridden to `markdown` —
 * overwriting it in place would still corrupt it into TOON. After that guard,
 * markdown-family prose (by languageId or `.md`/`.markdown` extension) is
 * apply-capable, and a config languageId on an extension-less buffer is
 * preview-capable.
 */
export function slimCapabilityFor(
  languageId: string,
  fsPath: string
): SlimCapability {
  // Config-format extensions are ALWAYS preview-only (never overwrite): slim
  // routes by extension → TOON regardless of the buffer's languageId.
  if (hasExt(fsPath, ".yaml", ".yml", ".json", ".jsonc")) {
    return "preview";
  }
  if (
    MARKDOWN_FAMILY_LANG_ID_SET.has(languageId) ||
    hasExt(fsPath, ".md", ".markdown")
  ) {
    return "apply";
  }
  if (languageId === "yaml") {
    return "preview";
  }
  if (languageId === "json" || languageId === "jsonc") {
    return "preview";
  }
  return "none";
}

/** True when slim may overwrite the file in place (markdown family only). */
export function canApplySlim(languageId: string, fsPath: string): boolean {
  return slimCapabilityFor(languageId, fsPath) === "apply";
}

/** True when slim may show a read-only preview (markdown family, YAML, JSON). */
export function canPreviewSlim(languageId: string, fsPath: string): boolean {
  return slimCapabilityFor(languageId, fsPath) !== "none";
}
