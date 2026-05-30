/**
 * Per-file suppression syntax for tokopt findings.
 *
 * Syntax: `<!-- tokopt:disable=<rule-id> -->` — an HTML comment that
 * survives any markdown renderer. One rule per comment; multiple comments
 * may appear in the same file.
 *
 * Only valid in markdown-based customization files. JSON / YAML config
 * files do not support an equivalent syntax; for those, the Quick Fix
 * provider omits the "Suppress" action.
 */
const SUPPRESS_RE = /<!--\s*tokopt:disable=([a-z0-9-]+)\s*-->/gi;

/** Extract all suppressed rule ids from a file's text content. */
export function parseSuppressions(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(SUPPRESS_RE)) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

/**
 * Produce the suppression comment to append for a given rule id. Includes
 * a leading newline so it sits cleanly on its own line even when the
 * source file does not end in a newline.
 */
export function formatSuppressionComment(id: string): string {
  return `\n<!-- tokopt:disable=${id} -->\n`;
}

/**
 * Return true when the file extension supports HTML-comment suppression
 * (i.e. markdown). Path comparison is case-insensitive.
 */
export function isSuppressionSupported(fsPath: string): boolean {
  const lower = fsPath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}
