# Changelog

All notable changes to **tokopt-vscode** will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- Bundle: 5.6 KB → 9.6 KB (added detect/diagnostics modules)
- `.vsix`: 12 KB → 15 KB
- Extended `activationEvents` — extension now activates eagerly when a
  workspace contains any of `**/.github/copilot-instructions.md`,
  `**/copilot-instructions.md`, `**/*.agent.md`, `**/SKILL.md`. CodeLens
  still relies on the original `onLanguage:markdown` activation; the new
  events ensure the initial diagnostic scan runs without waiting for the
  user to open a markdown file first.

### Notes

- Findings are anchored to line 0 of each file. `tokopt detect` reports
  file-level findings (no line numbers), so this matches the data shape
  rather than guessing.
- Detectors that aggregate across multiple files (e.g. MCP overload)
  emit free-form location strings that aren't real paths. Those
  findings are silently skipped for now — they're better surfaced via
  the existing terminal output. A future enhancement could route them
  to a dedicated Output channel.

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
