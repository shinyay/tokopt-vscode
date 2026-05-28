---
name: heavy-tail
description: Analyse a usage log (JSONL or CSV) for the heavy tail of token consumption — p50/p90/p95/p99/max plus the top outlier records. Use when a user asks "what is driving my token bill?", "find my expensive calls", or "is my distribution heavy-tailed?".
---

# heavy-tail

Token usage is almost always heavy-tailed: a small fraction of calls
dominate the bill (Chapter 13). Static-config detectors can't see this —
you need real usage data.

## When to use

- The user has a usage log and wants to find the worst offenders.
- After cutting always-on overhead, to verify the tail moved.
- When `antipattern-scan` returns mostly heuristic findings — only the
  log can quantify behavioural waste.

## How to invoke

If `tokopt` is on PATH, use it directly. Otherwise run from the repo:

```bash
(cd tools/tokopt && go run ./cmd/tokopt tail --input usage.jsonl)
```

Each line of the input must contain a token count. Default JSON field /
CSV column is `tokens`; override with `--column`. Negative token counts
are rejected (real usage cannot be negative; a negative value indicates
broken instrumentation).

```bash
tokopt tail --input usage.jsonl
tokopt tail --input usage.csv --column total_tokens --top 10
cat usage.jsonl | tokopt tail --input -
tokopt --format json tail --input usage.jsonl
```

## How to read the output

- **p99 / p50 ratio** > 5 → heavy tail confirmed; cut outliers first,
  not averages.
- **top-share** of total tokens. For samples ≥ 100 records this is the
  top 1 %; for smaller samples the field is labelled `top_record_share`
  (the single largest record) so you don't read "top 1 %" off two rows.
  The heavy-tail hint is suppressed below 100 records.
- The outlier records list shows what the largest calls actually
  contained; inspect them for blob persistence, history bloat, or
  retrieved-context overflow.

## What not to do

- Do not optimise the median when the tail is heavy. The bill lives in
  the top quintile (Ch 13 §2).
- Do not multiply outliers by a price guess; report tokens.
