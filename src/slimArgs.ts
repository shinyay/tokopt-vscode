/**
 * Pure `slim` argument helpers, kept free of any `vscode` import so they are
 * unit-testable under `node --test` (the test bundle marks `vscode`
 * external). Consumed by slim.ts. See issues #45 and #47.
 */

/**
 * Build the `slim` argument vector with an explicit list of extra flags
 * (e.g. `["--enable-jp-idiom"]`). Flags are appended verbatim after
 * `slim --input <file>`; pass `[]` for a plain run.
 */
export function buildSlimArgs(file: string, flags: string[]): string[] {
  return ["slim", "--input", file, ...flags];
}

/**
 * True when an error looks like cobra's "unknown flag" for a tokopt build
 * that predates a flag we tried to pass. Used to decide whether to retry
 * slim without the extra flag.
 */
export function isUnknownFlagError(message: string): boolean {
  return /unknown flag/i.test(message);
}

/**
 * Extract the flags the CLI recommends from a parsed `slim --format json`
 * result (#47 / gs#175 item 4). Only `--enable-*` flags are honoured:
 * `--profile` recommendations are intentionally ignored because a profile
 * changes the apply/preview contract and must be chosen deliberately, not
 * auto-applied. Returns [] when the field is absent (older CLI) or malformed.
 */
export function parseRecommendedFlags(json: unknown): string[] {
  if (typeof json !== "object" || json === null) {
    return [];
  }
  const recs = (json as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(recs)) {
    return [];
  }
  const out: string[] = [];
  for (const rec of recs) {
    if (typeof rec !== "object" || rec === null) {
      continue;
    }
    const flag = (rec as { flag?: unknown }).flag;
    if (typeof flag === "string" && flag.startsWith("--enable-")) {
      out.push(flag);
    }
  }
  return out;
}

/**
 * Resolve which flags the actual slim run should pass, given the flags parsed
 * from a JSON probe. When the probe yielded flags, use them. When it yielded
 * none — because the CLI is too old to emit `recommendations`, or the file
 * simply needs nothing — fall back to `--enable-jp-idiom` (the #45 behaviour:
 * a no-op on non-Japanese input, so it is always safe). Set
 * `probeSucceeded: false` when the probe itself failed, to force the fallback.
 */
export function resolveSlimFlags(
  probeFlags: string[],
  opts: { probeSucceeded: boolean }
): string[] {
  if (opts.probeSucceeded && probeFlags.length > 0) {
    return probeFlags;
  }
  return ["--enable-jp-idiom"];
}
