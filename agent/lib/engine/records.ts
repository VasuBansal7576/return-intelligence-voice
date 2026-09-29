import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Append-only resolution + insight records — the "product intelligence" half
 * of the product. Rows are one JSON object per line so the P1 dashboard and
 * P2 evals read the same format from day one.
 *
 * Writes are best-effort to the repo's data/ directory: on serverless the
 * filesystem is ephemeral, so failures are swallowed and the in-memory list
 * still serves the session.
 */

export type RecordKind = "return" | "exchange" | "escalation" | "insight" | "quality_case";

export interface AppRecord {
  recordId: string;
  kind: RecordKind;
  sessionId?: string;
  createdAt: string;
  [key: string]: unknown;
}

const recordsPath = fileURLToPath(
  new URL("../../../data/records.jsonl", import.meta.url),
);

const memory: AppRecord[] = [];
let counter = 0;

export function appendRecord(
  kind: RecordKind,
  payload: Record<string, unknown>,
  sessionId?: string,
): AppRecord {
  counter += 1;
  const record: AppRecord = {
    recordId: `${kind.slice(0, 3).toUpperCase()}-${Date.now().toString(36)}-${counter}`,
    kind,
    sessionId,
    createdAt: new Date().toISOString(),
    ...payload,
  };
  memory.push(record);
  try {
    mkdirSync(dirname(recordsPath), { recursive: true });
    appendFileSync(recordsPath, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Read-only/ephemeral filesystem (e.g. serverless): keep the in-memory copy.
  }
  return record;
}

export function listRecords(kind?: RecordKind): AppRecord[] {
  return kind === undefined ? [...memory] : memory.filter((r) => r.kind === kind);
}
