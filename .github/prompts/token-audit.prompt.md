---
description: Run a token audit on the current repository — measures always-on, conditional, and on-demand token tax.
---

Run `tokopt audit .` in the workspace root and report the result. Group findings into three buckets:

1. **always-on**: paid on every interaction. Strict budget. If >1500 tokens, recommend `tokopt detect`.
2. **conditional**: scoped instructions, MCP config, agent definitions — paid when their condition fires.
3. **on-demand**: skill bodies + prompt files — paid only when triggered.

If a `--reference-window` value would be helpful (e.g., to express always-on as a % of a typical context), ask the user for the window size; the CLI deliberately omits a default.

**Do NOT**:

- Multiply numbers by any per-token price guess. The tool omits dollars on purpose.
- Promise that other model families tokenize identically — the tokenizer is a local approximation.

If `tokopt` is not on `PATH`, fall back to `(cd tools/tokopt && go run ./cmd/tokopt audit ..)`.
