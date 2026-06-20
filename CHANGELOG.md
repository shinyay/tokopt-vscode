# Changelog

All notable changes to **tokopt-vscode** will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.0] — 2026-06-20

### Added

- **Model picker now discovers models from your tokopt binary.** The credit-model dropdowns (Optimization Dashboard, Usage Analysis) and the `tokopt.creditModel` setting are no longer limited to a hardcoded list of 4. On activation the extension runs `tokopt models --format json` and uses the result as the projectable set — so it automatically lists **every model the installed binary's embedded rate card can price** (19 with tokopt's expanded card: 4 empirically measured + 15 catalog-derived), and stays in sync as that card grows. No external `creditRatesPath` file needed for common models like `claude-opus-4.8`, `gpt-5.4`, `claude-haiku-4.5`.

### Changed

- `resolveCredit()` now defaults its projectable model set to the binary's embedded list (cached, discovered via `tokopt models`) instead of the hardcoded `CREDIT_MODELS`. This means a configured `creditModel` such as `claude-opus-4.8` is recognised and projects cost (previously it would silently degrade to tokens-only because the extension's hardcoded list didn't contain it). An external `creditRatesPath` still overrides, exactly as before.

### Internal / quality

- New `src/embeddedModels.ts`: a cached, best-effort `tokopt models --format json` fetch with a pure, unit-tested `parseModelsJson()` parser. Re-fetched on activation and whenever `tokopt.binaryPath` changes; falls back to the hardcoded list against older binaries that lack the `models` command, so cost projection degrades gracefully rather than breaking.
- 5 new unit tests (`parseModelsJson`) → **73 total**, all green via `node:test`.

### Requires

- A tokopt binary with the `tokopt models` command (tokopt CLI shipping the expanded embedded rate card). Older binaries are tolerated via the fallback path.

### Added

- **Custom rate cards — cost-project _any_ model** (new setting `tokopt.creditRatesPath`). The embedded rate card only covers 4 measured models, and `tokopt --credit-model` errors on anything else. Point `tokopt.creditRatesPath` at an external `rate-card.json` (`{"models": {"<model>": {"rate_status": "ok", "nano_aiu_per_input_token": <rate>}}}`) and you can now project cost for **any model you run in VS Code** — Claude Opus 4.8, o3, DeepSeek, etc. The path is threaded as `--credit-rates` through every credit call (count / audit / tail).
- **Dynamic model picker** — the in-panel model dropdowns (Optimization Dashboard, Usage Analysis) are no longer a hardcoded list. They now reflect the **active rate card**: the external card's models when `creditRatesPath` is set, otherwise the embedded four. A configured model that isn't in the card still shows as selected.

### Changed

- `tokopt.creditModel` is now a **free-form string** instead of a fixed enum, so external-card model names are accepted. An unknown model **degrades gracefully to tokens-only** (it is no longer passed to the CLI, so the CodeLens never disappears) — resolved centrally by the new `resolveCredit()` helper, which all surfaces (CodeLens, status bar, tree, dashboards, report) now share.

### Internal / quality

- New `src/creditConfig.ts` (`resolveCredit`) centralizes credit settings resolution + the invalid-model fallback. `src/credit.ts` gains pure `creditRatesArgs()` and `parseRateCardModels()`. `modelOptions()` is now exported and data-driven.
- 5 new unit tests (`creditRatesArgs`, `parseRateCardModels`, dynamic `modelOptions` incl. external-card list + selected-not-in-list) → **68 total**, all green via `node:test`. External-card projection verified end-to-end (`claude-opus-4.8` via a custom card → 315M nano-AIU).

### Note

The embedded rate card is empirically calibrated for 4 models; external-card rates for other models are **estimates** (tokopt is "a sanity-checker and before/after diff tool, not a billing oracle for non-OpenAI model families"). Expanding the embedded card with official per-model rates is tracked separately in the `tokopt` CLI.

## [0.10.0] — 2026-06-20

### Added

- **📉 Usage Analysis (the `tokopt tail` view)** (new command `tokopt: Show Usage Analysis`, also a toolbar button on the Token Cost view). A Webview that visualizes the **distribution and heavy tail of your token consumption** over a usage log — the retrospective counterpart to the workspace dashboard's "what could it cost".
  - **Data source**: Copilot CLI session logs (`~/.copilot/session-state/*/events.jsonl`) are auto-discovered and analyzed, or you can **pick any JSONL / CSV** with a token column. (A spike confirmed VS Code Copilot Chat does **not** persist per-request usage to disk — only the Copilot CLI does — so this analyzes CLI usage or a file you provide.)
  - **What it shows**: metric cards (sessions analyzed, total input tokens + AI Credit / USD, p50, p99), a **distribution histogram** (inline SVG), a **percentile bar chart** (p50/p90/p95/p99/max), and a **heavy-tail table** of your most expensive sessions (tokens, cost, requests, model, session id) with the headline "top 1% of sessions account for N% of all input tokens".
  - The percentile numbers come straight from `tokopt tail --format json` (same analysis as the CLI); the histogram is binned in-process for the chart.
  - **🔒 Privacy**: the view reads **only token counts, model names, request counts and session ids** — never your prompts or replies. The extraction (`extractUsageRow`) touches no conversation fields, and the footer states this.
  - New setting `tokopt.usage.maxSessions` (default 500) caps how many CLI logs are scanned (newest first) for performance.

### Internal / quality

- New modules: `src/usageStats.ts` (pure percentile + histogram + heavy-tail math), `src/usageLog.ts` (CLI-log discovery + privacy-safe extraction + JSONL/CSV parsing), `src/usageDashboardHtml.ts` (pure SVG rendering), `src/tail.ts` (`tokopt tail` wrapper), `src/usageAnalysis.ts` (webview panel).
- 23 new unit tests (percentile/histogram math, heavy-tail share, `session.shutdown` extraction incl. a privacy assertion that message content is never carried, JSONL/CSV parsing, HTML/CSP/chart structure) → **63 total**, all green via `node:test`.

## [0.9.0] — 2026-06-20

### Added

- **🧬 "Anatomy of a request" — what you control** (new section in the Optimization Dashboard). Every Copilot request is assembled from ~7 canonical segments (system, always-on instructions, tools, history, retrieved context, user message, reasoning), but your repo only directly controls **two**: the always-on instructions and the tool catalog. The dashboard now shows all seven, green-highlighting the two repo-controlled segments with their measured tokens (e.g. always-on 2,412 tok, tools 920 tok) and marking the rest as "Copilot runtime". This grounds the optimization work — it makes explicit *where* your controllable tokens sit within the full request, so effort goes to the segments you can actually change.
  - Replaces the originally-scoped "anatomy command UI": `tokopt anatomy` on a single customization file only classifies it as one segment (e.g. always-on 100%), which would just echo the CodeLens cost class. The educational 7-segment view is the higher-value reframing.
  - New `toolsTokens` field on the dashboard data (sum of `mcp-config` files) feeds the "Tools" segment.

### Internal / quality

- 3 new unit tests (toolsTokens aggregation, 7-segment anatomy rendering with exactly two repo-controlled segments, dashboard includes the section) → **40 total**, all green via `node:test`.

## [0.8.0] — 2026-06-20

### Added / Changed (dashboard & status bar refinements)

Polish pass after the v0.7.0 manual verification (which passed 26/26 clean):

- **Status bar shows the monthly cost inline** — the always-on tax item now reads e.g. `2,412 tokens always-on · ~$45/mo` (rounded) when `tokopt.creditModel` is set, so the cost is visible without hovering. The tooltip still carries the precise AIU + USD breakdown. (R2)
- **Dashboard → "📄 Markdown report" button** — the graphical dashboard gained a toolbar button that opens the markdown Optimization Report, bridging the visual and copy-pasteable views. (R3)
- **Dashboard "Heaviest files" handles large workspaces** — the per-file bar chart now lists up to 40 files (was 14) inside a scrollable panel, and the section header shows the file count, so big repos no longer silently hide files. (R5)
- **Dashboard accessibility** — the scope donut now carries an `aria-label` summarizing each segment's tokens and percentage, and every bar-chart row has an `aria-label` (label + value) with the list marked `role="list"`. Screen readers announce the data instead of an opaque image. (R1)

### Internal / quality

- 5 new unit tests (donut/bar `aria-label`, report-button wiring, 40-file cap, scrollable list + count) → **37 total**, all green via `node:test`.

## [0.7.0] — 2026-06-20

### Added

- **📈 Graphical Token Optimization Dashboard** (new command `tokopt: Show Optimization Dashboard`, also a toolbar button on the Token Cost view). A Webview panel that visualizes the workspace's customization cost with **dependency-free inline SVG charts** (no external chart library; CSP-safe; themed via VS Code's `--vscode-charts-*` variables so it matches light/dark):
  - **Metric cards** — always-on tax (tokens + monthly USD), total customization, potential savings, anti-pattern count (severity-coloured).
  - **Scope donut chart** — always-on / conditional / on-demand token split with a per-scope cost legend.
  - **"Heaviest files" bar chart** — top files by tokens, coloured by scope; click a bar to open the file.
  - **"Savings opportunities" bar chart** + **severity-coded finding cards** with one-line recommendations; click a finding to open the offending file.
  - **Interactive toolbar** — change the cost model or requests/day right in the panel (writes the workspace setting and re-renders), or hit Refresh. The panel also re-renders automatically when a customization file is saved.
  - Renders tokens-only (no cost columns) when `tokopt.creditModel` is unset, with an inline hint to enable it.
- **💰 Cost projection — see tokens as AI Credits and dollars** (new setting `tokopt.creditModel`). Until now the extension showed token _counts_; in the metered-billing era (GitHub Copilot AI Credits, `1 AIU = $0.01`) what actually matters is _cost_. Set `tokopt.creditModel` to one of the rate-card models (`gpt-5.5`, `claude-opus-4.7-1m-internal`, `gemini-3.1-pro-preview`, `mai-code-1-flash-internal`) and the extension projects every count into nano-AIU → AIU → USD using `tokopt --credit-model`:
  - **CodeLens** gains an inline cost suffix, scope-aware:
    - always-on → `▸ 630 tokens (always-on, paid every request)  ·  ≈ 0.197 AIU/req · ~$11.81/mo`
    - conditional → `≈ 0.087 AIU/invocation`
    - on-demand → `≈ 0.053 AIU/use`
  - **Status bar** tooltip projects the always-on tax to a monthly bill: e.g. a 2,412-token tax ≈ **$45.23/month** at 200 requests/day — _paid before you write a single line of a prompt_.
  - **Token Cost TreeView** category tooltips show per-scope cost.
  - **Show breakdown** modal (click the CodeLens) adds a full cost-math section including the monthly always-on projection.
  - New setting `tokopt.requestsPerDay` (default 200) controls the monthly projection assumption; it is stated explicitly wherever a monthly figure appears.
  - Backward compatible: with `tokopt.creditModel` unset (default `none`) every surface renders exactly as in v0.6.6 — no `--credit-model` flag is even passed to the CLI.
- **📊 Workspace Optimization Report** (new command `tokopt: Show Optimization Report`, also a toolbar button on the Token Cost view). Fuses `tokopt audit --credit-model` (where the tokens/cost are) with `tokopt detect` (what to trim and by how much) into a single markdown document opened in a new editor tab:
  - **§1 Where your tokens go** — a cost-summary table (always-on / conditional / on-demand → tokens + AIU + USD), plus the headline always-on monthly projection.
  - **§2 What to optimize** — every anti-pattern finding ranked by estimated tokens saved, with a total (on the bundled fixture: **~2,894 tokens** across 10 findings) and per-finding recommended actions.
  - **§3 How to act** — points back to the Quick Fix / Problems-panel workflow.
  - When no credit model is set, the report still renders (tokens-only) and tells you how to enable cost columns.

### Internal / quality

- New pure modules `src/credit.ts` (nano-AIU ↔ AIU ↔ USD math, scope-aware cost formatting), `src/optimizationReport.ts` (markdown rendering), and `src/dashboardHtml.ts` (dashboard data-shaping + inline-SVG chart rendering). All three are `vscode`-free so they are unit-tested directly.
- **First unit tests in the repo**: `npm test` builds `src/*.test.ts` with esbuild and runs them via Node's built-in `node:test` (zero new runtime dependencies). 32 tests cover the credit math, scope-aware formatting, markdown report rendering, and the dashboard's chart geometry (donut dash-arrays, bar widths), HTML/CSP structure and escaping.
- `runTokoptCount` and `runTokoptAudit` gained an optional `creditModel` parameter and parse the CLI's `nano_aiu` / `credit` blocks. The parameter defaults to off, so existing call sites are unchanged.

### Compatibility

- All new behaviour is opt-in via `tokopt.creditModel`. With the default (`none`), the CodeLens, status bar, and tree are byte-for-byte identical to v0.6.6.
- Requires a `tokopt` binary that supports `--credit-model` for the cost features (the rest of the extension still works with older binaries; cost projection silently stays off if the CLI omits the `nano_aiu` / `credit` fields).

## [0.6.6] — 2026-06-15

### Fixed

- **CodeLens / Quick Fix now activate on `chatagent` languageId** — `*.agent.md` and `*.chatmode.md` files in VS Code Insiders 1.125+ are registered against internal languageId **`chatagent`** (display name `Agent`), NOT `agent`. The display name "Agent" misled both [#18](https://github.com/shinyay/tokopt-vscode/issues/18) (where `agent` was added) and v0.6.4-v0.6.5 contributors — it is not the same string as the internal id. Result: even after v0.6.5 (which added `prompt` and `skill`), CodeLens and Quick Fix still silently failed on **both** `*.agent.md` AND `*.chatmode.md` files. v0.6.6 closes the loop by adding `{language:"chatagent"}` to `COPILOT_CUSTOMIZATION_LANGS`. Closes [#28](https://github.com/shinyay/tokopt-vscode/issues/28) (agent CodeLens despite registration) and [#29](https://github.com/shinyay/tokopt-vscode/issues/29) (chatmode mis-classification → renamed to agents by GH Copilot Chat).
  - **How the discovery was made**: Phase 16 manual verification using [`shinyay/tokopt-vscode-fixture`](https://github.com/shinyay/tokopt-vscode-fixture) (private) showed `*.prompt.md` and `SKILL.md` worked after v0.6.5, but `*.agent.md` and `*.chatmode.md` still failed. Clicking the status bar `Agent` indicator opened the **Select Language Mode** picker, which displays both name and identifier: `Agent (chatagent) - Configured Language`. The `(chatagent)` is the internal id; `Agent` is the display name. The legacy `{language:"agent"}` selector matches nothing on Insiders 1.125+ because no file ever gets that languageId.
  - **GH Copilot Chat deprecation context**: `*.chatmode.md` files now render a warning "Chat modes have been renamed to agents. Please move this file to..." — chatmodes are being unified under the agent abstraction. As a side-effect, both file kinds share `chatagent`. A single selector addition therefore fixes both #28 and #29.
  - `src/extension.ts` — `COPILOT_CUSTOMIZATION_LANGS` gains `{language:"chatagent"}` (now 7 entries). Doc comment extensively updated to enumerate display-name-vs-internal-id pitfalls and the deprecation timeline. The legacy `{language:"agent"}` and `{language:"chatmode"}` entries are preserved for backward compatibility with older VS Code versions where they still fire.
  - `package.json` — `activationEvents` gains `onLanguage:chatagent`. The existing `workspaceContains:**/*.agent.md` and `workspaceContains:**/*.chatmode.md` continue to handle first-open activation.
  - `src/customizationFiles.ts` — **no changes**. The cost classifier is languageId-agnostic (uses `endsWith()` / `basename`), so it already produces the correct labels (`*.agent.md` → "paid when agent invoked", `*.chatmode.md` → "paid when chat mode activated"). The bug was again purely that the providers never got asked.
  - `COPILOT_CUSTOMIZATION_LANG_IDS` Set and `isSlimSafeTarget()` automatically pick up the addition (derived from the same array).

### Open issues NOT addressed

- [#30](https://github.com/shinyay/tokopt-vscode/issues/30) Suppress Quick Fix inserts the `tokopt:disable` comment at an unexpected position. Cosmetic; functionality unaffected. Tracked for a future PR.

### Compatibility

- Adding `chatagent` to `COPILOT_CUSTOMIZATION_LANGS` is **strictly additive**. Existing 6 selectors (markdown / agent / instructions / chatmode / prompt / skill) continue to match.
- On VS Code versions that do not register `chatagent` (i.e. older than the GH Copilot Chat extension version that introduced the rename), the new selector simply no-ops; the legacy `agent` and `chatmode` selectors continue to handle those installations.
- No `tokopt` binary version requirement change (still `v0.4.0+` for the bulk of the extension, `v0.5.1+` for per-file Quick Detect).

## [0.6.5] — 2026-06-14

### Fixed

- **CodeLens / Quick Fix / `isSlimSafeTarget` now activate on `prompt` and `skill` languageIds** — VS Code Insiders 1.117+ assigns `*.prompt.md` to `prompt` and `SKILL.md` to `skill` (not `markdown`), but the extension's DocumentSelector only covered `[markdown, agent, instructions, chatmode]`. Result: opening any `*.prompt.md` or `SKILL.md` in Insiders showed **no CodeLens at all**, and Cmd+. produced no tokopt Quick Fix actions. This is the same class of regression as the v0.6.0 → v0.6.1 fix for `instructions` ([#18](https://github.com/shinyay/tokopt-vscode/issues/18)); v0.6.5 closes the remaining two gaps. Closes [#26](https://github.com/shinyay/tokopt-vscode/issues/26) (prompt) and [#27](https://github.com/shinyay/tokopt-vscode/issues/27) (skill).
  - `src/extension.ts` — `COPILOT_CUSTOMIZATION_LANGS` gains `{language:"prompt"}` and `{language:"skill"}`. Doc comment expanded to enumerate all six languageIds plus their filename patterns and the issues that drove each addition. Net change: +2 selectors, +5 comment lines.
  - `package.json` — `activationEvents` gains `onLanguage:prompt` and `onLanguage:skill`. The existing `workspaceContains:**/*.prompt.md` and `workspaceContains:**/SKILL.md` entries continue to handle the first-open case before any language activation event fires.
  - `src/customizationFiles.ts` — **no changes**. The cost classifier is languageId-agnostic (uses `endsWith()` / `basename`), so the `on-demand` label for both file kinds was already correct; the bug was purely that the providers never got a chance to ask.
  - `COPILOT_CUSTOMIZATION_LANG_IDS` Set and `isSlimSafeTarget()` automatically pick up the additions (derived from the same array), so the `tokopt.applySlim` / `tokopt.previewSlim` guard for non-CodeAction invocations stays consistent.
- **Bugs explicitly NOT addressed here** (separate work):
  - [#28](https://github.com/shinyay/tokopt-vscode/issues/28) `*.agent.md` (languageId `agent`) — CodeLens still fails on Insiders 1.117+ despite `agent` being registered. Workaround: switch the file's language to Markdown manually. Root cause unknown; needs `vscode.languages.getLanguages()` instrumentation in a dev build.
  - [#29](https://github.com/shinyay/tokopt-vscode/issues/29) `*.chatmode.md` mis-classified as `Agent` languageId in VS Code Insiders. Likely an Insiders default or a `contributes.languages` collision; not fixed in this PR.
  - [#30](https://github.com/shinyay/tokopt-vscode/issues/30) Suppress Quick Fix inserts the `tokopt:disable` comment at a slightly unexpected position. Cosmetic; functionality unaffected.

### Compatibility

- Adding entries to `COPILOT_CUSTOMIZATION_LANGS` is **strictly additive**: existing `markdown` / `agent` / `instructions` / `chatmode` selectors continue to match. On older VS Code versions where `prompt` and `skill` languageIds are not registered, the new selectors simply do not match anything (silent no-op) and `markdown` continues to handle the fallback.
- No `tokopt` binary version requirement change (still `v0.4.0+` for the bulk of the extension, `v0.5.1+` for per-file Quick Detect).

## [0.6.4] — 2026-06-05

### Changed

- **CodeLens detail message: anatomy positional form** — the suggested follow-up command in the headline CodeLens info modal (`src/extension.ts` line 308) now uses `tokopt anatomy "${file}"` (positional, auto-classifies the segment based on filename and path) instead of the legacy `tokopt anatomy --user "${file}"` (always-user fallback). Closes the loop on the `tokopt v0.6.0` binary release ([source PR #108](https://github.com/shinyay/getting-started-with-token-optimization/pull/108)) by surfacing the new auto-classification feature directly in the editor.

### Compatibility

- Requires `tokopt v0.6.0+` for the positional `anatomy` form (recommended: v0.6.1 which also ships the `tokopt version` subcommand). Older binaries (≤ v0.5.1) treat the file argument as a flag value and return an error; users running pre-v0.6.0 should upgrade via `curl -fsSL https://raw.githubusercontent.com/shinyay/tokopt/main/scripts/install.sh | sh`.
- The extension does not invoke `anatomy` directly yet — adding a runnable `tokopt.tree.anatomyFile` command (mirroring `tokopt.tree.detectFile`) is tracked separately.

## [0.6.3] — 2026-06-04

Closes the loop on the `tokopt v0.5.1` binary release ([source PR #106](https://github.com/shinyay/getting-started-with-token-optimization/pull/106)) by retiring the workspace-scoped Quick Detect workaround in favor of native per-file invocation, and bundles the previously-unreleased CI / release automation from Phase 11.C.

### Changed

- **Token Cost TreeView "Quick Detect" — direct per-file invocation** — `tokopt.tree.detectFile` (`src/extension.ts`) no longer scans the whole workspace and filters findings client-side. It now calls `tokopt detect <FILE>` directly, relying on the binary's 5-tier root inference + greppy narrowing (shipped in `tokopt v0.5.1`). Net result: faster (no full-workspace walk per click), more accurate (no path.resolve symlink edge cases), and ~25% less code in the handler. Older `tokopt` binaries (≤ v0.4.0) handed a file path return a v1 error envelope — the extension surfaces it with an explicit upgrade hint instead of failing silently.

- **`runTokoptDetect` parses v1 error envelopes** — `src/detect.ts` factored out a `parseDetectPayload(stdout, log)` helper that handles both the success path AND `err.stdout` captured from non-zero exits. Previously, when `tokopt` exited non-zero (any error envelope, e.g. `FILE_NOT_FOUND`), `execFile` rejected and the structured payload was discarded — the caller saw a generic `tokopt detect failed: Error: Command failed...` and lost the binary's actual diagnostic. The new helper recognizes the v1 `{format_version: "v1", error: {...}}` shape and returns `{kind: "error", message}` with the binary's message intact. Improves error UX for both Quick Detect and the diagnostics workspace scan.

- **`runTokoptDetect` signature: `rootDir` → `target`** — purely cosmetic; the parameter accepts both directories and files now (with `tokopt v0.5.1+`).

- **`Finding.location` doc** — clarified that in file mode the path is relative to the detector's inferred root (not the CLI argument).

### Added

- **CI workflow** (`.github/workflows/ci.yml`) — runs on every pull request and push to `main`. Steps: `npm ci` → `npm run typecheck` → `npm run build` → `npm run package` on `ubuntu-latest` / Node 22, then uploads the built `.vsix` as a workflow artifact (14-day retention) so reviewers can download and manually smoke-test extension behaviour before merging. Closes the regression-risk gap exposed by v0.6.0 / v0.6.1 / v0.6.2 all shipping with zero CI gates.

- **Release workflow** (`.github/workflows/release.yml`) — triggers on `v*` tag pushes. Verifies `package.json` `version` matches the tag (refuses to release on drift), runs the full build chain, extracts the matching `## [X.Y.Z]` section from `CHANGELOG.md` via `awk` (refuses to release if absent), and creates a GitHub Release marked `--latest` with the freshly-built `.vsix` attached. Replaces the manual `gh release create` step in the locked PR ceremony. Uses only the default `GITHUB_TOKEN` (no PAT, no marketplace publish — distribution model remains GitHub-Releases-only).

- **CI badge** — added to the top of `README.md` next to existing License / Format / VS Code badges. Public proof of green build state.

### Changed (CI / packaging)

- **`.vscodeignore`** — consolidated `.github/agents/**`, `.github/skills/**`, `.github/prompts/**` entries into a single `.github/**` exclusion. Side-effect: the new `.github/workflows/*.yml` files are also kept out of the packaged `.vsix` (otherwise they would have bundled an extra ~1.5 KB of CI-only YAML into every install).

### Compatibility

- **Per-file Quick Detect requires `tokopt v0.5.1` or newer.** Older binaries return a v1 `FILE_NOT_FOUND` error envelope which the extension surfaces in the Output channel with an explicit upgrade hint (`curl ... install.sh | sh`). All other extension features (CodeLens, Diagnostics, Quick Fix, Status bar, workspace-scoped detect from the Diagnostics manager) continue to work with `tokopt v0.4.0+`.
- Diagnostics manager (`src/diagnostics.ts`) is unchanged behaviorally — it still scans by workspace folder. The improved error-envelope parsing in `runTokoptDetect` produces cleaner log messages but does not change which findings get published to the Problems panel.

## [0.6.2] — 2026-06-03

Two usability/observability bug fixes — the `tokopt.showStatusBarBreakdown` command becomes reachable on healthy 0-tax repos, and the activation log no longer lies about CodeLens being enabled when VS Code's global `editor.codeLens` setting suppresses rendering.

### Fixed

- **Status bar: positive zero-state render** ([#19](https://github.com/shinyay/tokopt-vscode/issues/19)) — on repos with `always-on tax = 0` (the healthiest possible state — no `copilot-instructions.md` / `AGENTS.md` / `instructions.md` at workspace root or `.github/`) the status-bar item is no longer hidden. It now renders `$(check) 0 tokens always-on` with a neutral background, and the hover tooltip explains exactly which 6 locations × 3 basenames were scanned. Previously the item was hidden AND the `tokopt.showStatusBarBreakdown` command was palette-gated, leaving users with no way to confirm "yes, the scan ran and tax really is zero" — they couldn't distinguish between "extension is broken" and "your repo is genuinely clean".

- **Command palette: `Show always-on tax breakdown` now discoverable** ([#19](https://github.com/shinyay/tokopt-vscode/issues/19)) — `package.json` `menus.commandPalette` entry for `tokopt.showStatusBarBreakdown` changed from `"when": "false"` (hard-hidden) to `"when": "config.tokopt.statusBar.enabled"` (visible whenever the status bar feature is on). Belt-and-braces with the zero-state render: even if a user right-click-hides the status-bar item, they can still invoke the breakdown from the palette.

- **Activation log: effective CodeLens state** ([#20](https://github.com/shinyay/tokopt-vscode/issues/20)) — the activation log line previously logged only `tokopt.codeLens.enabled`, claiming `CodeLens enabled: true` even when VS Code's global `editor.codeLens=false` silently suppressed all CodeLens rendering. The log now AND-s both settings and shows the effective state. When the extension wants CodeLens on but the global suppresses it, an explicit hint is appended: `(global editor.codeLens=false suppresses rendering)`. Users debugging "tokopt CodeLens is broken" now get a correct signal pointing them at their actual setting.

### Compatibility

- Status-bar zero-state render is **additive** — repos with any always-on customization files render exactly as before (same text format, same thresholds, same colors).
- Activation log format change is **observability-only**; no behavior depends on parsing this line.

## [0.6.1] — 2026-06-03

Fixes a critical silent-failure bug ([#18](https://github.com/shinyay/tokopt-vscode/issues/18)): on VS Code Insiders 1.117+ the CodeLens and Quick Fix providers stopped rendering on the extension's primary target files (`*.agent.md`, `copilot-instructions.md`, `*.chatmode.md`) because VS Code and the official `github.copilot-chat` extension now register dedicated languageIds (`agent`, `instructions`, `chatmode`) for those filename patterns. The `DocumentSelector`s matched `language: "markdown"` only, so providers were registered against the wrong language slot — Diagnostics still worked (gated by `source === "tokopt"`), but CodeLens + Quick Fix were silently absent. Manually flipping the editor language to `Markdown` worked around it.

### Fixed

- **CodeLens registration** — `codeLensSelector` (`src/extension.ts`) now matches the markdown family (`markdown`, `agent`, `instructions`, `chatmode`) instead of `markdown` only. Reuses a shared `COPILOT_CUSTOMIZATION_LANGS` constant so future surfaces stay in sync.
  ([#18](https://github.com/shinyay/tokopt-vscode/issues/18))

- **Quick Fix registration** — `codeActionSelector` (`src/extension.ts`) widens the prose-family entries to the same four languageIds; the data-format entries (`json` / `jsonc` / `yaml`) for MCP config quick-fixes are unchanged.
  ([#18](https://github.com/shinyay/tokopt-vscode/issues/18))

- **Slim safety guard** — `isSlimSafeTarget()` (`src/extension.ts`) now accepts all four markdown-family languageIds. Previously, programmatic invocations of `tokopt.applySlim` / `tokopt.previewSlim` (keybinding, `executeCommand`) on `*.agent.md` files with `languageId="agent"` were rejected with a misleading "agent files are not slim-safe" error even though the file is markdown on disk and the slim pipeline routes it safely via path-based emphasis detection.
  ([#18](https://github.com/shinyay/tokopt-vscode/issues/18))

- **Activation events** — `package.json` `activationEvents` adds `onLanguage:agent`, `onLanguage:instructions`, `onLanguage:chatmode` as belt-and-braces complements to the existing 9 `workspaceContains` globs. Covers the edge case of a stray customization file opened outside any workspace match.
  ([#18](https://github.com/shinyay/tokopt-vscode/issues/18))

### Compatibility

- On older VS Code versions where the new languageIds are not registered, the additional `DocumentSelector` entries are simply unused — `markdown` still matches everything as a fallback. No behavioral regression on pre-1.117 installs.

## [0.6.0] — 2026-05-30

Adds a **Token Cost TreeView** in the Explorer sidebar — the fifth
surface in the extension's ecosystem and the first to provide a
workspace-wide, browsable inventory of customization files grouped by
runtime scope (always-on / conditional / on-demand). Backed by
`tokopt audit --format=json`, refreshed lazily, and gated by stable
TreeItem IDs so VS Code keeps collapse state across refreshes.

### Added

- **`TokenCostTreeProvider`** — a `TreeDataProvider` that lists every
  customization file `tokopt audit` discovers in each workspace folder,
  grouped under three scope categories (Always-on / Conditional /
  On-demand) and sorted by token count descending. Each file row shows
  `<rel/path>  · <N tokens>` with a colored icon (green / yellow / red)
  driven by the same `warnThreshold` (default 500) and `errorThreshold`
  (default 1500) thresholds the Status bar uses.
  ([#10](https://github.com/shinyay/tokopt-vscode/issues/10))

- **`src/audit.ts`** — fourth consumer of the `format_version: "v1"`
  envelope. Strict equality check, per-file shape validation (drops
  unknown scope/malformed rows rather than blanking the whole tree),
  30s timeout, 8 MB stdout cap (broader than `count`/`detect` because
  audit recursively walks the workspace).

- **Five new commands**, all `tokopt.tree.*`-prefixed:
  - `tokopt.tree.refresh` — palette + title-bar refresh button on the
    view; bumps generation, clears cache, schedules a fresh audit.
  - `tokopt.tree.openFile` — right-click → Open (palette-hidden).
  - `tokopt.tree.slimFile` — right-click on markdown rows only
    (`viewItem == tokoptFileMarkdown`); delegates to the existing
    `tokopt.applySlim` Quick Fix command (palette-hidden).
  - `tokopt.tree.detectFile` — right-click → run `tokopt detect` for the
    containing workspace folder and filter findings to the selected
    file's absolute path (palette-hidden; uses path filter because the
    `tokopt detect <file>` CLI form is currently undocumented).
  - `tokopt.tree.showAuditPanel` — palette command that reveals the
    tokopt output channel and dumps the cached `tokopt audit` JSON
    (replay-friendly; doesn't re-run the audit).

- **Three new settings** under `tokopt.treeView.*`:
  - `enabled` (boolean, default `true`) — hides the entire view when
    `false` via `when: "config.tokopt.treeView.enabled"`.
  - `warnThreshold` (number, default `500`, min `0`) — yellow icon
    threshold for file + category rows.
  - `errorThreshold` (number, default `1500`, min `0`) — red icon
    threshold. Clamped to be `>= warnThreshold` at runtime so a
    pathological config can't invert the colors.

- **Four `viewsWelcome` states**, gated on a `tokopt.tree.state`
  context key:
  - `loading` — initial audit in progress.
  - `missingBinary` — `tokopt` not on PATH (links to install script).
  - `empty` — no customization files discovered.
  - `error` — audit failed (links to the output channel for details).

- **Lazy first refresh** — the TreeView does ZERO work on extension
  activation. The first audit only runs when the view actually becomes
  visible (`onDidChangeVisibility`). Save / watcher events fired before
  the first open are coalesced into a single deferred refresh that
  fires when the view is first opened. Activation event
  `onView:tokoptTokenCost` is registered so opening the view brings
  the extension to life if it wasn't already.

- **FileSystemWatcher** for a broader customization-file glob than the
  Status bar uses (audit walks recursively, so any nested `*.agent.md`
  or `SKILL.md` should refresh the tree). Save listener also schedules
  a refresh for any file `classifyCustomizationFile()` recognises, so
  newly-created customization files appear without a manual refresh.

### Changed

- **`package.json` — `version`** → `0.6.0`, description gains "+ Token
  Cost TreeView", keywords gain `"treeview"`, activation events gain
  `onView:tokoptTokenCost`.

- **Bundle size** 25.8 KB → **36.5 KB** (+10.7 KB / +41%); .vsix 25.2 KB
  → **31.4 KB** (+6.2 KB / +25%). The bulk comes from the new
  `tokenCost.ts` (~480 lines), `audit.ts` (~170 lines), and the
  `viewsWelcome` + per-row context machinery in `extension.ts` /
  `package.json`.

### Rubber-duck adoptions

- **13 design-phase findings** (all adopted):
  - **H#1** Lazy first refresh — no work on activation; visibility latch
    triggers the first audit; saves before first open queue a deferred
    refresh.
  - **H#2** Workspace-scoped `detect` + path filter — works around the
    undocumented `tokopt detect <file>` form by running a folder-wide
    detect and filtering findings by absolute path.
  - **H#3** Per-row `contextValue` differentiation
    (`tokoptFileMarkdown` vs `tokoptFileConfig`) so the slim menu
    entry only appears on markdown rows (not `mcp.json`).
  - **H#4** Cache is "last-published state", not a freshness
    shortcut — every refresh re-runs `tokopt audit`; the per-folder
    map only exists for graceful degradation when one folder fails
    and for the audit-panel replay.
  - **M#5** Save listener always schedules a refresh (newly-created
    files matter — checking "path is in last result" would miss them).
  - **M#6** `getChildren` returns `[]` when state isn't `ready` so
    `viewsWelcome` actually renders.
  - **M#7** Context-keyed welcome states via
    `vscode.commands.executeCommand("setContext", ...)`.
  - **M#8** Threshold normalization —
    `error = max(warn, configError)`, `warn = max(0, configWarn)`.
  - **M#9** Token-count badging via TreeItem `description` + tooltip
    + colored `ThemeIcon` (no badge API exists for tree items).
  - **L#10** Defensive path resolution — `path.resolve` + verify the
    result stays under the workspace folder root.
  - **L#11** Atomic multi-folder publish —
    `Promise.allSettled` + single `_onDidChangeTreeData.fire()` at the
    end, with generation re-check before AND after the merge.
  - **L#12** Stable TreeItem IDs (`category:<scope>` / `file:<absPath>`)
    so VS Code preserves collapse state across refreshes.
  - **L#13** Raw `tokopt audit` JSON preserved for exact replay via
    `tokopt.tree.showAuditPanel`.

- **4 post-impl hardening findings** (all adopted):
  - **H** First-open activation could miss the visibility event when
    `onView:tokoptTokenCost` activates the extension — explicit
    `if (tokenCostView.visible) onVisibilityChange(true)` after
    registering the listener.
  - **M** Initial `loading` context key never set — `state` starts as
    `undefined` so the constructor's `setState("loading")` actually
    publishes.
  - **M** `clearCache()` now bumps the generation counter so any
    in-flight audit's results are discarded; the title-bar refresh
    command no longer double-fires `clearCache + refresh`.
  - **M** Mixed empty/error workspace state — partial failures now
    set `state == "error"` rather than masquerading as `empty`.

### Notes

- **Five-surface ecosystem complete.** With this release the extension
  spans editing-time precision (CodeLens), problem surfacing
  (Diagnostics), remediation (Quick Fix), peripheral awareness
  (Status bar), and now browsable inventory (TreeView):

  | Surface | Granularity | Use case |
  |---|---|---|
  | CodeLens (v0.2.0) | Per-file | Editing precision |
  | Diagnostics (v0.3.0) | Per-finding | Anti-pattern surfacing |
  | Quick Fix (v0.4.0) | Per-finding | One-click remediation |
  | Status bar (v0.5.0) | Per-workspace | Always-visible awareness |
  | **TreeView (v0.6.0)** | **Per-workspace + per-file inventory** | **Cost discovery & navigation** |

- **`format_version: "v1"` ROI compounding (5th consumer).** Future
  schema changes ship a single warning across all five surfaces.

## [0.5.0] — 2026-05-30

Adds a **status-bar item** showing the workspace's _always-on tax_ — the
sum of tokens across well-known global customization files at the
workspace root and `.github/`. Complements the v0.4.0 Quick Fix surface:
CodeLens = per-file editing precision; Diagnostics = per-finding
remediation; Status bar = peripheral, always-visible workspace
awareness.

### Added

- **`TokoptStatusBarManager`** — right-aligned status bar item rendering
  `$(file-text) N tokens always-on` (plus `/ current: M` when the active
  editor is a recognised customization file that isn't itself in the
  tax). Background turns warning-coloured at `>= warnThreshold` (default
  500) and error-coloured at `>= errorThreshold` (default 1500). Click
  reveals a per-file breakdown in the **tokopt** output channel.
  ([#7](https://github.com/shinyay/tokopt-vscode/issues/7))

- **Strict always-on discovery** — enumerates a fixed six locations per
  workspace folder (`<root>/{copilot-instructions.md,instructions.md,
  AGENTS.md}` plus the same three under `<root>/.github/`). NO recursive
  glob walk: `docs/AGENTS.md`, `packages/foo/AGENTS.md`, etc. are
  intentionally NOT included in the workspace tax — only files at the
  conventional global injection points count. This is deliberately
  stricter than the CodeLens classifier, which tolerates false positives
  on hint-only displays.

- **Refresh triggers**:
  - extension activation (best-effort initial scan + initial
    current-file count)
  - save of a strict always-on file (debounced 250ms)
  - `FileSystemWatcher` on the strict patterns — create / change / delete
    events outside save-listener coverage (external edits, file
    deletions, git checkout flipping files in/out)
  - active-editor change (current-file appendix only, never re-scans the
    tax)
  - `onDidChangeWorkspaceFolders` — clears cache and re-scans
  - `tokopt.refreshStatusBar` command (palette:
    *tokopt: Refresh Status Bar*)
  - configuration changes under `tokopt.*`

- **Commands**:
  - `tokopt.refreshStatusBar` — palette manual rescan
  - `tokopt.showStatusBarBreakdown` — click handler (hidden from palette
    via `when: "false"`); writes a per-file breakdown to the **tokopt**
    output channel and reveals it

- **Settings**:
  - `tokopt.statusBar.enabled` (boolean, default `true`)
  - `tokopt.statusBar.warnThreshold` (number, default `500`)
  - `tokopt.statusBar.errorThreshold` (number, default `1500`)

- **Activation events** — added `workspaceContains:**/AGENTS.md` and
  `workspaceContains:**/.github/AGENTS.md` so workspaces containing only
  an AGENTS.md (no other markdown / MCP config) still activate the
  extension and surface the tax.

### Changed

- Bundle: 18.3 KB → 25.8 KB; `.vsix`: 22.6 KB → 25.2 KB.

### Notes (rubber-duck hardening adopted during design + impl)

- **Strict tax model** — `classifyCustomizationFile` is intentionally
  permissive (basename match on `AGENTS.md` covers `docs/AGENTS.md`) for
  the CodeLens hint, but that would over-count for the workspace tax.
  The status bar uses a separate `isStrictAlwaysOnPath` predicate that
  restricts to the six conventional locations only.
- **Cache race protection** — cache entries are keyed on
  `mtimeMs + size + binaryPath`. Cache writes inside `runOnce` are
  collected into a local `Map` and merged only AFTER the generation
  check passes; in-flight runs that start with an old `binaryPath`
  cannot repopulate the cache after a config change. The save-listener
  `invalidate()` only bumps `generation` when the path was actually
  cached, so unrelated saves (e.g. `foo.ts`) cannot starve an in-flight
  activation scan.
- **`updateCurrentFile` stale-result guards** — a request-sequence
  counter, the current active-editor path, and the current `binaryPath`
  are all snapshotted before the async count and re-checked after.
  Cmd+Tab between two customization files cannot let an older, slower
  count clobber the newer one. A stale `binary-missing` result does NOT
  flip the `binaryMissing` flag — that's owned by `runOnce`.
- **Debounced refresh** — `scheduleRefresh()` collapses rapid save +
  watcher firings into a single scan via a 250ms timer. Concurrent
  refresh requests are coalesced via the existing `refreshing /
  pendingRefresh` mutex pattern (mirrors `TokoptDiagnosticManager`).
- **Output channel breakdown, not modal** — issue calls for an
  "audit panel / output" click target. A modal info dialog would be
  cramped and uncopyable; the existing tokopt output channel is the
  right surface for a multi-file table.
- **`/ current: N` suppressed for tax-contributing files** — when the
  active editor IS one of the strict always-on files, the headline
  already includes its tokens; appending the same value as `/ current`
  would be redundant. The breakdown shows per-file values.
- **Disabled status bar zero-cost** — `updateCurrentFile` early-returns
  when `statusBar.enabled === false`, so a user who turns it off pays
  zero subprocess cost on editor switches.

## [0.4.0] — 2026-05-30

Adds **Quick Fix** code actions on top of the Diagnostic provider shipped
in v0.3.0. Wherever a `tokopt` finding appears in the Problems panel, the
lightbulb (Cmd+. / Ctrl+.) now offers context-appropriate remediation.

### Added

- **CodeActionProvider** — surfaces Quick Fixes against every diagnostic
  whose `source === "tokopt"`. The provider is fully data-driven: it
  trusts `diag.source` and `diag.code` rather than re-classifying the
  underlying file.
  ([#9](https://github.com/shinyay/tokopt-vscode/issues/9))

- **Per-finding action set** (in lightbulb-menu order):
  - **Preview tokopt slim diff for this file** — runs `tokopt slim` and
    opens the result side-by-side via VS Code's built-in diff editor.
    The compressed text is served from a virtual `tokopt-slim:` URI so
    no temp files are written.
  - **Apply tokopt slim suggestion** — runs `tokopt slim` and replaces
    the whole document via a single `WorkspaceEdit`, so undo restores
    the original in one keystroke. The post-apply toast reports
    `-N tokens (P%)`.
  - **Suppress `<id>` for this file** — appends
    `<!-- tokopt:disable=<id> -->` via an in-memory edit. Markdown only.
  - **Learn more about `<id>`** — opens the anti-patterns chapter on
    GitHub. Always offered, even for findings tokopt can't auto-fix.

- **`SLIM_FIXABLE` rule allow-list** — Apply / Preview are offered only
  for `kitchen-sink-system-prompt`, `verbose-auto-generated-instructions`,
  and `huge-agents-md`. Findings whose primary remediation is restructuring
  (everything in `mcp-*`, `verbose-tool-descriptions`, `polite-filler`,
  `format-inflation`, `possible-policy-tension`, `reasoning-leakage`)
  intentionally get Suppress + Learn more only, never a destructive
  mechanical fix.

- **Suppression parser** (`src/suppressions.ts`) —
  `<!-- tokopt:disable=<rule-id> -->` HTML comments are now recognised
  per file. `TokoptDiagnosticManager` reads each file once per refresh,
  parses suppressions, and filters matching findings before publishing
  to the Problems panel. Saving the file picks up new markers on the
  next refresh.

- **Commands**:
  - `tokopt.applySlim` — Quick Fix only (hidden from palette; defense
    in depth against accidental whole-buffer rewrites on JSON / YAML)
  - `tokopt.previewSlim` — Quick Fix only (hidden from palette)
  - `tokopt.suppressFinding` — Quick Fix only (hidden from palette)
  - `tokopt.learnMore` — Quick Fix only (hidden from palette)

- **Activation events** — added `**/.vscode/mcp.json`,
  `**/.cursor/mcp.json`, `**/.copilot/mcp-config.json` so the extension
  activates in MCP-only workspaces (which have no `.md` customization
  files but still surface `mcp-*` findings on the JSON config).

- **AGENTS.md classification** — `classifyCustomizationFile` now treats
  `AGENTS.md` as an always-on customization asset (matches `tokopt
  detect`'s `huge-agents-md` finding targets). This gives the file a
  CodeLens and ensures save-triggered diagnostic refresh works.

### Changed

- Bundle: 10.2 KB → 18.3 KB (added codeActions / slim / slimPreview /
  suppressions modules plus race-detection + safety guards)

- **Save listener broadened** — diagnostics now refresh on save whenever
  EITHER the file is a recognised customization asset OR it currently
  has tokopt diagnostics published. The second clause makes
  Suppress / Apply edits clear or reshape findings on the very next
  save, even for files outside the customization predicate.

### Notes (hardening discussions captured during design + impl)

- **Dirty-buffer protection** — Apply / Preview both refuse to run on
  an unsaved buffer. They prompt the user to save first, so slim's
  output matches the bytes the user actually intends to ship.
- **No auto-save on Suppress** — the suppression comment is inserted
  via `WorkspaceEdit` and **not** saved automatically. Calling
  `doc.save()` would silently persist any unrelated unsaved edits.
  The suppression takes effect the next time the user saves.
- **Single undoable edit** — Apply uses a single full-document
  `WorkspaceEdit.replace` with `positionAt(0)`–`positionAt(length)`,
  so `Ctrl+Z` restores the pre-slim text in one step.
- **JSON safety (two layers)** — `verbose-tool-descriptions` and all
  `mcp-*` findings are deliberately *excluded* from `SLIM_FIXABLE`, AND
  `applySlim` / `previewSlim` carry a runtime `isSlimSafeTarget`
  guard that refuses to operate on anything other than markdown.
  Programmatic invocation (keybinding, another extension) cannot
  bypass the menu-level allow-list.
- **No anchored Learn-more URLs** — `chapter_ref` on detect findings
  (e.g. *"Ch 14 #11"* for `reasoning-leakage`) has drifted from the
  actual numbered headings in the chapter, so anchored URLs would 404
  silently. Learn more opens the chapter top — the reader can Ctrl+F.
- **Fail-open suppressions** — if reading a file for suppressions
  fails (deleted, permission error), the manager logs to the output
  channel and proceeds with no suppressions for that file. Visibility
  beats silent muting.
- **Race detection** — `applySlim` snapshots `doc.version` before
  invoking the (async) slim run and refuses to overwrite the buffer
  if the user has edited it in the meantime. The user is asked to
  re-run Apply against the current bytes.
- **Per-URI in-flight guard** — a second click on Apply or Preview for
  the same file while a slim run is in flight is silently ignored. No
  two whole-buffer replace edits can race.
- **Action dedupe** — when multiple `SLIM_FIXABLE` findings target the
  same file the lightbulb still shows exactly one Preview and one
  Apply (slim is file-scoped). Suppress + Learn more remain
  per-finding because they're finding-specific.

## [0.3.0] — 2026-05-30

Adds the **second consumer** of the `format_version: "v1"` envelope: an
anti-pattern Diagnostic provider that surfaces `tokopt detect` findings
in the VS Code Problems panel.

### Added

- **DiagnosticProvider** — runs `tokopt detect --format=json` against
  each workspace folder and publishes findings to the Problems panel,
  with the appropriate severity (`critical`/`high` → Error,
  `warn` → Warning, `info` → Information). Each diagnostic carries the
  finding `id` as its `code` and `"tokopt"` as its `source`, making them
  filterable.
  ([#8](https://github.com/shinyay/tokopt-vscode/issues/8))

- **Refresh triggers**:
  - extension activation (initial scan)
  - file save (only when the saved file is a recognised customization
    asset — avoids thrashing detect on unrelated edits)
  - `tokopt.refreshDiagnostics` command (palette: *tokopt: Refresh Diagnostics*)
  - configuration changes under `tokopt.*`

- **Commands**:
  - `tokopt.refreshDiagnostics` — manual rescan
  - `tokopt.clearDiagnostics` — drop all published diagnostics

- **Setting**:
  - `tokopt.diagnostics.enabled` (default `true`) — turn the provider off
    without uninstalling

- **Shared one-time warning latches** (`src/warnings.ts`) — both
  CodeLens and Diagnostics now route their "binary missing" and
  "format_version mismatch" notifications through the same module, so a
  user sees each warning at most once per session even when both
  features run.

### Changed

- Bundle: 5.6 KB → 10.2 KB (added detect/diagnostics/warnings modules)
- `.vsix`: 12 KB → 17 KB
- Extended `activationEvents` — extension now activates eagerly when a
  workspace contains any of `**/.github/copilot-instructions.md`,
  `**/copilot-instructions.md`, `**/instructions.md`, `**/*.agent.md`,
  `**/*.chatmode.md`, `**/*.prompt.md`, `**/SKILL.md`. CodeLens still
  relies on the original `onLanguage:markdown` activation; the new
  events ensure the initial diagnostic scan runs without waiting for
  the user to open a markdown file first.
- `tokopt.binaryPath` now falls back to `"tokopt"` when set to an empty
  string (was a hard error in Diagnostics; CodeLens already did this).
- `tokopt.binaryPath` changes also reset the one-time warning latches so
  the user sees a fresh warning if the new path is also bad.

### Notes

- Findings are anchored to a zero-width range at line 0 of each file.
  `tokopt detect` reports file-level findings (no line numbers), so this
  matches the data shape rather than guessing.
- Detectors that aggregate across multiple files (e.g. MCP overload)
  emit free-form location strings that aren't real paths. Those
  findings are skipped and logged to the *tokopt* output channel rather
  than rendering as bogus file paths in the Problems panel.
- Locations are validated to stay within the scanned workspace folder
  (no `..` escape) and to resolve to a real file on disk before being
  published.
- `clear()` and concurrent `refresh()` are protected by a generation
  token: an in-flight detect cannot republish stale findings over an
  explicit clear or a newer refresh.

## [0.2.0] — 2026-05-30

First **real VS Code extension** release. Until now, `tokopt-vscode` shipped
only Copilot Chat assets (agents/skills/prompts) via install scripts. v0.2.0
introduces an actual `.vsix` extension that adds an **inline token-cost
CodeLens** to recognised Copilot customization files.

The two install surfaces are now siblings:

| Surface | Installs | Use it when |
|---|---|---|
| `.vsix` extension (NEW) | CodeLens UI | You want token cost visible while editing |
| `scripts/install-*.sh` | `.github/agents/`, `.github/skills/`, `.github/prompts/` | You want the `@token-doctor` / `/token-audit` UX in Copilot Chat |

### Added

- **CodeLens provider** — adds one inline annotation at the top of every
  recognised customization file:
  ```
  ▸ 1,394 tokens (conditional, paid when agent invoked)
  ```
  Click it to open a modal with the breakdown plus suggested
  `tokopt anatomy` / `tokopt detect` follow-up commands.
  ([#6](https://github.com/shinyay/tokopt-vscode/issues/6))

- **Recognised file kinds**:
  - `copilot-instructions.md` → `always-on, paid every request`
  - `*.agent.md` → `conditional, paid when agent invoked`
  - `*.chatmode.md` → `conditional, paid when chat mode activated`
  - `SKILL.md` → `on-demand, paid when skill loads`
  - `*.prompt.md` → `on-demand, paid when slash command invoked`

- **`format_version` schema dispatch**: the extension is the first
  consumer of the `tokopt` CLI's `format_version: "v1"` JSON envelope
  ([upstream PR #16](https://github.com/shinyay/getting-started-with-token-optimization/pull/16),
  closes [tokopt-skills#5](https://github.com/shinyay/tokopt-skills/issues/5)).
  Strict equality check — anything other than `"v1"` triggers a one-time
  warning and silently disables CodeLens, so a future `v2` schema will
  never crash the extension.

- **Settings**:
  - `tokopt.codeLens.enabled` (default `true`)
  - `tokopt.binaryPath` (default `tokopt`, accepts absolute path)

- **Graceful degradation**:
  - `tokopt` CLI not in `PATH` → silent skip + one-time info message
    pointing to install instructions.
  - Subprocess error / malformed JSON → silent skip, logged to the
    `tokopt` output channel.
  - Dirty buffer (unsaved edits) → reuses last counted value; re-counts
    on save. This avoids spawning `tokopt` per keystroke.

### Engineering

- TypeScript 5.4 + esbuild 0.24 bundle, single 5.6 KB `out/extension.js`.
- VS Code engine `^1.85.0` (covers Insiders + Stable since Nov 2023).
- 12 KB packaged `.vsix`.

## [0.1.2] — 2026-05-30

Install-script polish release. Closes all remaining v0.1.x issues —
**`tokopt-vscode` open issues = 0** after this release.

### Fixed

- **`install-workspace.sh --dry-run` argument parsing**: previously,
  `--dry-run <target>` treated `--dry-run` as the target path because
  the script only checked `$2` for the flag. v0.1.2 replaces the
  ad-hoc handling with a flag-before-positional loop, so all of these
  now work identically:

  ```bash
  install-workspace.sh --dry-run .
  install-workspace.sh . --dry-run
  install-workspace.sh --dry-run        # defaults to current dir
  ```

  Unknown flags now exit with code 2 and a clear error message;
  `--help` exits 0 (was 1).
  ([#5](https://github.com/shinyay/tokopt-vscode/issues/5))

### Added

- **`install-user.sh` post-install tokopt CLI detection**: the user
  installer now ends with a 3-way detection block:
  1. `command -v tokopt` → print path + version
  2. else `~/go/bin/tokopt` exists → print PATH-fix hint
  3. else → print actionable install hint with **both** the
     recommended `curl | sh` from [`shinyay/tokopt`](https://github.com/shinyay/tokopt)
     and the `go install` fallback

  First-time installers no longer have to hit `tokopt: command not
  found` mid-Chat-session to discover the prerequisite.
  ([#3](https://github.com/shinyay/tokopt-vscode/issues/3))

### Verification

All acceptance criteria from #5 and #3 validated against a clean
`/tmp/vsc-test/` workspace:

| Test | Result |
|---|---|
| `install-workspace.sh --dry-run .` | ✅ dry-run output, no writes |
| `install-workspace.sh . --dry-run` | ✅ identical |
| `install-workspace.sh --dry-run` (no target) | ✅ defaults to `.` |
| `install-workspace.sh --bogus .` | ✅ exit 2 + clear error |
| `install-workspace.sh . /tmp` | ✅ exit 2 (multiple targets rejected) |
| `install-workspace.sh --help` | ✅ exit 0 |
| `install-user.sh --dry-run` | ✅ ends with `✓ tokopt CLI detected: /home/.../go/bin/tokopt` |

## [0.1.1] — 2026-05-30

Bug-fix + UX-polish release. **v0.1.0 slash commands were non-functional
in VS Code Agent mode**; v0.1.1 makes them work.

### Fixed

- **CRITICAL** — Removed invalid `tools: ['terminal']` frontmatter from
  all 4 slash-command prompts (`token-audit`, `slim-suggest`,
  `slim-apply`, `prompt-anatomy`). The unknown tool name caused VS Code
  Chat to restrict the agent to a minimal default tool set (no
  `run_in_terminal`), making every slash command refuse to execute
  `tokopt`. The `tools` field is **restrictive** (allow-list), not
  advisory — unknown names leave the agent with nothing useful.
  Fix: omit the field so prompts inherit Agent-mode's default tool set.
  ([#1](https://github.com/shinyay/tokopt-vscode/issues/1))

### Changed

- `token-doctor` and `prompt-optimizer` agents now include
  **sandbox-awareness guidance** so they don't issue 3–8 probing
  commands to discover `~/go/bin/tokopt` in VS Code Chat's default
  sandboxed terminal. Detection sequence is now ≤2 commands.
  ([#2](https://github.com/shinyay/tokopt-vscode/issues/2))

### Docs

- README: added explicit `> [!IMPORTANT]` Prerequisite callout above
  install steps, emphasising that the `tokopt` CLI is required.
  ([#4](https://github.com/shinyay/tokopt-vscode/issues/4))

### Verification

End-to-end validated in VS Code Insiders Chat (workspace install +
Agent mode, validation session 5f73a7a0, 2026-05-30):

| Test | Result |
|---|---|
| `/token-audit` | ✅ runs `tokopt audit .`, returns always-on / conditional / on-demand buckets |
| `/slim-suggest <path>` | ✅ customization-aware pipeline correctly preserves `.agent.md` files |
| `/prompt-anatomy <path>` | ✅ returns 7-segment table output |

Pre-fix, all three tests failed identically with "the only tool
available here is the session-store SQL tool". Post-fix, all three
pass.

Full validation summary:
[getting-started-with-token-optimization#11 comment](https://github.com/shinyay/getting-started-with-token-optimization/issues/11#issuecomment-4581049981).

### Deferred to future releases

- [#3](https://github.com/shinyay/tokopt-vscode/issues/3) (P2) —
  `install-user.sh` tokopt detection
- [#5](https://github.com/shinyay/tokopt-vscode/issues/5) (P4) —
  `install-workspace.sh --dry-run` argument parsing

## [0.1.0] — 2026-05-28

Initial release. VS Code Copilot Chat companion to
[`tokopt-skills`](https://github.com/shinyay/tokopt-skills) (the Copilot CLI plugin).

### Added

- **2 custom agents** (`.github/agents/`):
  - `token-doctor` — full optimisation orchestrator (measure → diagnose → propose → apply → re-measure)
  - `prompt-optimizer` — propose-only critic for a single prompt
- **9 skills** (`.github/skills/`) — byte-identical to `tokopt-skills` (open
  [agentskills.io](https://agentskills.io) standard):
  `token-audit`, `prompt-anatomy`, `antipattern-scan`, `heavy-tail`,
  `slim-suggest`, `slim-apply`, `slim-rewind`, `hygiene-coach`,
  `prompt-optimizer`
- **4 slash-command prompts** (`.github/prompts/`) — VS Code-native UX wrappers:
  `/token-audit`, `/prompt-anatomy`, `/slim-suggest`, `/slim-apply`
- **Install scripts** (`scripts/`):
  - `install-workspace.sh <target-repo>` — drop the assets into one project's
    `.github/`
  - `install-user.sh` — copy agents + skills into `~/.copilot/` for use in
    every workspace (prompts are workspace-scoped only per VS Code spec)
  - `uninstall.sh` — manifest-driven surgical removal of files placed by
    `install-user.sh`
- README with measured token footprint, install instructions for both scopes,
  and a file-format mapping table to `tokopt-skills`.

### Measured footprint (`tokopt audit .`, encoding `o200k_base`)

| Scope | Tokens | Notes |
|---|---:|---|
| always-on | **0** | intentional — no `copilot-instructions.md` |
| conditional | 2,094 | 2 agent definitions; loaded only when invoked |
| on-demand | 7,697 | 9 skills + 4 prompts; loaded only when matched/invoked |
| **total** | **9,791** | worst case; never fully resident in one turn |

Typical interactive cost: **2–4 K tokens** per relevant turn (1 agent + 1–2
matched skills + optionally 1 invoked prompt).

### Known limitations

- **`prompt-optimizer` name collision** — `prompt-optimizer` exists both as an
  agent (`.github/agents/prompt-optimizer.agent.md`) and as a skill
  (`.github/skills/prompt-optimizer/SKILL.md`). VS Code Chat treats agents
  and skills as separate namespaces, but this has not been GUI-validated yet.
  If you see issues, the safest workaround is to install only one scope.
- **`slim-apply` listing in VS Code Chat** — the CLI plugin sibling
  (`tokopt-skills` v0.1.0) silently drops `slim-apply` from `/skills list`
  output. Whether VS Code Chat exhibits the same behaviour is an open
  question tracked in
  [`tokopt-skills#4`](https://github.com/shinyay/tokopt-skills/issues/4).
- **No always-on file** — by design, this package does **not** ship a
  `.github/copilot-instructions.md`. If you want a small token-hygiene
  reminder loaded on every turn, author a 10–30 line one yourself in your
  repo's `.github/copilot-instructions.md`.

### Companion repositories

- [`shinyay/tokopt`](https://github.com/shinyay/tokopt) — the `tokopt` CLI
  binary required to actually run any of these workflows
- [`shinyay/tokopt-skills`](https://github.com/shinyay/tokopt-skills) — same
  agents + skills as a Copilot CLI plugin (for terminal use)
- [`shinyay/getting-started-with-token-optimization`](https://github.com/shinyay/getting-started-with-token-optimization)
  — book + reference repo that hosts the upstream `tokopt` source under
  `tools/tokopt/`
