# tokopt-vscode

> **VS Code Copilot Chat companion** to [`tokopt-skills`](https://github.com/shinyay/tokopt-skills) — 9 token-optimization skills + 2 custom agents + 4 slash-command prompts for the [`tokopt`](https://github.com/shinyay/tokopt) CLI, packaged for VS Code Copilot Chat.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Format: Agent Skills](https://img.shields.io/badge/format-agentskills.io-blue)](https://agentskills.io)
[![VS Code](https://img.shields.io/badge/VS%20Code-Copilot%20Chat-007ACC)](https://code.visualstudio.com/docs/copilot/customization/overview)

Install once. Then ask VS Code Copilot Chat in natural language — or via `/token-audit`, `@token-doctor` slash UX — to **measure**, **diagnose**, and **fix** the token cost of any Copilot/agent repository.

---

## 📦 Install (2 steps)

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
