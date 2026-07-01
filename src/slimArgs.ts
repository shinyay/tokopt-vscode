/**
 * Pure `slim` argument helpers, kept free of any `vscode` import so they are
 * unit-testable under `node --test` (the test bundle marks `vscode`
 * external). Consumed by slim.ts. See issue #45.
 */

/**
 * Build the `slim` argument vector. `--enable-jp-idiom` is passed by default
 * so Japanese files actually compress (the JpIdiom stage contracts
 * `〜することができます` → `〜できます`); it is a **no-op on non-Japanese
 * input**, so passing it unconditionally is safe. Set `jpIdiom: false` for
 * the backward-compat retry against a tokopt too old to know the flag.
 */
export function buildSlimArgs(file: string, opts: { jpIdiom: boolean }): string[] {
  const args = ["slim", "--input", file];
  if (opts.jpIdiom) {
    args.push("--enable-jp-idiom");
  }
  return args;
}

/**
 * True when an error looks like cobra's "unknown flag" for a tokopt build
 * that predates `--enable-jp-idiom`. Used to decide whether to retry slim
 * without the Japanese flag.
 */
export function isUnknownFlagError(message: string): boolean {
  return /unknown flag/i.test(message);
}
