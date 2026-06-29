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
 * Compute the character offset at which a suppression comment should be
 * inserted: the very top of the file, but after a YAML front-matter block
 * (`---\n ... \n---`) when one is present. This keeps the directive
 * predictable and discoverable instead of appended to the end of the file.
 * See https://github.com/shinyay/tokopt-vscode/issues/30.
 */
export function suppressionInsertOffset(content: string): number {
  // Front matter must be the very first bytes: an opening `---` line.
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/.exec(content);
  return fm ? fm[0].length : 0;
}

/**
 * Build the `{ offset, text }` insertion for a suppression comment so it
 * lands on its own line at the top of the file (after front matter). The
 * text is self-contained: it always ends with a newline, and adds a blank
 * separator before existing body content.
 */
export function buildSuppressionInsert(
  content: string,
  id: string
): { offset: number; text: string } {
  const offset = suppressionInsertOffset(content);
  const text = `<!-- tokopt:disable=${id} -->\n\n`;
  return { offset, text };
}

/**
 * Return true when the file extension supports HTML-comment suppression
 * (i.e. markdown). Path comparison is case-insensitive.
 */
export function isSuppressionSupported(fsPath: string): boolean {
  const lower = fsPath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}
