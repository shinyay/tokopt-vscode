---
description: Preview how many tokens a file or directory would save under tokopt slim — read-only, never modifies anything.
argument-hint: '[file-or-dir] [--profile NAME]'
tools: ['terminal']
---

Run `tokopt slim <path> --format json` and report the preview. **Read-only** — never run with `--apply` from this prompt; that flow belongs to `/slim-apply`.

When parsing the JSON output:

- For each file in `files[]`, surface `saved_tokens`, `saved_percent`, and any `warnings[]`.
- If `customization.detected=true` on a file (`SKILL.md`, `*.agent.md`, `*.instructions.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `.github/prompts/*.prompt.md`), quote `warnings[]` verbatim and recommend `tokopt detect` instead — mechanical compression savings on customization assets are near zero.
- Profiles the user can opt into (pass through to the command):
  - `--profile agents-md` — Copilot customization assets (forces auto-detect routing to be explicit)
  - `--profile api-json` — JSON specs (forces Lossy Ionizer)
  - `--profile claude-md` — Claude Code `CLAUDE.md` files
  - `--profile chat` — live prompts pasted into a chat box (forces strip)

For multi-turn JSONL chat transcripts, use `tokopt --format json chat-compact -i <file>` instead.

**Hand-off**: if the preview surfaces a mechanical candidate the user wants to act on, send them to `/slim-apply <file>` (single file, same `--profile`).
