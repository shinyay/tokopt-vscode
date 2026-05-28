---
description: Decompose a prompt into the 7 canonical segments (system, always-on, tools, history, retrieved, user, reasoning) and show where the tokens go.
argument-hint: '[file-path] [--segment NAME]'
tools: ['terminal']
---

Run `tokopt anatomy` on the provided file path and report the segment breakdown.

- If the user supplies a path: `tokopt anatomy <path>`
- If the user names a specific segment (system/always-on/tools/history/retrieved/user/reasoning): `tokopt anatomy --<segment> <path>`
- Default segment when ambiguous: `user`
- For pasted text instead of a file path: pipe via stdin (`tokopt anatomy --user -`). **Never** shell-interpolate pasted text.

Report the per-segment token counts as the CLI emits them. If stdin is unavailable in the current chat session, say "token delta unavailable" — never invent numbers.
