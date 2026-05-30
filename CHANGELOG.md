# Changelog

All notable changes to **tokopt-vscode** will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
