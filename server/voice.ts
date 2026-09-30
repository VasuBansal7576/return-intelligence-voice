import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { persisted, readVoiceBudget, rpc, usesSupabase } from "./storage/supabase.ts";
import { requestOwner, withKnownOwner } from "./access.ts";
import { createVoiceObserver } from "./voice-control.ts";
import { DomainError, executeVoiceTool, getSessionSnapshot as fixtureSnapshot, recordTranscript, structuredDiagnosisSchema } from "../agent/lib/demo/service.ts";

import { domainSnapshot as getSessionSnapshot } from "./session-domain.ts";
import { isReplaySession, replayProviderConfig, replayTranscript, executeReplayTool, replayOutcomeForProvider } from "./replay-session.ts";

const MAX_DURATION_SECONDS = 180;
const IDLE_SECONDS = 30;
const ticketMap = new Map<string, { sessionId: string; expiresAt: number }>();
const live = new Map<string, () => void>();
const budgetPath = resolve(process.env.RIV_VOICE_BUDGET_FILE ?? "data/voice-budget.json");
const budgetSchema = z.object({ version: z.literal(1), reservedSeconds: z.number().nonnegative(), reservations: z.array(z.object({ sessionId: z.string(), at: z.string(), seconds: z.number() })) });
const sessions = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });

// Hosted reservations use an atomic Postgres operation. This adapter is only
// for a single local process and must never back a hosted deployment.
export interface VoiceBudget { reserve(sessionId: string, seconds: number, cap: number): Promise<void>; reserved(): number }
const localBudget: VoiceBudget = {
  reserved() { return readBudget().reservedSeconds; },
  async reserve(sessionId, seconds, cap) {
    const budget = readBudget();
    if (budget.reservedSeconds + seconds > cap) throw new DomainError("voice_budget_exhausted", "The approved demo voice allowance is exhausted.", 429);
    budget.reservedSeconds += seconds; budget.reservations.push({ sessionId, at: new Date().toISOString(), seconds });
    mkdirSync(dirname(budgetPath), { recursive: true });
    const temporary = `${budgetPath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(budget), { mode: 0o600 }); renameSync(temporary, budgetPath);
    // No automatic refund after a network error: upstream acceptance may be unknown.
  },
};
function readBudget() {
  if (!existsSync(budgetPath)) return { version: 1 as const, reservedSeconds: 0, reservations: [] as Array<{ sessionId: string; at: string; seconds: number }> };
  return budgetSchema.parse(JSON.parse(readFileSync(budgetPath, "utf8")));
}
export async function voiceCapabilities() {
  const configured = process.env.RIV_VOICE_APPROVED === "true" && process.env.RIV_FREE_CREDIT_BALANCE_VERIFIED === "true"
    && !!process.env.ASSEMBLYAI_API_KEY && Number(process.env.RIV_MAX_RESERVED_VOICE_SECONDS) >= MAX_DURATION_SECONDS;
  const cap = Number(process.env.RIV_MAX_RESERVED_VOICE_SECONDS ?? 0);
  let status: "unconfigured" | "ready" | "limit_reached" = configured ? "ready" : "unconfigured";
  let reason = configured ? "Managed AssemblyAI voice, fixed server-side configuration and a durable approved allowance" : "Live voice is disabled until free-credit balance, billing controls and credentials are explicitly approved.";
  if (configured) {
    try { const durable = usesSupabase() ? await readVoiceBudget() : { reserved_seconds: localBudget.reserved(), max_seconds: cap, active_until: null };
      if (durable.reserved_seconds + MAX_DURATION_SECONDS > Math.min(cap,durable.max_seconds)) { status = "limit_reached"; reason = "The approved demo voice allowance is exhausted."; } }
    catch { status = "unconfigured"; reason = "The durable voice allowance could not be verified. Voice is disabled."; }
  }
  return { status, reason, provider: "AssemblyAI", maxDurationSeconds: MAX_DURATION_SECONDS, idleTimeoutSeconds: IDLE_SECONDS, proxyManagedTools: true };
}
function assertAccess(request: IncomingMessage): void {
  const host = request.headers.host ?? "";
  const peer = request.socket.remoteAddress;
  const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  const hosted = !!process.env.VERCEL || process.env.RIV_DEPLOYMENT === "production";
  const localHost = !hosted && loopback && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const approvedOrigin = process.env.RIV_PUBLIC_VOICE_ORIGIN;
  const approvedPublic = usesSupabase() && approvedOrigin && new URL(approvedOrigin).protocol === "https:" && new URL(approvedOrigin).host === host && request.headers.origin === new URL(approvedOrigin).origin && process.env.RIV_PUBLIC_VOICE_APPROVED === "true";
  if (!localHost && !approvedPublic) throw new DomainError("voice_public_access_disabled", "Public voice access requires a separately approved authenticated deployment.", 403);
  const origin = request.headers.origin;
  if (origin && new URL(origin).host !== host) throw new DomainError("cross_origin_denied", "Voice requests must originate from this application.", 403);
}
export async function createVoiceTicket(request: IncomingMessage, sessionId: string) {
  assertAccess(request); await persisted(sessionId, () => getSessionSnapshot(sessionId), "read");
  const capability = await voiceCapabilities();
  if (capability.status !== "ready") throw new DomainError("voice_unavailable", capability.reason, 403);
  if (!usesSupabase() && (live.size || ticketMap.size)) throw new DomainError("voice_busy", "Only one live demo voice session is allowed at a time.", 409);
  const ticket = randomBytes(24).toString("hex");
  const digest = createHash("sha256").update(ticket).digest("hex");
  if (usesSupabase()) {
    await rpc("riv_reserve_voice", { p_session_id: sessionId, p_owner_id: requestOwner(), p_ticket_hash: digest, p_seconds: MAX_DURATION_SECONDS, p_cap_seconds: Number(process.env.RIV_MAX_RESERVED_VOICE_SECONDS) });
  } else {
    await localBudget.reserve(sessionId, MAX_DURATION_SECONDS, Number(process.env.RIV_MAX_RESERVED_VOICE_SECONDS));
    ticketMap.set(digest, { sessionId, expiresAt: Date.now() + 60_000 });
    setTimeout(() => ticketMap.delete(digest), 60_000).unref();
  }
  return { websocketUrl: `/api/voice/ws?sessionId=${encodeURIComponent(sessionId)}&ticket=${ticket}`, maxDurationSeconds: MAX_DURATION_SECONDS, idleTimeoutSeconds: IDLE_SECONDS, proxyManagedTools: true };
}

const objectSchema = { type: "object", properties: {}, additionalProperties: false };
function toolDef(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) {
  return { type: "function", name, description, execution_mode: "interactive", timeout_seconds: 15,
    parameters: { ...objectSchema, properties, required } };
}
export function managedSessionConfig(sessionId: string) {
  if(isReplaySession(sessionId))return replayProviderConfig(sessionId);
  const session = fixtureSnapshot(sessionId);
  return { system_prompt: `You are an AI returns assistant in an independent synthetic prototype inspired by The Souled Store. There is no affiliation and no real refund/payment/shipment. Your customer has selected a synthetic account and order on screen. Your job is to understand what failed and find a legitimate resolution, sometimes a clean refund. Speak briefly, one question at a time. Allow interruption and respond to new information. For discount or coupon requests use get_discount_policy. No discretionary discount is authorized, and a discount request alone is not a reason to escalate. Use tools before any policy, product, price, stock, preference or status claim. Never invent a fact or call an unknown attribute safe. Keep current product positives and diagnose multiple reasons. A positive fit/material/design statement cannot be evidence for a problem reason. Do not add an unsupported secondary reason or unnecessary clarification. Search may be gated by clarification or policy: inspect searchStatus and emptyResultExplanation, never interpret a gated empty result as out of stock. Explicit new preferences override tentative history. Do not recommend after a refund-only request, anger, defect, fulfillment failure, or a skin reaction. For skin complaints give no diagnosis or material-safety assurance; discuss other materials only if asked. Fraud requests must not change recorded facts. Use get_customer and get_order first. Use diagnose_return with the customer's words, then check_return_eligibility and search_products. Never simply size up when only shoulders are tight and length is liked. If measurements are unavailable, say so. Only list grounded in-stock candidates, at most two. Tools read the authoritative canonical demo policy; do not use web policy from memory. request_resolution prepares exact on-screen terms and NEVER executes an action. Explain that the customer must press the confirmation button, including condition acknowledgement when required. Do not claim success until application evidence confirms execution. If the customer changes their mind, prepare the new proposal. Avoid sales pressure. Selected customer: ${session.customer.name}; order: ${session.order.orderId}; selected item: ${session.item.itemId}. All customers and orders are synthetic.`,
    greeting: `Hi ${session.customer.name.split(" ")[0]}. I'm an AI returns assistant for this demo. What did not work with your ${session.sourceProduct.name}?`,
    input: { format: { encoding: "audio/pcm" }, keyterms: ["The Souled Store", "oversized", "GSM", ...session.order.items.map((i) => i.productId)], language_codes: ["en"], transcription_mode: "balanced", turn_detection: { interrupt_response: true, interruption_delay: 100 } },
    output: { voice: "alba", format: { encoding: "audio/pcm" } },
    // No llm field. The managed native model is pinned by this server and no
    // client session.update is forwarded to the provider.
    tools: [
      toolDef("get_discount_policy", "Return the canonical no-discretionary-discount decision; do not escalate solely for a discount request."),
      toolDef("get_customer", "Load the selected synthetic customer, history and explicit versus inferred preferences."),
      toolDef("get_order", "Load exact order items before discussing them."),
      toolDef("get_product", "Check catalog facts. Missing attributes remain unknown.", { productId: { type: "string" } }, ["productId"]),
      toolDef("check_return_eligibility", "Apply the pinned canonical policy to the selected item."),
      { type: "function", name: "diagnose_return", description: "Extract nuanced multi-label diagnosis and explicit commerce preferences from exact customer transcript spans. Preserve liked attributes, choose the primary blocker only when supported, and ask one clarifying question when uncertain. Cite exact verbatim customer spans for every preference and reason. Never fabricate symptoms or damage.", execution_mode: "interactive", timeout_seconds: 15, parameters: z.toJSONSchema(structuredDiagnosisSchema) },
      toolDef("search_products", "Get already-filtered recommendations and exclusions. Never suggest an item outside these results."),
      toolDef("compare_products", "Compare catalog attributes without inventing measurements.", { productIds: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } }, ["productIds"]),
      toolDef("check_inventory", "Check the exact demo variant before promising an exchange.", { productId: { type: "string" }, size: { type: "string" }, color: { type: "string" } }, ["productId", "size", "color"]),
      toolDef("request_resolution", "Prepare an exact refund, exchange, replacement or support proposal for on-screen human confirmation. It does NOT execute anything.", { action: { type: "string", enum: ["exchange", "refund", "replacement", "escalate"] }, productId: { type: "string" }, size: { type: "string" }, color: { type: "string" } }, ["action"]),
      toolDef("select_item", "Switch to another item on this order, preserving each item's state.", { itemId: { type: "string" } }, ["itemId"]),
    ] };
}

const eventSchema = z.object({ type: z.string() }).passthrough();
const toolCallSchema = z.object({ type: z.literal("tool.call"), call_id: z.string(), name: z.string(), arguments: z.unknown() });
const transcriptSchema = z.object({ type: z.enum(["transcript.user", "transcript.agent"]), text: z.string(), item_id: z.string().optional(), interrupted: z.boolean().optional() });
export async function upgradeVoice(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  try {
    assertAccess(request);
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const ticket = url.searchParams.get("ticket") ?? "";
    const digest = createHash("sha256").update(ticket).digest("hex");
    let sessionId: string;
    if (usesSupabase()) {
      const consumed = z.object({ session_id: z.string().uuid() }).parse(await rpc("riv_consume_voice_ticket", { p_ticket_hash: digest, p_session_id: url.searchParams.get("sessionId"), p_owner_id: requestOwner() }));
      sessionId = consumed.session_id;
    } else {
      const granted = ticketMap.get(digest); ticketMap.delete(digest);
      if (!granted || granted.expiresAt < Date.now() || granted.sessionId !== url.searchParams.get("sessionId")) throw new DomainError("invalid_ticket", "Voice ticket is invalid or expired.", 403);
      sessionId = granted.sessionId;
    }
    if ((await voiceCapabilities()).status === "unconfigured") throw new DomainError("voice_disabled", "Voice has been disabled.", 403);
    const owner = requestOwner();
    sessions.handleUpgrade(request, socket, head, (client) => { void withKnownOwner(owner, () => connectProvider(client, sessionId, digest, owner)); });
  } catch { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); }
}
async function connectProvider(client: WebSocket, sessionId: string, ticketHash: string, owner: string): Promise<void> {
  let upstream: WebSocket | null = null; let finished = false; let replyDone = false; let interrupted = false; let generation = 0;
  let observerTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, { name: string; result: unknown; isError: boolean }>();
  const sendClient = (value: unknown) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
  const sendUpstream = (value: unknown) => { if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(value)); };
  const release = () => { if (usesSupabase()) void rpc("riv_release_voice", { p_ticket_hash: ticketHash }).catch(() => {}); };
  const finish = () => { if (finished) return; finished = true; clearTimeout(duration); clearTimeout(idle); clearTimeout(observerTimer); live.delete(sessionId); sendUpstream({ type: "session.end" }); setTimeout(() => { upstream?.close(); client.close(); }, 1000).unref(); };
  const duration = setTimeout(finish, MAX_DURATION_SECONDS * 1000); let idle = setTimeout(finish, IDLE_SECONDS * 1000);
  live.set(sessionId, finish);
  const observer = createVoiceObserver({ sessionId, ticketHash, onStop: finish,
    onSnapshot: (snapshot) => { if (!finished) sendClient({ type: "app.snapshot", snapshot }); },
    onResolution: (resolution) => {
      if (finished) return;
      // This value was freshly read from the committed owner-scoped state.
      // An HTTP confirmation on another Vercel instance cannot be missed.
      sendUpstream({ type: "conversation.message", role: "system", content: `The application confirms this app-owned simulated outcome was recorded (a replay_selection is interest only; never a merchant transaction): ${JSON.stringify(resolution.kind === "outcome" && resolution.eventKind === "replay_selection" ? replayOutcomeForProvider(resolution) : resolution)}. Briefly acknowledge only these verified details and note no real merchant transaction occurred.` });
      sendUpstream({ type: "reply.create" });
    },
  });
  const observe = async () => {
    try { await withKnownOwner(owner, () => observer.poll()); }
    catch { sendClient({ type: "session.error", code: "voice_control_unavailable", message: "The durable voice state could not be verified. The connection is ending safely." }); finish(); }
    if (!finished) observerTimer = setTimeout(() => { void observe(); }, 2000);
  };
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(finish, IDLE_SECONDS * 1000); };
  const drain = () => {
    if (!replyDone || interrupted) return;
    for (const [callId, entry] of pending) {
      sendUpstream({ type: "tool.result", call_id: callId, result: JSON.stringify(entry.result), is_error: entry.isError }); pending.delete(callId);
    }
  };
  client.on("close", finish); client.on("error", finish);
  client.on("message", (data) => {
    if (finished) return;
    try {
      const frame = eventSchema.parse(JSON.parse(data.toString()));
      if (frame.type === "session.end") { finish(); return; }
      if (frame.type === "input.audio") {
        const audio = z.object({ type: z.literal("input.audio"), audio: z.string().max(100_000).regex(/^[A-Za-z0-9+/=]+$/) }).parse(frame); sendUpstream(audio); return;
      }
      if (frame.type === "conversation.message") {
        const text = z.object({ type: z.literal("conversation.message"), role: z.literal("user"), content: z.string().min(1).max(4000) }).parse(frame); resetIdle(); sendUpstream(text); return;
      }
      if (frame.type === "reply.create" && Object.keys(frame).length === 1) { sendUpstream({ type: "reply.create" }); return; }
      sendClient({ type: "session.error", code: "client_configuration_forbidden", message: "The server owns model configuration, tool results and approval gates." }); finish();
    } catch { sendClient({ type: "session.error", code: "invalid_client_message", message: "Invalid voice client message." }); finish(); }
  });
  try {
    // Reject a cancelled ticket before creating any provider token. This also
    // seeds prior committed outcomes so reconnects do not announce them again.
    if (!await withKnownOwner(owner, () => observer.poll()) || finished) return;
    // This is the only provider HTTP operation, reachable only after approved
    // configuration, access verification and a durable budget reservation.
    const tokenUrl = new URL("https://agents.assemblyai.com/v1/token"); tokenUrl.searchParams.set("expires_in_seconds", "60"); tokenUrl.searchParams.set("max_session_duration_seconds", String(MAX_DURATION_SECONDS));
    const response = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Voice provider rejected initialization (${response.status}).`);
    const { token } = z.object({ token: z.string().min(1) }).parse(await response.json());
    if (finished) return;
    const url = new URL("wss://agents.assemblyai.com/v1/ws"); url.searchParams.set("token", token);
    upstream = new WebSocket(url);
    upstream.on("open", () => { void withKnownOwner(owner, () => persisted(sessionId, () => managedSessionConfig(sessionId), "read")).then((config) => {
      if (finished) return;
      sendUpstream({ type: "session.update", session: config });
      observerTimer = setTimeout(() => { void observe(); }, 2000);
    }).catch(finish); });
    let processing: Promise<void> = Promise.resolve();
    upstream.on("message", (data) => {
      let frame: z.infer<typeof eventSchema>;
      try { frame = eventSchema.parse(JSON.parse(data.toString())); } catch { finish(); return; }
      sendClient(frame);
      replyDone = frame.type === "reply.done";
      if (frame.type === "reply.started") interrupted = false;
      if (frame.type === "input.speech.started") resetIdle();
      if (frame.type === "reply.done" && frame.status === "interrupted") {
        interrupted = true; generation += 1;
        for (const [callId, entry] of pending) sendClient({ type: "app.tool.discarded", callId, name: entry.name });
        pending.clear();
      }
      if (frame.type === "session.ended") { release(); finished = true; clearTimeout(duration); clearTimeout(idle); clearTimeout(observerTimer); live.delete(sessionId); client.close(); return; }
      const transcript = transcriptSchema.safeParse(frame);
      const call = toolCallSchema.safeParse(frame);
      const arrivalGeneration = generation;
      if (!transcript.success && !call.success) { drain(); return; }
      // Preserve transcript -> extraction ordering across async DB requests.
      // Audio forwarding above never waits for persistence.
      processing = processing.then(async () => {
        if (transcript.success) {
          const t = transcript.data;
          const next = await withKnownOwner(owner, () => persisted(sessionId, () => (isReplaySession(sessionId) ? replayTranscript : recordTranscript)(sessionId, { role: t.type === "transcript.user" ? "user" : "assistant", text: t.text, itemId: t.item_id, interrupted: t.interrupted })));
          sendClient({ type: "app.snapshot", snapshot: next }); resetIdle();
        }
        if (call.success) {
          const c = call.data;
          if (finished || arrivalGeneration !== generation) { sendClient({ type: "app.tool.discarded", callId: c.call_id, name: c.name }); return; }
          try {
            const output = await withKnownOwner(owner, () => persisted<{result:unknown;snapshot:ReturnType<typeof getSessionSnapshot>}>(sessionId, () => (isReplaySession(sessionId) ? executeReplayTool : executeVoiceTool)(sessionId, { callId: c.call_id, name: c.name, arguments: c.arguments }), "write", () => { if (finished || arrivalGeneration !== generation) throw new DomainError("voice_stopped", "Voice tool cancelled before dispatch or commit.", 409); }));
            if (!interrupted && arrivalGeneration === generation) pending.set(c.call_id, { name: c.name, result: output.result, isError: false });
            else sendClient({ type: "app.tool.discarded", callId: c.call_id, name: c.name });
            sendClient({ type: "app.tool.result", callId: c.call_id, name: c.name, result: output.result, isError: false });
            sendClient({ type: "app.snapshot", snapshot: output.snapshot });
          } catch (error) {
            const output = { error: error instanceof Error ? error.message : "Tool failed." };
            if (arrivalGeneration === generation) pending.set(c.call_id, { name: c.name, result: output, isError: true });
            sendClient({ type: "app.tool.result", callId: c.call_id, name: c.name, result: output, isError: true });
          }
        }
        drain();
      }).catch(() => { sendClient({ type: "session.error", code: "voice_processing_failed", message: "Voice processing failed safely. Use the local guided demo." }); finish(); });
    });
    upstream.on("error", () => { sendClient({ type: "session.error", code: "provider_unavailable", message: "Voice provider connection failed. No automatic retry was made." }); finish(); });
    upstream.on("close", finish);
  } catch (error) { sendClient({ type: "session.error", code: "voice_initialization_failed", message: error instanceof Error ? error.message : "Voice initialization failed." }); finish(); }
}
export async function endVoice(sessionId: string) {
  if (usesSupabase()) {
    await rpc("riv_voice_control", { p_session_id: sessionId, p_owner_id: requestOwner(), p_ticket_hash: null, p_cancel: true });
  } else {
    for (const [hash, ticket] of ticketMap) if (ticket.sessionId === sessionId) ticketMap.delete(hash);
  }
  live.get(sessionId)?.();
  // The provider acknowledges termination on the active socket. A REST request
  // on a different instance records intent but cannot claim that acknowledgment.
  return { stopRequested: true, providerEnded: false };
}
