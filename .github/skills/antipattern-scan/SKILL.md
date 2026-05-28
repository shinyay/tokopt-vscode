---
name: antipattern-scan
description: Scan a repository's Copilot/agent configuration for known token-wasting anti-patterns (kitchen-sink instructions, MCP overload, verbose tool descriptions, reasoning leakage, format inflation). Use when a user asks "what is wrong with my config?", "review my Copilot setup for waste", or after `token-audit` shows a high always-on tax.
---

# antipattern-scan

Run `tokopt detect` and read the findings. Each finding carries a
**confidence**: `measured` (savings derived from real token counts) or
`heuristic` (real pattern, behavioural impact, savings not measurable from
static config).

## When to use

- After `token-audit` shows always-on > ~1500 tokens.
- During a PR review that touches `.github/copilot-instructions.md`,
  `AGENTS.md`, `.github/instructions/*`, or any `mcp-config.json`.
- Before recommending any cut — quote the detector ID and evidence.

## How to invoke

If `tokopt` is on PATH, use it directly. Otherwise run from the repo:

```bash
(cd tools/tokopt && go run ./cmd/tokopt detect <repo-root>)
```

```bash
tokopt detect <repo-root>
tokopt --format json detect <repo-root>   # for tooling
tokopt --format md   detect <repo-root>   # for PR comments
```

## Finding catalogue (static-config detectors)

| ID | Confidence | What it flags |
|---|---|---|
| `kitchen-sink-system-prompt` | measured | `.github/copilot-instructions.md` over ~500 tokens |
| `verbose-auto-generated-instructions` | measured | scoped instruction file > 800 tokens |
| `huge-agents-md` | measured | `AGENTS.md` > 800 tokens |
| `mcp-overload` | measured / heuristic | ≥ 5 servers or ≥ 30 static tools (heuristic when no static `tools[]` is present — runtime tool catalog is not visible) |
| `mcp-config-unparseable` | measured | MCP config file is not valid JSON; silently disables tool-inventory measurement |
| `verbose-tool-descriptions` | measured | per-tool description > ~100 tokens |
| `reasoning-leakage` | heuristic | always-on file requests visible reasoning |
| `polite-filler` | heuristic | always-on file injects polite filler |
| `format-inflation` | heuristic | always-on file forces verbose output |
| `possible-policy-tension` | heuristic | substring co-occurrence of opposite rules (low-confidence lint) |

Findings that need usage logs (history growth, blob persistence, tool-result
echo) live in the `heavy-tail` skill, not here.

## How to respond

For **measured** findings: quote `up to ~N tokens (measured: …)` and
recommend the fix. The number is a real upper bound.

For **heuristic** findings: do **not** invent a savings number. Say it is
a real anti-pattern and that quantifying impact requires `tokopt tail` on
the user's actual usage log.
