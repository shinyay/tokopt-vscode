---
name: hygiene-coach
description: Coach a user through reducing token consumption in their repository, grounding every recommendation in real numbers from the tokopt CLI. Use when a user asks "make my prompts cheaper", "help me cut my token bill", or for a guided optimisation pass.
---

# hygiene-coach

Interactive optimisation pass. The coach **never recommends without
measuring first**.

## When to use

- The user says "help me cut tokens" without a specific target.
- The user has run `token-audit` or `antipattern-scan` and asks "now
  what?".

## Workflow

This skill is the remediation loop. The orchestrator (`token-doctor`
agent) decides when to enter the loop; once inside, run these steps in
order. At each step, quote the actual number from the tool — never an
estimate.

1. **Baseline.** Invoke the `token-audit` skill. Note the always-on,
   conditional, and on-demand totals.
2. **Triage.** Invoke `antipattern-scan`. Sort findings by confidence:
   address all `measured` findings first; treat `heuristic` findings as
   secondary.
3. **Anatomy spot-check.** If the user has a representative prompt,
   invoke `prompt-anatomy` to see which segment dominates a single call.
4. **Tail check.** If the user has a usage log, invoke `heavy-tail` to
   confirm the p99/p50 ratio.
5. **Propose one change.** Pick the highest-impact option. Two
   candidate types:
   - **Structural**: a `measured` `antipattern-scan` finding
     pointing at an audit-inventory file. State the file and the
     exact edit. (Existing semantics.)
   - **Mechanical**: a file surfaced by the orchestrator's slim
     discovery step with `customization.applied != true`,
     `saved_percent > 5`, and `saved_tokens > 100`. Propose
     `slim-apply` on that file.

   **One iteration = one structural change OR one slim-apply,
   never both.** Mechanical and structural changes are separately
   attributable in the re-measure step. **Confirm with the user
   before editing.** Edit only files matched by `token-audit`;
   never touch source code or tests.
6. **Re-measure.** Re-run the same `token-audit` invocation with the
   same encoding and quote the before/after token counts (not
   percentages). If the always-on tax did not move, revert.

## Rules of engagement

- One change at a time. Compounding makes attribution impossible.
- Always quote the tool's number, never your own guess.
- Heuristic findings get advice, not numbers. Say so explicitly.
- Refuse to estimate dollar costs. Pricing belongs at the bill, not the
  design (Ch 4 §1).
- Do not invoke `token-doctor` from inside this loop; the orchestrator
  owns invocation. This skill is the inner loop only.
- For mechanical (slim-apply) changes, batch discovery is NOT
  enough. Re-run single-file `tokopt slim --input <file>
  --format json` in the same iteration so slim-apply's "prior turn
  ran slim-suggest for the SAME single file" precondition is met.
- If the single-file re-run passes `--profile NAME`, the
  subsequent slim-apply MUST pass the same `--profile NAME`.
  Verify via the JSON's `profile_used` field; mismatch breaks
  attribution and the slim-apply safety contract.
- For wording-level critique on a single prompt (vs structural or
  mechanical changes within this loop), refer the user to
  `@prompt-optimizer` — a propose-only one-shot review distinct
  from this inner loop.
