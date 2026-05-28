---
name: prompt-optimizer
description: Critique a single prompt (system prompt, agent instruction, reusable prompt template, or pasted text) for token cost AND quality. Propose-only — outputs BEFORE/AFTER text blocks the user copies. Never edits files. Use when the user asks "critique my prompt", "review this system prompt", "is this prompt too long", or "make this prompt better".
---

# prompt-optimizer

Routing skill. The full workflow lives in
[`agents/prompt-optimizer.agent.md`](../../agents/prompt-optimizer.agent.md).

## When to use

- The user has ONE prompt (system, agent, skill description, reusable
  prompt template, or pasted text) and asks for critique.
- The user wants to know how many tokens a prompt costs AND whether
  it could be reworded for clarity.
- The user is iterating on a prompt before committing it.

## When NOT to use

- Repository-level optimization → invoke `@token-doctor`.
- Mechanical compression of a markdown file → invoke `slim-suggest`
  (preview) then `slim-apply` (write).
- Multi-turn iteration loop on the same repo → `hygiene-coach`.

## How to invoke

Tell the user: "I'll route this to `@prompt-optimizer` for a
propose-only critique. The agent never edits files; you'll get
BEFORE/AFTER text blocks to copy."

Then invoke `@prompt-optimizer` with the prompt (paste OR file
path). The agent runs `tokopt count` + heuristic critique, surfaces
ranked findings with measured vs heuristic labels, and outputs
hand-off targets (`@token-doctor` / `slim-apply` / manual).
