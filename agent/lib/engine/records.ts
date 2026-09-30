import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Append-only resolution + insight records — the "product intelligence" half
 * of the product. Rows are one JSON object per line so the P1 dashboard and
 * P2 evals read the same format from day one.
 *
 * The local demo uses one Node process and a durable JSONL ledger. Writes
 * finish synchronously before success is reported. Serverless deployments
 * must supply persistent storage; an ephemeral filesystem is not supported.
 */

export type RecordKind = "return" | "exchange" | "escalation" | "insight" | "quality_case" | "preference" | "outcome";

export interface AppRecord {
  recordId: string;
  kind: RecordKind;
  sessionId?: string;
  createdAt: string;
  [key: string]: unknown;
}

const recordsPath = process.env.RIV_RECORDS_FILE ?? fileURLToPath(
  new URL("../../../data/records.jsonl", import.meta.url),
);

function readRecords(): AppRecord[] {
  if (!existsSync(recordsPath)) return [];
  return readFileSync(recordsPath, "utf8").split("\n").filter(Boolean).map((line, index) => {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || !("recordId" in value)
      || !("kind" in value) || !("createdAt" in value)
      || typeof value.recordId !== "string" || typeof value.createdAt !== "string"
      || !["return", "exchange", "escalation", "insight", "quality_case", "preference", "outcome"].includes(String(value.kind))) {
      throw new Error(`Invalid ledger record on line ${index + 1}; refusing to lose existing resolutions.`);
    }
    // Validate the persisted boundary before treating the row as a record.
    return { ...value, recordId: value.recordId, createdAt: value.createdAt, kind: parseKind(value.kind) };
  });
}

function parseKind(value: unknown): RecordKind {
  if (value === "return" || value === "exchange" || value === "escalation"
    || value === "insight" || value === "quality_case" || value === "preference" || value === "outcome") return value;
  throw new Error("Unknown ledger record kind.");
}

const memory: AppRecord[] = process.env.RIV_STORAGE === "supabase" ? [] : readRecords();
const transaction = new AsyncLocalStorage<{ records: AppRecord[]; pending: AppRecord[] }>();
function currentRecords(): AppRecord[] { return transaction.getStore()?.records ?? memory; }

export async function withRecordTransaction<T>(records: AppRecord[], work: () => T | Promise<T>): Promise<{ value: T; pending: AppRecord[] }> {
  const state = { records: [...records], pending: [] as AppRecord[] };
  return transaction.run(state, async () => ({ value: await work(), pending: state.pending }));
}

export function parseStoredRecord(value: unknown): AppRecord {
  if (typeof value !== "object" || value === null || !("recordId" in value) || !("kind" in value)
    || !("createdAt" in value) || typeof value.recordId !== "string" || typeof value.createdAt !== "string") {
    throw new Error("Invalid stored application record.");
  }
  return { ...value, recordId: value.recordId, kind: parseKind(value.kind), createdAt: value.createdAt };
}

export function appendRecord(
  kind: RecordKind,
  payload: Record<string, unknown>,
  sessionId?: string,
): AppRecord {
  const record: AppRecord = {
    ...payload,
    recordId: `${kind.slice(0, 3).toUpperCase()}-${randomUUID()}`,
    kind,
    sessionId,
    createdAt: new Date().toISOString(),
  };
  const staged = transaction.getStore();
  if (staged) { staged.records.push(record); staged.pending.push(record); }
  else {
    if (process.env.RIV_STORAGE === "supabase") throw new Error("Durable request transaction is required. Refusing an unpersisted write.");
    mkdirSync(dirname(recordsPath), { recursive: true });
    appendFileSync(recordsPath, JSON.stringify(record) + "\n", "utf8");
    memory.push(record);
  }
  return record;
}

/** One active resolution per order line item, including across process restarts. */
export function findResolution(orderId: string, itemId: string, scopeId = "global"): AppRecord | undefined {
  return currentRecords().find((record) =>
    (record.kind === "return" || record.kind === "exchange")
    && record.orderId === orderId && record.itemId === itemId && (record.scopeId ?? "global") === scopeId,
  );
}

export function appendResolution(
  kind: "return" | "exchange",
  payload: Record<string, unknown> & { orderId: string; itemId: string; scopeId?: string },
  sessionId?: string,
): { created: boolean; record: AppRecord } {
  const existing = findResolution(payload.orderId, payload.itemId, payload.scopeId);
  if (existing) return { created: false, record: existing };
  return { created: true, record: appendRecord(kind, payload, sessionId) };
}

export function listRecords(kind?: RecordKind): AppRecord[] {
  return kind === undefined ? [...currentRecords()] : currentRecords().filter((r) => r.kind === kind);
}
