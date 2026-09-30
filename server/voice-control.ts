import { z } from "zod";
import { getSessionSnapshot, type SessionSnapshot } from "../agent/lib/demo/service.ts";
import type { AppRecord } from "../agent/lib/engine/records.ts";
import { requestOwner } from "./access.ts";
import { persisted, rpc, usesSupabase } from "./storage/supabase.ts";

const controlSchema = z.object({ cancelled: z.boolean(), revision: z.number().int() });

/** Each socket owns one observer. It never relies on the HTTP instance's memory. */
export function createVoiceObserver(input: {
  sessionId: string;
  ticketHash: string;
  onStop: () => void;
  onSnapshot: (snapshot: SessionSnapshot) => void;
  onResolution: (resolution: AppRecord) => void;
}) {
  const announced = new Set<string>();
  let initialized = false;
  let revision: number | null = null;
  let polling = false;
  return {
    async poll(): Promise<boolean> {
      if (polling) return true;
      polling = true;
      try {
        const control = usesSupabase()
          ? controlSchema.parse(await rpc("riv_voice_control", {
              p_session_id: input.sessionId, p_owner_id: requestOwner(), p_ticket_hash: input.ticketHash, p_cancel: false,
            }))
          : { cancelled: false, revision: null };
        if (control.cancelled) { input.onStop(); return false; }
        if (initialized && control.revision !== null && revision === control.revision) return true;
        const snapshot = await persisted(input.sessionId, () => getSessionSnapshot(input.sessionId), "read");
        input.onSnapshot(snapshot);
        for (const item of snapshot.items) {
          const resolution = item.resolution;
          if (!resolution || announced.has(resolution.recordId)) continue;
          announced.add(resolution.recordId);
          // Existing outcomes are loaded at connection start, never announced
          // as if this new voice connection had just performed them.
          if (initialized) input.onResolution(resolution);
        }
        initialized = true;
        revision = control.revision;
        return true;
      } finally { polling = false; }
    },
  };
}
