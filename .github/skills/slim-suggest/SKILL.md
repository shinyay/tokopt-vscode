---
name: slim-suggest
description: Preview how many tokens a markdown file or directory would save if compressed by tokopt slim, WITHOUT modifying anything. Use when a user asks "how much could I save on this file?", "preview slim on docs/", or before any apply step. Reports measured numbers only. Read-only.
---

# slim-suggest

Run `tokopt slim` in dry-run mode. Never touches the file.

## When to use

- A user asks "how much could I save by compressing this?".
- Before any apply step — always preview first.
- During PR review on markdown files.

## How to invoke

```bash
tokopt slim --input <file> --format json     # single file
tokopt slim <directory> --format json        # walk (.md/.markdown only)
```

## Profile selection (Phase 4.0/4.1/4.2)

Four opt-in profiles bundle common flag combinations. Default
(no profile) remains correct for `docs/`, READMEs, and arbitrary
markdown — the CLI's customization auto-detect still fires.

- `--profile agents-md` — for Copilot customization assets
  (`AGENTS.md`, `.github/copilot-instructions.md`,
  `.github/prompts/*.prompt.md`, `*.agent.md`, `*.instructions.md`,
  `skills/*/SKILL.md`). Forces `--emphasis=preserve`. Auto-detect
  already routes these paths; the flag makes intent explicit and
  echoes `profile_used:"agents-md"` in the JSON for audit.
- `--profile api-json` (Phase 4.2) — for JSON inputs (OpenAPI,
  schemas, tool catalogs). Forces `--lossy`; Ionizer + TonForm
  do the work. Mismatch warning fires on non-JSON.
- `--profile claude-md` — opt-in for `CLAUDE.md`-style files
  (Claude Code customization). Adds Japanese-idiom + cosmetic
  compression on top of standard slimming.
- `--profile chat` (Phase 4.1) — for live prompts pasted into
  Copilot Chat or another LLM chat box. Forces
  `--emphasis=strip`; if misused on a customization asset,
  `warnings[]` carries a safety message — surface it.

For multi-turn JSONL transcripts (not single prompts), use
`tokopt --format json chat-compact -i transcript.jsonl` (Phase 4.3
— the global `--format json` flag swaps the default JSONL output
for a `CompactResult` summary on stdout so you can quote the
`saved_percent` / `saved_tokens` numbers; without it `chat-compact`
defaults to `--format jsonl` and emits the compacted transcript).
When tool messages dominate cost, add `--max-tool-output N` (Phase 4.4) to
structurally collapse large tool outputs (JSON-ionized or
prefix-truncated; default `0` = OFF). The symmetric Phase 4.4.b
flag `--max-assistant-tool-calls N` collapses large `tool_calls`
fields on assistant messages while preserving every call's id,
type, and function name (default `0` = OFF). Phase 4.4.c adds
`--tool-include` / `--tool-exclude` globs (exclude wins) that
gate both stages by tool name.

```bash
tokopt slim --input AGENTS.md --profile agents-md --format json
tokopt slim --input CLAUDE.md --profile claude-md --format json
```

`profile_used` is absent from the JSON when no `--profile` was
passed (`omitempty`). If the user later applies this preview,
slim-apply MUST use the SAME profile state — same name in both, or
no profile in both. Adding, removing, or changing `--profile`
between preview and apply breaks the safety contract.

## How to read the JSON

- single: `original_tokens` / `compressed_tokens` / `saved_percent`
- batch: `summary.saved_tokens` / `summary.saved_percent_overall`
- `stage_breakdown[]` shows which stage saved what

## Error handling

Read `error.code` from the JSON payload (Step 9 contract):

- `FILE_NOT_FOUND` — ask for the correct path
- `POSITIONAL_IS_FILE` — switch to `--input <file>`
- `POSITIONAL_CONFLICT` — never pass both positional and `--input`
- any other code — report the message; do not retry

## Reporting back

Quote actual numbers. Example: "Slim would reduce `docs/foo.md`
from 5,322 to 4,143 tokens (22.2 %). Top contributor: NexusEn
(English stopword removal)."

## Customization-aware mode (Step 10b)

When the path is a Copilot customization asset (`SKILL.md`,
`*.agent.md`, `*.instructions.md`, `.github/copilot-instructions.md`,
`AGENTS.md`, `.github/prompts/*.prompt.md`), slim auto-runs the
customization pipeline (NexusEn disabled, bold/italic preserved).
Savings will be near zero. Check `customization.detected/applied`
in the JSON; quote the warning and suggest `tokopt detect` for
structural anti-patterns. `--emphasis=strip` opts back to full slim.

## After preview: handing off to slim-apply

Read-only skill. If the user explicitly approves applying ("yes",
"apply it"), the `slim-apply` skill takes over for the destructive
write. Suggest: "Want me to apply this? I'll hand off to slim-apply,
which writes the change back with full git-backed safety."

For terminal use, the command is
`tokopt slim --input <file> --apply` — but through Copilot, prefer
the skill so the safety prose runs.
