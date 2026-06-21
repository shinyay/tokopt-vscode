# Versioning policy

`tokopt-vscode` follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
This document defines the extension's **public API**, how versions are chosen,
and the road to `1.0.0`. Compatibility with the `tokopt` CLI is tracked in the
**canonical** [tokopt/COMPATIBILITY.md](https://github.com/shinyay/tokopt/blob/main/COMPATIBILITY.md)
(this repo keeps only a short [COMPATIBILITY.md](COMPATIBILITY.md) pointer).

## What is the public API?

A **breaking change** is any backward-incompatible change to:

- **Setting keys** under `tokopt.*` (`tokopt.binaryPath`, `tokopt.creditModel`,
  `tokopt.creditRatesPath`, `tokopt.requestsPerDay`, the `codeLens` /
  `diagnostics` / `statusBar` / `treeView` / `usage` groups). Users' `settings.json`
  depends on these.
- **Command IDs** under `tokopt.*` (`tokopt.showDashboard`,
  `tokopt.showUsageAnalysis`, `tokopt.showOptimizationReport`, …) and contributed
  menus / keybindings.
- The **minimum tokopt CLI version** required for the extension to function at
  all (as opposed to losing one optional feature — see graceful degradation).

Adding a new setting, command, view, or webview panel is **additive**
(non-breaking). Changing a setting's default in a way that alters behaviour is a
judgement call — prefer additive opt-in.

## Choosing the version bump

### While in `0.x` (today)

| Change | Bump |
|---|---|
| New feature, additive (new setting/command/view) | **MINOR** (`0.12 → 0.13`) |
| Breaking change (rename a setting/command) | **MINOR** (`0.12 → 0.13`) |
| Bug fix, docs, internal refactor | **PATCH** (`0.12.0 → 0.12.1`) |

### After `1.0.0`

Standard SemVer: **MAJOR** = breaking, **MINOR** = additive, **PATCH** = fixes.

## Graceful degradation against the CLI

The extension is written to **degrade gracefully** against an older `tokopt`
binary instead of erroring. For example, the model picker discovers models via
`tokopt models` (CLI ≥ 0.9.0) and **falls back to a built-in 4-model list**
against older binaries. A CLI mismatch therefore loses a feature, never the
whole extension. New CLI-dependent features must follow this pattern and be
recorded in [tokopt/COMPATIBILITY.md](https://github.com/shinyay/tokopt/blob/main/COMPATIBILITY.md).

## Road to `1.0.0`

`1.0.0` is a **commitment to stability**, not a feature-count milestone. The
natural trigger for this extension is **publishing to the VS Code Marketplace**
(today it ships as a `.vsix` on GitHub Releases) — that is the moment "other
people start depending on it." Checklist:

- [ ] Published to the VS Code Marketplace (or an explicit decision to support
      outside users).
- [ ] Setting keys and command IDs are ones we are willing to freeze.
- [ ] The CLI contract it relies on (`format_version=v1`) is frozen.
- [ ] Docs + the [fixture verification](https://github.com/shinyay/tokopt-vscode-fixture)
      pass.

Until then we stay in `0.x` and keep breaking changes cheap.

## Coordination

The extension versions **independently** from the CLI and skills — we do not
force a shared number. Coordination is via the canonical
[compatibility matrix](https://github.com/shinyay/tokopt/blob/main/COMPATIBILITY.md)
and periodic **release trains**.
