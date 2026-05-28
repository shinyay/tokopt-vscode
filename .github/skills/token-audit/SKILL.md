---
name: token-audit
description: Measure the always-on, conditional, and on-demand token tax that a repository's Copilot/agent configuration imposes. Use when a user asks "how many tokens am I paying every call?", "what is my prompt overhead?", or "audit my Copilot config".
---

# token-audit

Run `tokopt audit` against the user's repository root and report the result.

## When to use

- The user asks for the cost of their always-on configuration.
- A PR adds or grows `.github/copilot-instructions.md`, `AGENTS.md`,
  `.github/instructions/*`, MCP config, or agent definitions.
- Before recommending any optimisation — measure first.

## How to invoke

```bash
(cd tools/tokopt && go run ./cmd/tokopt audit <repo-root>)
# or, after `go install`, just:
tokopt audit <repo-root>
```

For a JSON payload (machine-readable):

```bash
tokopt --format json audit <repo-root>
```

To express the always-on tax as a percentage of a chosen window size
(opt-in, no default — the tool refuses to bake in a window):

```bash
tokopt --reference-window 100000 audit <repo-root>
```

## How to read the output

Three buckets — read them in this order:

1. **always-on tax**: paid on every interaction. Treat as the strict budget.
2. **conditional**: scoped instructions, MCP config, agent definitions —
   paid only when the matching condition fires.
3. **on-demand**: skill bodies — paid only when triggered.

If always-on > ~1500 tokens, recommend running `tokopt detect` to find
specific anti-patterns.

## What not to do

- Do not multiply the always-on number by a price guess. The tool
  deliberately omits dollars; pricing changes too fast.
- Do not promise that other model families will tokenize identically.
  The tokenizer is a local approximation, not a billing oracle.
