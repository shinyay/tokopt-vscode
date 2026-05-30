# tokopt-vscode

> **VS Code companion to [`tokopt`](https://github.com/shinyay/tokopt)** — ships both a `.vsix` extension (inline token-cost **CodeLens**) and Copilot Chat assets (`@token-doctor`, `/token-audit`, etc.) for the [`tokopt-skills`](https://github.com/shinyay/tokopt-skills) ecosystem.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Format: Agent Skills](https://img.shields.io/badge/format-agentskills.io-blue)](https://agentskills.io)
[![VS Code](https://img.shields.io/badge/VS%20Code-Copilot%20Chat-007ACC)](https://code.visualstudio.com/docs/copilot/customization/overview)

Two complementary install surfaces — pick either, or both:

| Surface | What you get | Best for |
|---|---|---|
| **`.vsix` extension** (v0.2.0+) | Inline CodeLens (per-file token cost) + Diagnostics (anti-pattern findings in Problems panel) + Quick Fix (Cmd+. apply / preview / suppress) + Status bar (always-on tax for current workspace) on `copilot-instructions.md`, `*.agent.md`, `SKILL.md`, `*.prompt.md`, `*.chatmode.md`, `AGENTS.md` | Editing customization files — see cost, anti-patterns, and one-click fixes ambiently |
| **`scripts/install-*.sh`** (v0.1.x) | `.github/agents/`, `.github/skills/`, `.github/prompts/` assets for Copilot Chat | Running `@token-doctor` / `/token-audit` in Copilot Chat |

Both rely on the same [`tokopt`](https://github.com/shinyay/tokopt) Go CLI for measurement.

---

> [!IMPORTANT]
> **Prerequisite**: the `tokopt` binary must be on `PATH`. Without it, every slash command, agent, and the extension's CodeLens will silently disable themselves. Install:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/shinyay/tokopt/main/scripts/install.sh | sh
> ```
> Verify with `tokopt --version`.

---

## 🖼️ The CodeLens (`v0.2.0`)

When you open a recognised customization file in VS Code, you'll see one CodeLens at the top of the file:

```
▸ 1,394 tokens (conditional, paid when agent invoked)
# My Agent

You are a helpful…
```

Click the CodeLens for a breakdown plus suggested follow-up commands (`tokopt anatomy`, `tokopt detect`).

### Recognised file kinds

| Path / extension | Cost class | Meaning |
|---|---|---|
| `copilot-instructions.md` | **always-on** | paid on every Copilot request |
| `*.agent.md` | **conditional** | paid only when `@agent-name` is invoked |
| `*.chatmode.md` | **conditional** | paid only when the chat mode is activated |
| `SKILL.md` | **on-demand** | paid only when the skill loads via description match |
| `*.prompt.md` | **on-demand** | paid only when the slash command is invoked |

### Settings

| Setting | Default | Effect |
|---|---|---|
| `tokopt.codeLens.enabled` | `true` | Show / hide the CodeLens globally |
| `tokopt.diagnostics.enabled` | `true` | Surface `tokopt detect` anti-pattern findings in the Problems panel |
| `tokopt.binaryPath` | `"tokopt"` | Override if `tokopt` is not on `PATH` (use absolute path) |

### How it works under the hood

The extension calls `tokopt count --format=json <file>` (for CodeLens) and `tokopt detect --format=json <workspace>` (for Diagnostics) and dispatches strictly on the `format_version: "v1"` envelope ([upstream schema doc](https://github.com/shinyay/getting-started-with-token-optimization/blob/main/tools/tokopt/docs/cli-json-schema.md)). Anything other than `"v1"` triggers a one-time upgrade warning and silently disables the affected feature — a future `v2` schema will never crash the extension.

---

## 🩺 The Diagnostics (`v0.3.0`)

`tokopt detect` finds structural anti-patterns (kitchen-sink instruction files, format inflation, reasoning leakage, MCP overload, etc.) in customization assets. With v0.3.0, those findings show up in the **Problems panel** as you save:

```
.github/copilot-instructions.md
  ⚠ Always-on instruction file is large — 604 tokens sent on every interaction.
     Fix: Cut to the smallest set of rules that change behaviour. (~104 tokens saved) [Ch 14 #1]
```

Severities map as follows:

| Finding severity | VS Code severity |
|---|---|
| `critical` | Error |
| `high` | Error |
| `warn` | Warning |
| `info` | Information |

Each diagnostic carries the finding ID as its `code` (e.g. `kitchen-sink-system-prompt`) and `"tokopt"` as its `source`, so you can filter the Problems panel by either.

### Refresh model

The provider re-runs `tokopt detect` against the workspace when:

- the extension activates (initial scan, best-effort)
- you save a recognised customization file (other saves are ignored)
- you run **tokopt: Refresh Diagnostics** from the palette
- you change any `tokopt.*` setting

Run **tokopt: Clear Diagnostics** from the palette if you want to drop all findings temporarily (e.g. during a focused editing session). They'll be repopulated on the next save.

---

## 🩹 The Quick Fix (`v0.4.0`)

Every `tokopt` diagnostic now ships with a **lightbulb (Cmd+. / Ctrl+.)** menu so you can act on findings without leaving the editor.

```
.github/copilot-instructions.md
  ⚠ Always-on instruction file is large — 604 tokens sent on every interaction.
    💡 Preview tokopt slim diff for this file
    💡 Apply tokopt slim suggestion
    💡 Suppress `kitchen-sink-system-prompt` for this file
    💡 Learn more about `kitchen-sink-system-prompt` (Ch 14)
```

### Action set

| Action | What it does | Available for |
|---|---|---|
| **Preview slim diff** | Runs `tokopt slim`, opens the result side-by-side in the diff editor (no temp files — served from a `tokopt-slim:` virtual URI) | Mechanical-compression findings only |
| **Apply slim** | Replaces the whole document via a single undoable `WorkspaceEdit`. Reports `-N tokens (P%)` after | Mechanical-compression findings only |
| **Suppress `<id>`** | Appends `<!-- tokopt:disable=<id> -->` to the document | Markdown files only |
| **Learn more about `<id>`** | Opens the [anti-patterns chapter](https://github.com/shinyay/getting-started-with-token-optimization/blob/main/docs/14-anti-patterns-and-pitfalls.md) | Always offered |

### Slim-fixable rules (the `SLIM_FIXABLE` allow-list)

Apply / Preview are deliberately offered for **only three** finding IDs:

- `kitchen-sink-system-prompt`
- `verbose-auto-generated-instructions`
- `huge-agents-md`

All other findings — `mcp-*`, `verbose-tool-descriptions`, `polite-filler`, `format-inflation`, `possible-policy-tension`, `reasoning-leakage` — get **Suppress + Learn more only**, never a destructive mechanical fix. The reasons:

- **JSON safety**: `verbose-tool-descriptions` and `mcp-*` live in JSON config. Running `tokopt slim` on JSON routes through TonForm, which can rewrite valid JSON as TOON — that silently breaks MCP config.
- **Behavioural meaning**: `polite-filler`, `format-inflation`, `possible-policy-tension`, `reasoning-leakage` all flag *specific phrases* in context, not boilerplate. Stopword stripping won't touch them; only restructuring will.

### Suppression syntax

Add this HTML comment anywhere in a markdown file to silence a specific finding for that file only:

```markdown
<!-- tokopt:disable=kitchen-sink-system-prompt -->
```

Rules:

- Markdown only (JSON / YAML config have no equivalent — the Suppress action is omitted there).
- One rule per comment; multiple comments may appear in the same file.
- Case-insensitive. Take effect on the **next** diagnostic refresh (i.e. after you save).
- The **Suppress** Quick Fix inserts the comment via an in-memory edit — it does **not** auto-save your buffer, because saving would silently persist any unrelated unsaved edits. You'll see *"Save the file to clear the diagnostic"* in the toast.

### Safety guarantees

- **Dirty-buffer protection** — Apply / Preview refuse to run on an unsaved buffer. You're prompted to save first so slim's output matches the bytes you actually intend to ship.
- **Single undoable edit** — Apply replaces the whole document with one `WorkspaceEdit`, so `Ctrl+Z` restores the pre-slim text in one keystroke.
- **No fabricated savings** — if `tokopt slim` reports `saved 0`, the Apply action shows *"no mechanical savings — consider restructuring instead"* and aborts.

---

## 📊 The Status bar (`v0.5.0`)

A right-aligned status-bar item shows the **always-on tax** for the
current workspace — the sum of tokens across well-known global
customization files at the workspace root and `.github/`.

```
… $(file-text) 1,234 tokens always-on
```

When the active editor is itself a customization file that **isn't** in
the always-on tax (e.g. an `.agent.md` or `SKILL.md`), the headline
appends the current file's count:

```
… $(file-text) 1,234 tokens always-on / current: 879
```

### What's counted in the "always-on" tax

A **strict six locations** per workspace folder — NO recursive walk:

| Filename | Workspace root | Under `.github/` |
|---|---|---|
| `copilot-instructions.md` | ✅ | ✅ |
| `instructions.md` | ✅ | ✅ |
| `AGENTS.md` | ✅ | ✅ |

This is deliberately stricter than the CodeLens classifier. `docs/AGENTS.md`, `packages/foo/AGENTS.md`, or any nested `instructions.md` are **never** counted in the tax — only files at conventional global injection points.

### Colour coding

| Tokens | Background |
|---|---|
| `< warnThreshold` (default 500) | none |
| `>= warnThreshold` | `statusBarItem.warningBackground` (yellow) |
| `>= errorThreshold` (default 1500) | `statusBarItem.errorBackground` (red) |

Tooltip on hover shows the per-file count, file count, configured thresholds, and a click hint. Click the item to dump a per-file breakdown into the **tokopt** output channel.

### Refresh triggers

- Activation (best-effort initial scan)
- Save of a strict always-on file (debounced 250ms — multiple rapid saves collapse into one rescan)
- External create / change / delete of a strict always-on file (via `FileSystemWatcher`)
- Active-editor change (current-file appendix only — does NOT re-scan the tax)
- Workspace folders added / removed
- `tokopt: Refresh Status Bar` (palette)
- Any `tokopt.*` setting change

### Settings

```jsonc
{
  "tokopt.statusBar.enabled": true,
  "tokopt.statusBar.warnThreshold": 500,
  "tokopt.statusBar.errorThreshold": 1500
}
```

### Hidden when

- `tokopt.statusBar.enabled` is `false`
- No workspace folders
- No always-on files found in any strict location
- `tokopt` binary missing (the existing one-time hint covers install guidance)

---

## 🌲 The TreeView (`v0.6.0`)

Adds a **Token Cost** view to the Explorer sidebar — a browsable
inventory of every customization file `tokopt audit` finds in your
workspace, **grouped by runtime scope** and **sorted by token count
descending**.

| Group | What it contains | Why it matters |
|---|---|---|
| 🟢 **Always-on** | `copilot-instructions.md`, `AGENTS.md`, root `instructions.md` | Loaded into _every_ Copilot turn. Every token here is paid every turn. |
| 🟡 **Conditional** | `*.instructions.md` (scoped), `mcp.json`, `mcp-config.json` | Loaded when their conditions match (glob / tool / chat mode). |
| 🔵 **On-demand** | `*.agent.md`, `*.chatmode.md`, `*.prompt.md`, `SKILL.md` | Loaded only when explicitly invoked (`@agent`, `/prompt`, mode switch). |

Each row shows `<rel/path>  · <N tokens>` and gets a **colored icon**
based on size — green ≤ 500 tokens, yellow ≥ `treeView.warnThreshold`
(default 500), red ≥ `treeView.errorThreshold` (default 1500). The
category headers carry the same icon system applied to the group total.

**Right-click any file** to:

- **Open** — jump to it in the editor.
- **Run tokopt slim** — opens a side-by-side diff preview of the
  slimmed version (markdown files only; JSON configs stay verbatim).
- **Run tokopt detect** — runs `tokopt detect` on the containing
  workspace folder and surfaces findings for just this file into the
  output channel.

**Title-bar button**: 🔄 **Refresh** — bumps generation, drops the
per-folder cache, schedules a fresh `tokopt audit`. Useful after
external file edits or for forcing a re-scan.

**Palette command**: `tokopt: Show audit breakdown in output channel`
— dumps the cached `tokopt audit --format=json` output for inspection
without re-running the audit.

### Lazy by default

The TreeView does **zero work** on extension activation. The first
audit only runs once you actually open the panel
(`onView:tokoptTokenCost` is registered as an activation event, so
opening the panel will bring the extension up if it wasn't already).
Subsequent saves, watcher events, and workspace-folder changes
schedule debounced refreshes — 250 ms coalescing window, single
in-flight audit with mutex.

### Welcome states

When the tree has no data to show, a contextual welcome message
explains why:

- **Loading** — initial audit in progress.
- **`tokopt` binary not found** — links to the install script.
- **No customization files found** — explains which file types the
  audit looks for.
- **Audit failed** — links to the output channel for details.

### Settings (3 keys)

```jsonc
{
  // Show the Token Cost panel in the Explorer sidebar (default: true).
  "tokopt.treeView.enabled": true,

  // Yellow icon threshold for file + category rows.
  "tokopt.treeView.warnThreshold": 500,

  // Red icon threshold. Clamped to be >= warnThreshold at runtime.
  "tokopt.treeView.errorThreshold": 1500
}
```

### When the view is hidden

The Token Cost view hides itself entirely when
`tokopt.treeView.enabled` is `false` (via a `when:
"config.tokopt.treeView.enabled"` clause on the view contribution).
Set it back to `true` and the view reappears without a window reload.

---

### Install the extension

For now, install from a built `.vsix` (marketplace publishing TBD):

```bash
# Build locally
git clone https://github.com/shinyay/tokopt-vscode.git
cd tokopt-vscode
npm install && npm run package
code --install-extension tokopt-vscode-*.vsix
```

---

## 📦 Install the Copilot Chat assets (v0.1.x — independent of the extension)

### Step 1 — Install the `tokopt` binary

```bash
curl -fsSL https://raw.githubusercontent.com/shinyay/tokopt/main/scripts/install.sh | sh
```

Verify: `tokopt --version`

### Step 2 — Install this repo's assets

Pick **one** of the two scopes below.

#### Option A — User profile (recommended, install once)

Makes all agents + skills available in **every** workspace.

```bash
git clone https://github.com/shinyay/tokopt-vscode.git ~/.local/share/tokopt-vscode
cd ~/.local/share/tokopt-vscode
./scripts/install-user.sh
```

This copies:
- `.github/agents/*.agent.md` → `~/.copilot/agents/`
- `.github/skills/*/SKILL.md` → `~/.copilot/skills/`

Prompts (`.github/prompts/*.prompt.md`) are **repo-scoped only** per VS Code spec, so they are NOT installed at user scope.

#### Option B — Workspace (single repo)

Adds the assets to one project's `.github/` directory.

```bash
git clone https://github.com/shinyay/tokopt-vscode.git /tmp/tokopt-vscode
/tmp/tokopt-vscode/scripts/install-workspace.sh /path/to/your/repo
```

Verify (in either case): open VS Code Insiders, then in Copilot Chat type `@` — you should see `@token-doctor` and `@prompt-optimizer`. Type `/` — you should see `/token-audit`, `/prompt-anatomy`, `/slim-suggest`, `/slim-apply` (workspace install only).

---

## ✨ What you get

### 🤖 2 Custom agents (`.github/agents/`)

| Agent | Role | Tools |
|---|---|---|
| `@token-doctor` | Full optimisation orchestrator: measure → diagnose → propose → apply → re-measure | `bash`, `edit`, `view` |
| `@prompt-optimizer` | Propose-only critic for a single prompt — never edits files | `bash`, `view` |

### 🧩 9 Skills (`.github/skills/`)

| Skill | When it loads | Calls |
|---|---|---|
| `token-audit` | "audit my repo", "always-on tax" | `tokopt audit` |
| `prompt-anatomy` | "decompose this prompt", "7 segments" | `tokopt anatomy` |
| `antipattern-scan` | "find token antipatterns" | `tokopt detect` |
| `heavy-tail` | "find longest prompts", "p95 cost" | `tokopt tail` |
| `slim-suggest` | "show what could be slimmed" | `tokopt slim` (read-only) |
| `slim-apply` | "apply the slim", "compact this transcript" | `tokopt slim --write` |
| `slim-rewind` | "undo the last slim", "restore" | `tokopt rewind` |
| `hygiene-coach` | "make it healthier", "cleanup" | recommends + delegates |
| `prompt-optimizer` | "review this prompt", "improve writing quality" | propose-only critic |

### 💬 4 Slash-command prompts (`.github/prompts/`)

VS Code-native slash UX for the most-frequent flows:

- `/token-audit` — repository-wide token audit
- `/prompt-anatomy <file>` — break a prompt into 7 segments
- `/slim-suggest <path>` — read-only compression preview
- `/slim-apply <file>` — write compressed output (requires prior `/slim-suggest` for same file)

---

## 💸 Token footprint of this package itself

Measured with `tokopt audit .` on a clean install (encoding `o200k_base`):

```text
always-on    0 tokens     (intentional — no copilot-instructions.md)
conditional  2,094 tokens (2 agent files — paid per step only when invoked)
on-demand    7,697 tokens (9 SKILL.md + 4 .prompt.md — paid only when matched/invoked)
─────────────────────────────────────────────────────────────────────────────
total        9,791 tokens (worst case — never fully resident)
```

Breakdown:

| Category | File | Tokens |
|---|---:|---:|
| conditional | `token-doctor.agent.md` | 1,261 |
| conditional | `prompt-optimizer.agent.md` | 833 |
| on-demand (skill) | `slim-suggest/SKILL.md` | 1,244 |
| on-demand (skill) | `slim-apply/SKILL.md` | 877 |
| on-demand (skill) | `slim-rewind/SKILL.md` | 827 |
| on-demand (skill) | `hygiene-coach/SKILL.md` | 820 |
| on-demand (skill) | `antipattern-scan/SKILL.md` | 670 |
| on-demand (skill) | `prompt-anatomy/SKILL.md` | 577 |
| on-demand (skill) | `heavy-tail/SKILL.md` | 504 |
| on-demand (skill) | `token-audit/SKILL.md` | 418 |
| on-demand (skill) | `prompt-optimizer/SKILL.md` | 364 |
| on-demand (prompt) | `slim-apply.prompt.md` | 617 |
| on-demand (prompt) | `slim-suggest.prompt.md` | 352 |
| on-demand (prompt) | `token-audit.prompt.md` | 233 |
| on-demand (prompt) | `prompt-anatomy.prompt.md` | 194 |

In practice, a single chat turn loads at most **1 agent** (~1.3 K) **+ 1–2 matched skills** (~500–1.2 K each) **+ 1 invoked prompt** (~200–600). Typical interactive cost: **2–4 K tokens** per relevant turn. Re-verify locally with:

```bash
tokopt audit .
```

---

## 🔄 File-format mapping (CLI plugin ↔ VS Code Chat)

This package is the VS Code Chat sibling of [`tokopt-skills`](https://github.com/shinyay/tokopt-skills) (the Copilot CLI plugin). Both ship the **same agent + skill bodies** (open [agentskills.io](https://agentskills.io) standard); only the distribution wrapper differs.

| CLI plugin (`tokopt-skills`) | VS Code (`tokopt-vscode`) | Notes |
|---|---|---|
| `agents/*.agent.md` | `.github/agents/*.agent.md` | Same extension, same `name`/`description`/`tools` frontmatter |
| `skills/<name>/SKILL.md` | `.github/skills/<name>/SKILL.md` | Open standard, byte-identical body |
| `plugin.json` | None — `.github/` IS the manifest | |
| (no slash command UX) | `.github/prompts/*.prompt.md` | VS Code-only — 4 thin wrappers for top flows |

If you run **both** tokopt-skills (CLI) AND tokopt-vscode (user-profile install): the CLI plugin loads from `~/.copilot/installed-plugins/_direct/tokopt-skills/` and tokopt-vscode loads from `~/.copilot/agents/` + `~/.copilot/skills/`. VS Code does **not** scan the CLI plugin path by default, so there is no double-load. To avoid confusion, pick one surface and stick to it per workstation.

---

## 🔧 Requirements

- **VS Code Insiders** with **GitHub Copilot Chat** extension (Agent Skills support shipped 2026)
- **`tokopt` binary** (from Step 1) — required at runtime by every skill, agent, and prompt
- Linux / macOS / Windows (WSL recommended for the install scripts)

---

## ⚠️ Known limitations

### Coexistence with `tokopt-skills` CLI plugin

If you have both installed at user scope, VS Code Chat shows entries from `~/.copilot/agents/` + `~/.copilot/skills/` (this package), while the Copilot CLI loads from `~/.copilot/installed-plugins/_direct/tokopt-skills/` (the plugin). These are **separate code paths** and do not duplicate, but the wording / version may drift if updated independently. Re-run `install-user.sh` after pulling tokopt-vscode updates.

### `slim-apply` listing

The CLI plugin has a known upstream issue ([copilot-cli#3546](https://github.com/github/copilot-cli/issues/3546)) where `slim-apply` is silently dropped from `/skills list`. This repo serves as an **A/B test**: if `/slim-apply` works correctly in VS Code Chat, the bug is CLI-loader-specific. Status is tracked in [tokopt-skills#4](https://github.com/shinyay/tokopt-skills/issues/4).

---

## 🙋 Where this comes from

These skills + agents started life in [`shinyay/getting-started-with-token-optimization`](https://github.com/shinyay/getting-started-with-token-optimization) — a 14-chapter tutorial / reference / workshop on token optimisation across the full Copilot / agent stack.

`tokopt-vscode` is the **VS Code Chat distribution package** extracted from that work. For the Copilot CLI distribution, see the sibling repo [`shinyay/tokopt-skills`](https://github.com/shinyay/tokopt-skills).

---

## 📜 License

MIT — see [LICENSE](LICENSE).
