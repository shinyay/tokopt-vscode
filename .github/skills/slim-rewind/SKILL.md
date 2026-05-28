---
name: slim-rewind
description: Recover the original JSON array collapsed by `tokopt slim --lossy` into a `_rewind:"sha256:..."` marker. Use ONLY when the user explicitly asks to recover / show / inspect data behind a specific hash. Strictly read-only.
---

# slim-rewind

Look up the original bytes for a `_rewind:"sha256:<hex>"` marker
via `tokopt rewind get <hash>`. Pure retrieval.

## When to use

ONLY when the user explicitly asks to recover / show / inspect
data behind a specific Rewind hash. If a hash merely appears in
output, mention the recovery command but **do not auto-retrieve**
— Rewind blobs may be large or sensitive; auto-recovery defeats
the slim savings.

## Store locality

`tokopt rewind get` only works against the SAME store used when
`tokopt slim --lossy` created the hash. Resolution priority:
`--rewind-store` flag > `TOKOPT_REWIND_STORE` env >
`<git-root>/.tokopt/rewind/` > `<cwd>/.tokopt/rewind/`. Run from
the same repo / cwd, or pass the same `--rewind-store`.

## How to invoke

```bash
tokopt rewind get sha256:<hex>
# or with explicit store
tokopt rewind --rewind-store /path/to/store get sha256:<hex>
```

Output is normalized JSON bytes (sorted object keys, no
whitespace, numerics decoded to float64) — **NOT** a byte-exact
copy of the original input. Whitespace, comment-style fields, and
unusual numeric encodings (e.g. trailing zeros) are lost during
the `json.Marshal` round-trip that the Rewind store performs
before hashing. Byte-exact recovery via `json.RawMessage` is a
future enhancement (not implemented in Phase 2.2). If a downstream
consumer needs character-identical input, keep an out-of-band copy
of the source — Rewind is a semantic recovery mechanism, not a
verbatim archive.

## Error handling

- `REWIND_BLOB_NOT_FOUND` / `REWIND_STORE_NOT_FOUND`: **NEVER**
  claim data loss. Ask: "Which `--rewind-store` was active when
  you ran `tokopt slim --lossy`?" The hash may belong to a
  different store.
- `REWIND_CORRUPTED`: tampered or bit-rot; report verbatim.

## DO NOT

- DO NOT auto-recover hashes that merely appear in output.
- DO NOT edit / write / apply anything (pure retrieval).
- DO NOT hand off to `slim-apply` (different workflow).
- DO NOT claim data loss before checking store path.
- DO NOT invoke `tokopt rewind clean` without `--dry-run` first when
  recovering; deleting blobs is irreversible and does NOT consult
  `_rewind:` markers in source files.

## Store hygiene (Phase 2.2)

If the user asks about store size or aging:

```bash
tokopt rewind stats                          # count, total size, oldest/newest
tokopt rewind stats --format json            # JSON for inspection
```

If the user explicitly asks to garbage-collect (use `--dry-run` first):

```bash
tokopt rewind clean --older-than 30d --dry-run
tokopt rewind clean --max-size 100MB --keep-recent 10 --dry-run
```

Combinable policies (OR semantics): `--older-than`, `--max-size`,
`--max-blobs`. `--keep-recent N` is a safety floor that ALWAYS wins
over the other policies. **Cleaning blobs does NOT scan source files
for `_rewind:` markers** — recommend `--keep-recent` if the user is
unsure whether any slimmed files still reference recent blobs.

