import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";

// Deliberately not exposed as a model tool, HTTP route or serialized state.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const itemSchema = z.object({
  itemRef: z.string(), name: z.string(), size: z.string(), orderedOn: date,
  deliveredOn: date.nullable(), status: z.enum(["Delivered", "Refund Completed", "Cancelled"]),
  publicUrl: z.string().url(), currentPublicMaterial: z.string().nullable(),
  returnReason: z.string().nullable(), keptOutcome: z.boolean().nullable(), likedOutcome: z.boolean().nullable(),
  variantId: z.string().nullable(), sku: z.string().nullable(), gsm: z.number().positive().nullable(),
}).strict();
export const privateHistorySchema = z.object({
  customerRef: z.string(), source: z.object({ accountSource: z.string().url(), observedAt: z.string().datetime(), method: z.literal("user-authorized account UI observation"), merchantIntegration: z.literal(false), materialScope: z.literal("current public product attribute, not verified purchase composition") }).strict(),
  items: z.array(itemSchema),
}).strict();
export type PrivateHistory = z.infer<typeof privateHistorySchema>;
const bindings = new Map<string, { customerRef: string; file: string }>();
export function assertPrivateLocalOnly(): void {
  if (process.env.VERCEL || process.env.RIV_STORAGE === "supabase" || process.env.RIV_VOICE_APPROVED === "true" || process.env.RIV_PUBLIC_VOICE_APPROVED === "true") throw new Error("Private history is restricted to offline local preparation.");
}
export function bindPrivateHistorySession(sessionId: string, customerRef: string, file: string): void {
  assertPrivateLocalOnly();
  const root = realpathSync(resolve(".private")); const target = realpathSync(resolve(file)); const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Private history must be in the ignored .private input directory.");
  bindings.set(sessionId, { customerRef, file: target });
}
export function unbindPrivateHistorySession(sessionId: string): void { bindings.delete(sessionId); }
export function lookupPrivateHistory(sessionId: string, itemRef?: string) {
  assertPrivateLocalOnly();
  const binding = bindings.get(sessionId); if (!binding) throw new Error("No private history binding for this session.");
  // Read anew on every lookup; never copy private history into fixtures/prompts/session persistence.
  const history = privateHistorySchema.parse(JSON.parse(readFileSync(binding.file, "utf8")));
  if (history.customerRef !== binding.customerRef) throw new Error("Private history customer does not match this session.");
  const items = itemRef ? history.items.filter(item => item.itemRef === itemRef) : history.items;
  if (itemRef && !items.length) throw new Error("Historical item not found.");
  return { customerRef: history.customerRef, source: history.source, items,
    transactional: false as const, currentMerchantEligibility: null,
    note: "Historical observations only. Delivered does not imply kept or liked; refunds and cancellations establish no complaint. No merchant action is available." };
}
