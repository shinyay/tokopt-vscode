import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Usage-log loading for the Usage Analysis view.
 *
 * Data sources:
 *   - Copilot CLI session logs: ~/.copilot/session-state/<uuid>/events.jsonl
 *     (the `session.shutdown` event carries per-model token + nano-AIU
 *     totals). This is the ONLY place per-request usage is persisted —
 *     VS Code Copilot Chat does not write usage telemetry to disk.
 *   - Bring-your-own: any JSONL or CSV with a numeric token column.
 *
 * PRIVACY: extraction reads ONLY token counts, nano-AIU, model names,
 * request counts and the session id/timestamp. It never reads
 * `user_message` / `assistant_response` or any conversation content.
 */

export interface UsageRow {
  /** Input tokens consumed across all models in the session. */
  tokens: number;
  /** Projected cost in nano-AIU (sum of modelMetrics.totalNanoAiu). */
  nanoAiu?: number;
  /** Number of model requests in the session. */
  requests?: number;
  /** Primary model name(s). */
  model?: string;
  /** Session id (folder name) for outlier display. */
  sessionId?: string;
  /** ISO timestamp (best-effort). */
  timestamp?: string;
}

/**
 * Parse a single `events.jsonl` line. Returns a UsageRow only for a
 * `session.shutdown` event that carries `modelMetrics`; otherwise null.
 * PURE — no fs — so it is unit-testable.
 */
export function extractUsageRow(line: string, sessionId?: string): UsageRow | null {
  if (line.indexOf("session.shutdown") === -1) return null;
  let e: unknown;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  if (!e || typeof e !== "object") return null;
  const ev = e as Record<string, unknown>;
  if (ev.type !== "session.shutdown") return null;
  const data = ev.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return null;
  const mm = data.modelMetrics as Record<string, unknown> | undefined;
  if (!mm || typeof mm !== "object") return null;

  let tokens = 0;
  let nanoAiu = 0;
  let requests = 0;
  const models: string[] = [];
  for (const [model, raw] of Object.entries(mm)) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const usage = m.usage as Record<string, unknown> | undefined;
    const input =
      usage && typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
    tokens += input;
    if (typeof m.totalNanoAiu === "number") nanoAiu += m.totalNanoAiu;
    const reqs = m.requests as Record<string, unknown> | undefined;
    if (reqs && typeof reqs.count === "number") requests += reqs.count;
    if (input > 0 || (typeof m.totalNanoAiu === "number" && m.totalNanoAiu > 0)) {
      models.push(model);
    }
  }
  if (tokens <= 0 && nanoAiu <= 0) return null;

  const ts =
    typeof ev.timestamp === "string"
      ? ev.timestamp
      : typeof ev.time === "string"
        ? ev.time
        : undefined;

  return {
    tokens,
    nanoAiu: nanoAiu > 0 ? nanoAiu : undefined,
    requests: requests > 0 ? requests : undefined,
    model: models.length ? models.join(", ") : undefined,
    sessionId,
    timestamp: ts,
  };
}

/** Default Copilot CLI session-state directory. */
export function copilotCliStateDir(): string {
  return path.join(os.homedir(), ".copilot", "session-state");
}

/**
 * Discover Copilot CLI `events.jsonl` files, newest first (by mtime),
 * capped at `max`. Returns [] if the directory is absent.
 */
export function discoverCopilotCliLogs(max = 500): string[] {
  const dir = copilotCliStateDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const logs: Array<{ file: string; mtime: number }> = [];
  for (const name of entries) {
    const file = path.join(dir, name, "events.jsonl");
    try {
      const st = fs.statSync(file);
      if (st.isFile()) logs.push({ file, mtime: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  logs.sort((a, b) => b.mtime - a.mtime);
  return logs.slice(0, Math.max(0, max)).map((l) => l.file);
}

/**
 * Extract one UsageRow per Copilot CLI log (the session.shutdown event).
 * Reads files line-by-line but only parses lines containing the marker.
 */
export function loadCopilotCliRows(max = 500): UsageRow[] {
  const files = discoverCopilotCliLogs(max);
  const rows: UsageRow[] = [];
  for (const file of files) {
    const sessionId = path.basename(path.dirname(file));
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let mtimeIso: string | undefined;
    try {
      mtimeIso = fs.statSync(file).mtime.toISOString();
    } catch {
      /* ignore */
    }
    for (const line of content.split("\n")) {
      if (line.indexOf("session.shutdown") === -1) continue;
      const row = extractUsageRow(line, sessionId);
      if (row) {
        if (!row.timestamp) row.timestamp = mtimeIso;
        rows.push(row);
        break; // one shutdown per session
      }
    }
  }
  return rows;
}

/**
 * Parse a bring-your-own JSONL or CSV file into rows using `column` as
 * the token field/header. PURE-ish (fs read only). Skips unparseable rows.
 */
export function loadFileRows(filePath: string, column = "tokens"): UsageRow[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseCsvRows(content, column);
  }
  return parseJsonlRows(content, column);
}

export function parseJsonlRows(content: string, column: string): UsageRow[] {
  const rows: UsageRow[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const v = o[column];
      const tokens = typeof v === "number" ? v : Number(v);
      if (!isFinite(tokens)) continue;
      rows.push({
        tokens,
        nanoAiu: typeof o.nano_aiu === "number" ? o.nano_aiu : undefined,
        model: typeof o.model === "string" ? o.model : undefined,
        sessionId:
          typeof o.session === "string"
            ? o.session
            : typeof o.session_id === "string"
              ? o.session_id
              : undefined,
      });
    } catch {
      /* skip */
    }
  }
  return rows;
}

export function parseCsvRows(content: string, column: string): UsageRow[] {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const col = header.indexOf(column);
  if (col === -1) return [];
  const rows: UsageRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const tokens = Number(cells[col]);
    if (!isFinite(tokens)) continue;
    rows.push({ tokens });
  }
  return rows;
}
