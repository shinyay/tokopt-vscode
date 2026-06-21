# Compatibility

The **canonical** compatibility matrix for the whole tokopt ecosystem lives in
the CLI repo and is the single source of truth:

➡️ **[shinyay/tokopt · COMPATIBILITY.md](https://github.com/shinyay/tokopt/blob/main/COMPATIBILITY.md)**

This page only records the extension's own requirement on the CLI.

## Extension → required tokopt CLI

| `tokopt-vscode` | Requires `tokopt` CLI | Notes |
|---|---|---|
| ≥ 0.13.0 | **≥ 0.10.0** for the model cost comparison (`tokopt report --by-model`) | Older CLI → comparison section omitted; rest of dashboard unaffected |
| ≥ 0.12.0 | **≥ 0.9.0** for the auto-discovered model picker (`tokopt models`) | Older CLI → falls back to a built-in 4-model list; everything else still works |
| ≥ 0.11.0 | **≥ 0.8.0** for `--credit-rates` external rate cards | Older CLI → `tokopt.creditRatesPath` ignored |
| any | **≥ 0.7.0** baseline (`audit` / `count` / `detect` / `slim`) | — |

The extension **degrades gracefully** against an older binary — a mismatch
loses one feature, never the whole tool. Configure the binary with
`tokopt.binaryPath`.

See also [VERSIONING.md](VERSIONING.md).
