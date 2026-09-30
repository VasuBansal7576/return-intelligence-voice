import { replaySourceOptions, replayFromSourceToken } from "./private/source-options.ts";
import { domainSnapshot } from "./session-domain.ts";
import * as historical from "./replay-session.ts";
import { prepareVoiceReceipt, readSanitizedReceipt } from "./private/provider-receipt.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { z } from "zod";
import { persisted, usesSupabase } from "./storage/supabase.ts";
import { withHttpOwner, withSocketOwner } from "./access.ts";
import { evaluationReport } from "./evaluations.ts";
import * as app from "../agent/lib/demo/service.ts";
import * as replay from "./private/replay.ts";
import { assertPrivateLocalOnly } from "./private/history.ts";
import { MERCHANDISING_COLLECTION } from "../agent/lib/knowledge/merchandising.ts";
import { createVoiceTicket, endVoice, upgradeVoice, voiceCapabilities } from "./voice.ts";

const frontend = resolve(process.env.VERCEL ? "dist/frontend" : "frontend");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon" };
function json(response: ServerResponse, status: number, data: unknown) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(JSON.stringify(data)); }
async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0; const parts: Buffer[] = [];
  for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > 64 * 1024) throw new app.DomainError("body_too_large", "Request exceeds 64 KB.", 413); parts.push(bytes); }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"); } catch { throw new app.DomainError("invalid_json", "The request body is not valid JSON."); }
}
function assertSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin; if (origin && new URL(origin).host !== request.headers.host) throw new app.DomainError("cross_origin_denied", "Requests must originate from this demo application.", 403);
}
async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); const path = url.pathname;
    if (path.startsWith("/api/")) {
      assertSameOrigin(request);
      if (path.startsWith("/api/replays")) {
        assertPrivateLocalOnly();
        const address=request.socket.localAddress?.replace(/^::ffff:/, "");
        const port=request.socket.localPort;
        const approvedHosts=address==="::1" ? [`[::1]:${port}`] : [`127.0.0.1:${port}`, `localhost:${port}`];
        if (!approvedHosts.includes(request.headers.host ?? "") || (request.headers.origin !== undefined && request.headers.origin !== `http://${request.headers.host}`)) throw new app.DomainError("private_origin_denied", "Private replay requires the actual loopback application origin.", 403);
        if (process.env.RIV_PRIVATE_REPLAY_ENABLED !== "true" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) throw new app.DomainError("private_replay_disabled", "Private replay requires an explicitly enabled local-only adapter.", 403);
        if (path === "/api/replays/sources" && request.method === "GET") return json(response,200,replaySourceOptions());
        if (request.method === "POST" && !request.headers["content-type"]?.startsWith("application/json")) throw new app.DomainError("json_required", "Use same-origin JSON input.", 415);
        if (path === "/api/replays" && request.method === "POST") {
          const raw=await body(request);
          if(typeof raw==="object"&&raw!==null&&"sourceToken" in raw)return json(response,201,replayFromSourceToken(z.object({sourceToken:z.string().uuid()}).strict().parse(raw).sourceToken));
          const input=z.object({customerRef:z.string(),itemRef:z.string()}).strict().parse(raw);
          return json(response,201,replay.startReplay({...input,historyFile:process.env.RIV_PRIVATE_HISTORY_FILE ?? ".private/history.json"}));
        }
        const match=path.match(/^\/api\/replays\/([^/]+)(?:\/(feedback|alternatives|select|prepare-voice))?$/);
        if(match){const id=decodeURIComponent(match[1]);const action=match[2];
          if(request.method==="GET"&&!action)return json(response,200,replay.getReplay(id));
          if(request.method==="POST"){
            const input=await body(request);
            if(action==="prepare-voice"){z.object({}).strict().parse(input);return json(response,201,prepareVoiceReceipt(id));}
            if(action==="feedback")return json(response,200,replay.addReplayFeedback(id,z.object({text:z.string().min(1).max(4000)}).strict().parse(input).text));
            if(action==="alternatives")return json(response,200,replay.presentReplayAlternatives(id,z.object({productRefs:z.array(z.string()).min(1).max(4)}).strict().parse(input).productRefs));
            if(action==="select"){const choice=z.object({productRef:z.string(),confirmed:z.literal(true)}).strict().parse(input);return json(response,200,replay.selectReplayAlternative(id,choice.productRef,choice.confirmed));}
          }
        }
        return json(response,404,{error:{code:"not_found",message:"Unknown replay route."}});
      }
      if(path==="/api/replay-voice-sessions"){
        const host=request.headers.host??"";const localPort=request.socket.localPort;
        if(process.env.RIV_HISTORICAL_VOICE_ENABLED!=="true"||process.env.VERCEL||process.env.RIV_PUBLIC_VOICE_APPROVED==='true'||![`127.0.0.1:${localPort}`,`localhost:${localPort}`].includes(host)||!["127.0.0.1","::ffff:127.0.0.1"].includes(request.socket.remoteAddress??"")||request.headers.origin!==`http://${host}`)throw new app.DomainError("historical_voice_disabled","Historical voice requires an explicitly enabled local-only sanitized receipt.",403);
        if(request.method!=="POST"||!request.headers['content-type']?.startsWith('application/json'))throw new app.DomainError("json_required","Use same-origin JSON.",415);
        const input=z.object({receiptId:z.string().uuid()}).strict().parse(await body(request));const source=readSanitizedReceipt(input.receiptId);
        return json(response,201,await persisted(null,()=>historical.startReplaySession(source)));
      }
      if (request.method === "GET" && path === "/api/health") return json(response, 200, { status: "ok", synthetic: true, paidServicesEnabled: false });
      if (request.method === "GET" && path === "/api/bootstrap") return json(response, 200, { ...app.bootstrap(), merchandising: MERCHANDISING_COLLECTION, capabilities: { mode: "local-guided-demo", synthetic: true, storage: usesSupabase() ? { kind: "supabase", scope: "signed_browser" } : { kind: "local", scope: "local_process" }, replay: { kind: "historical-replay", status: process.env.RIV_HISTORICAL_VOICE_ENABLED === "true" && !process.env.VERCEL ? "prepared" : "unconfigured", sourceLookupAvailable: process.env.RIV_PRIVATE_REPLAY_ENABLED === "true" && !usesSupabase() && process.env.RIV_VOICE_APPROVED !== "true", rawHistoryLiveAccess: false, merchantIntegration: false, requiresHumanConfirmation: true }, voice: await voiceCapabilities() } });
      if (request.method === "GET" && path === "/api/insights") return json(response, 200, await persisted(null, () => app.merchantInsights(), "all"));
      if (request.method === "GET" && path === "/api/evaluations") return json(response, 200, await evaluationReport());
      if (request.method === "POST" && path === "/api/sessions") return json(response, 201, await persisted(null, async () => app.startSession(app.newSessionSchema.parse(await body(request)))));
      if (request.method === "POST" && path === "/api/voice-token") { const input = z.object({ sessionId: z.string() }).parse(await body(request)); return json(response, 200, await createVoiceTicket(request, input.sessionId)); }
      if (request.method === "POST" && path === "/api/voice-end") { const input = z.object({ sessionId: z.string() }).parse(await body(request)); await persisted(input.sessionId, () => domainSnapshot(input.sessionId), "read"); return json(response, 200, await endVoice(input.sessionId)); }
      const route = path.match(/^\/api\/sessions\/([^/]+)(?:\/(messages|select-item|propose|resolve|cancel-proposal))?$/);
      if (route) {
        const id = decodeURIComponent(route[1]); const action = route[2];
        if (request.method === "GET" && !action) return json(response, 200, await persisted(id, () => domainSnapshot(id), "read"));
        if (request.method === "POST") {
          const input = await body(request);
          const kind=await persisted(id,()=>domainSnapshot(id),"read");
          if("kind" in kind && kind.kind==="historical-replay"){
            if(action==="cancel-proposal")return json(response,200,await persisted(id,()=>historical.cancelReplaySelection(id)));
            if(action==="resolve"){const choice=z.object({proposalId:z.string(),confirmed:z.literal(true)}).strict().parse(input);return json(response,200,await persisted(id,()=>historical.confirmReplaySelection(id,choice)));}
            throw new app.DomainError("replay_control_disabled","Historical replay uses voice feedback and confirmed app-owned selection; fixture controls are unavailable.",409);
          }
          if (action === "messages") return json(response, 200, await persisted(id, () => app.addMessage(id, z.object({ text: z.string().min(1).max(4000) }).parse(input).text)));
          if (action === "select-item") return json(response, 200, await persisted(id, () => app.selectItem(id, z.object({ itemId: z.string() }).parse(input).itemId)));
          if (action === "propose") return json(response, 200, await persisted(id, () => app.proposeResolution(id, app.proposalSchema.parse(input))));
          if (action === "cancel-proposal") return json(response, 200, await persisted(id, () => app.cancelProposal(id)));
          if (action === "resolve") {
            const next = await persisted(id, () => app.resolveProposal(id, z.object({ proposalId: z.string(), confirmed: z.literal(true), conditionConfirmed: z.boolean().optional() }).parse(input)));
            return json(response, 200, next);
          }
        }
      }
      return json(response, 404, { error: { code: "not_found", message: "No such API route." } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: { code: "method_not_allowed", message: "Use GET for files." } });
    const requested = path === "/" ? "/index.html" : decodeURIComponent(path);
    const file = resolve(frontend, `.${requested}`);
    if (!file.startsWith(frontend + sep) || !MIME[extname(file)]) throw new app.DomainError("not_found", "File not found.", 404);
    try { const bytes = await readFile(file); response.writeHead(200, { "content-type": MIME[extname(file)], "x-content-type-options": "nosniff", "cache-control": "no-cache", "referrer-policy": "no-referrer", "permissions-policy": "camera=(), geolocation=()" }); response.end(request.method === "HEAD" ? undefined : bytes); }
    catch { return json(response, 404, { error: { code: "not_found", message: "File not found." } }); }
  } catch (error) {
    if (error instanceof app.DomainError) return json(response, error.status, { error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError) return json(response, 400, { error: { code: "invalid_input", message: "Check the required fields and values.", issues: error.issues.map((i) => ({ path: i.path, message: i.message })) } });
    console.error(JSON.stringify({ event: "request_failed", message: error instanceof Error ? error.message : "Unknown error" }));
    return json(response, 500, { error: { code: "internal_error", message: "The request failed without claiming a successful action." } });
  }
}
export const server = createServer((request, response) => {
  try { void withHttpOwner(request, response, () => handleRequest(request, response)); }
  catch { json(response, 503, { error: { code: "session_security_unavailable", message: "Session security is not configured. No private session data is exposed." } }); }
});
server.on("upgrade", (request, socket, head) => {
  try { if (request.url?.startsWith("/api/voice/ws?")) withSocketOwner(request, () => { void upgradeVoice(request, socket, head); }); else socket.destroy(); }
  catch { socket.destroy(); }
});
const port = Number(process.env.PORT ?? 8787);
if (!process.env.VERCEL && process.env.RIV_NO_LISTEN !== "true") server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  void voiceCapabilities().then((voice) => process.stdout.write(JSON.stringify({ event: "server_ready", url: `http://127.0.0.1:${port}`, voice: voice.status }) + "\n"));
});
