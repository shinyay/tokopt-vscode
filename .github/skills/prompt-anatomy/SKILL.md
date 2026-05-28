---
name: prompt-anatomy
description: Decompose a single LLM prompt into the seven canonical segments (system, always-on, tools, history, retrieved, user, reasoning) and show where the tokens go. Use when a user asks "where are my tokens going?", "why is this prompt so big?", or wants to compare a before/after refactor.
---

# prompt-anatomy

Run `tokopt anatomy` to see the per-segment token breakdown.

## When to use

- A single prompt feels expensive and the user wants to know which
  segment dominates.
- Before/after a refactor — re-run anatomy and quote the deltas.
- When tuning history truncation, retrieved context limits, or tool
  catalog size — anatomy isolates the effect.

## How to invoke

If `tokopt` is on PATH, use it directly. Otherwise run from the repo:

```bash
(cd tools/tokopt && go run ./cmd/tokopt anatomy ...)
```

Either point at files for each segment:

```bash
tokopt anatomy \
  --system     ./prompt-parts/system.md \
  --always-on  ./prompt-parts/always-on.md \
  --tools      ./prompt-parts/tools.json \
  --history    ./prompt-parts/history.txt \
  --retrieved  ./prompt-parts/retrieved.txt \
  --user       ./prompt-parts/user.txt
```

…or pipe a JSON object whose keys mirror the flag names. Both
`always_on` and `always-on` are accepted; unknown keys are rejected:

```bash
echo '{"system":"…","always-on":"…","user":"…"}' | tokopt --format json anatomy --json -
```

## How to read the output

Look for a single segment that dominates. Common culprits:

- `tools` > 30 % → see the `antipattern-scan` skill (mcp-overload,
  verbose-tool-descriptions).
- `history` > 40 % → truncation or summarisation is overdue (Ch 13).
- `retrieved` > 50 % → over-retrieval; tighten `k` or rerank (Ch 12 P3).
- `always-on` > 25 % → run `token-audit`; the static config is too fat.

The tool currently emits warnings for:

- `user` < 1 % of input
- `system + always-on + tools` > 50 % of input
- `history` > 40 % of input
- `reasoning` > 20 % of input (when supplied)

If you provide only some segments, cross-segment ratios involving the
missing ones are skipped and a `partial input` note is added so the
remaining warnings are not misread.
