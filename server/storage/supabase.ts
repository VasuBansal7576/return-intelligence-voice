import { z } from "zod";
import { assertHostingConfiguration, requestOwner } from "../access.ts";
import { DomainError } from "../../agent/lib/demo/service.ts";
import { domainSessionIds as currentSessionIds, hydrateDomainSession as hydrateSession, serializeDomainSession as serializeSession, withDomainContext as withSessionContext } from "../session-domain.ts";
import { parseStoredRecord, withRecordTransaction } from "../../agent/lib/engine/records.ts";

const sessionRowSchema = z.object({ id: z.string().uuid(), revision: z.number().int(), state: z.unknown() });
const recordRowSchema = z.object({ payload: z.unknown() });
function databaseConfig() {
  const rawUrl = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) throw new DomainError("database_unconfigured", "Durable storage is unavailable. No action was committed.", 503);
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) throw new DomainError("invalid_database_destination", "Supabase must use its approved HTTPS project URL.", 503);
  return { base: url.origin, key };
}
export function usesSupabase(): boolean { return process.env.RIV_STORAGE === "supabase"; }
async function databaseRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const config = databaseConfig();
  const headers: Record<string, string> = { apikey: config.key, "content-type": "application/json" };
  // New sb_secret keys authenticate via apikey. Legacy JWT service keys also
  // need their JWT bearer value; neither is exposed to a browser or a log.
  if (config.key.startsWith("eyJ")) headers.Authorization = `Bearer ${config.key}`;
  const response = await fetch(`${config.base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) {
    if (response.status === 409) throw new DomainError("concurrent_update", "This session changed in another request. Reload its current state before acting.", 409);
    if (response.status === 429) throw new DomainError("voice_budget_exhausted", "The approved voice allowance is exhausted or currently reserved.", 429);
    throw new DomainError("database_unavailable", `Durable storage rejected the operation (${response.status}). No success is assumed.`, 503);
  }
  return response.status === 204 ? null : response.json();
}
export async function rpc(name: "riv_load_state" | "riv_voice_status" | "riv_commit_session" | "riv_reserve_voice" | "riv_consume_voice_ticket" | "riv_release_voice" | "riv_voice_control", input: Record<string, unknown>): Promise<unknown> {
  return databaseRequest(`rpc/${name}`, { method: "POST", body: JSON.stringify(input) });
}

/** Load -> isolated domain transaction -> one atomic Postgres commit.
 * An optimistic revision prevents two tabs/instances approving stale state.
 */
export async function persisted<T>(id: string | null, work: () => T | Promise<T>, mode: "write" | "read" | "all" = "write", assertActive?: () => void): Promise<T> {
  assertHostingConfiguration();
  if (!usesSupabase()) { assertActive?.(); return work(); }
  const owner = requestOwner();
  const loaded = z.object({ sessions: z.array(sessionRowSchema), records: z.array(recordRowSchema) }).parse(
    await rpc("riv_load_state", { p_owner_id: owner, p_session_id: id, p_all: mode === "all" }));
  const sessionData = loaded.sessions; const recordData = loaded.records;
  const rows = z.array(sessionRowSchema).parse(sessionData);
  if (id && rows.length !== 1) throw new DomainError("session_not_found", "This session is unavailable.", 404);
  const records = z.array(recordRowSchema).parse(recordData).map((row) => parseStoredRecord(row.payload));
  return withSessionContext(async () => {
    for (const row of rows) hydrateSession(row.state);
    assertActive?.();
    const staged = await withRecordTransaction(records, work);
    if (mode !== "write") {
      if (staged.pending.length) throw new DomainError("unexpected_write", "Read request attempted a state change.", 500);
      return staged.value;
    }
    const ids = currentSessionIds();
    const targetId = id ?? ids[0];
    if (!targetId || ids.length !== 1) throw new DomainError("invalid_transaction", "Exactly one session must be committed.", 500);
    const expectedRevision = rows[0]?.revision ?? -1;
    assertActive?.();
    await rpc("riv_commit_session", { p_id: targetId, p_owner_id: owner, p_expected_revision: expectedRevision, p_state: serializeSession(targetId), p_records: staged.pending });
    return staged.value;
  });
}
export async function readVoiceBudget(): Promise<{ max_seconds: number; reserved_seconds: number; active_until: string | null }> {
  const data = await rpc("riv_voice_status", {});
  const rows = z.array(z.object({ max_seconds: z.number(), reserved_seconds: z.number(), active_until: z.string().nullable() })).parse(data);
  if (rows.length !== 1) throw new DomainError("voice_budget_missing", "The durable voice allowance has not been configured.", 503);
  return rows[0];
}
