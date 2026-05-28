---
name: slim-apply
description: Apply tokopt slim's compression IN-PLACE after the user has reviewed a slim-suggest preview AND explicitly approved. Writes compressed output back to disk with full safety: requires clean git tree, refuses symlinks, detects races. Use ONLY when the prior turn ran slim-suggest for the SAME single file. Never for first-pass analysis.
---

# slim-apply

Run `tokopt slim --apply` to write the compressed output back.
Destructive. The CLI's safety ladder protects the file (clean git
tree, symlink refusal, race detection, atomic write).

## When to use

ONLY when ALL of these hold:

1. `slim-suggest` ran in the immediately prior turn for the SAME
   single file.
2. User explicitly approved ("yes", "apply", "do it").
3. Target is a file path (NOT stdin, NOT a directory).

If unclear, ask the user. Never assume.

## How to invoke

```bash
tokopt slim --input <file> --apply --format json
```

On success the JSON has `apply.wrote=true`, `apply.reason="applied"`,
plus `saved_tokens` / `compressed_tokens`.

## Error handling

Read `error.code` from the JSON payload:

- `TREE_NOT_CLEAN` — STOP. Tell user to `git commit` or `git stash`
  first, then re-run. Do NOT bypass.
- `SYMLINK_REJECTED` — Tell user the file is a symlink; suggest
  applying to the target.
- `RACE_DETECTED` — Tell user the file changed; suggest re-running
  slim-suggest first.
- `FILE_NOT_FOUND` — Confirm the path.
- any other code — Surface the message verbatim. Do not retry.

## Reporting back

Quote `apply.wrote`, `apply.reason`, and the delta. Example:
"Applied. `docs/foo.md` went 5,322 → 4,143 tokens (saved 1,179,
22.2 %). Top contributor: NexusEn."

## Profile pass-through (Phase 4.0/4.1)

If the prior `slim-suggest` was invoked with `--profile NAME`, the
matching `slim-apply` MUST use the same `--profile NAME`.
Symmetrically, if the preview used no profile, the apply must also
use no profile. Adding, removing, or changing `--profile` between
preview and apply means the apply diff is not what the user
reviewed.

```bash
# preview
tokopt slim --input AGENTS.md --profile agents-md --format json
# apply (same profile)
tokopt slim --input AGENTS.md --profile agents-md --apply --format json
```

The JSON's `profile_used` field is the audit signal: it must be
identical (same string, or absent in both) between preview and
apply for the user-quoted delta to be honest.

## Customization-aware mode (Step 10b)

If the target is a customization asset (`SKILL.md`, `*.agent.md`,
`*.instructions.md`, `.github/copilot-instructions.md`, `AGENTS.md`,
`.github/prompts/*.prompt.md`), slim auto-runs the customization
pipeline. When `customization.applied=true`, savings are near zero
and `tokopt detect` is the better tool for further reduction.

## DO NOT

- DO NOT add `--force`. The flag is terminal-only, never skill-use.
- DO NOT apply to a directory. Single file only. Repo-wide apply:
  user runs `tokopt slim <dir> --apply` in a terminal.
- DO NOT suppress the apply outcome.
- DO NOT use without a prior slim-suggest for the same file.
- DO NOT use `--emphasis=strip` on customization assets without
  explicit consent — emphasis carries semantic weight.
- DO NOT add, remove, or change `--profile` between the preview
  and the apply for the same file. The apply must match preview
  exactly: same profile name in both, or no profile in both.
  Mismatch means the apply diff is not what the user reviewed.
