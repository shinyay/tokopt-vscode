---
description: Apply tokopt slim compression IN-PLACE after the user reviewed a slim-suggest preview AND explicitly approved. Destructive — writes to disk.
argument-hint: '[file] [--profile NAME]'
---

Run `tokopt slim --input <file> --apply --format json` to write the compressed output back to disk. **Destructive.** The CLI's safety ladder protects the file (clean git tree, symlink refusal, race detection, atomic write).

## Preconditions — refuse if ANY of these fails

1. `slim-suggest` (or `/slim-suggest`) ran in the immediately prior turn **for the SAME single file**.
2. The user explicitly approved this apply ("yes", "apply", "do it"). Implicit approval is not enough.
3. The target is a **file path** — NOT stdin, NOT a directory. For repo-wide apply, the user runs `tokopt slim <dir> --apply` in a terminal themselves.

If unclear, **ask the user**. Never assume.

## Profile pass-through

If the prior `slim-suggest` used `--profile NAME`, this apply MUST use the same profile. If the preview used no profile, the apply must also use no profile. Mismatched profiles mean the apply diff is not what the user reviewed.

```bash
# preview (run by /slim-suggest)
tokopt slim --input AGENTS.md --profile agents-md --format json
# apply (this prompt)
tokopt slim --input AGENTS.md --profile agents-md --apply --format json
```

The JSON `profile_used` field is the audit signal: it must be identical (same string, or absent in both) between preview and apply.

## Error handling

Read `error.code` from the JSON response:

- `TREE_NOT_CLEAN` → **STOP.** Tell user to `git commit` or `git stash` first. Do NOT bypass.
- `SYMLINK_REJECTED` → tell user the file is a symlink; suggest applying to the target.
- `RACE_DETECTED` → tell user the file changed; suggest re-running `/slim-suggest` first.
- `FILE_NOT_FOUND` → confirm the path.
- any other code → surface the message verbatim. **Do not retry.**

## On success

Quote `apply.wrote`, `apply.reason`, and the delta. Example:

> Applied. `docs/foo.md` went 5,322 → 4,143 tokens (saved 1,179, 22.2 %). Top contributor: NexusEn.

## DO NOT

- DO NOT add `--force`. The flag is terminal-only, never prompt-use.
- DO NOT apply to a directory.
- DO NOT use `--emphasis=strip` on customization assets without explicit consent — emphasis carries semantic weight.
- DO NOT add, remove, or change `--profile` between the preview and this apply.
