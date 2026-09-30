import { revokesMaterialExploration } from "../../agent/lib/engine/consent.ts";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { assertPrivateLocalOnly, bindPrivateHistorySession, lookupPrivateHistory } from "./history.ts";
import { diagnoseReturn } from "../../agent/lib/engine/diagnosis.ts";
import { discountDecision } from "../../agent/lib/demo/service.ts";
import { PUBLIC_CATALOG_EVIDENCE } from "../../agent/lib/knowledge/public-catalog.ts";
import { MERCHANDISING_COLLECTION } from "../../agent/lib/knowledge/merchandising.ts";

const stateSchema = z.object({ id: z.string().uuid(), customerRef: z.string(), itemRef: z.string(), historyFile: z.string(), sourceHash: z.string(), createdAt: z.string(), feedback: z.string().nullable(), sensitiveExplorationConsent: z.boolean(), presentedProductRefs: z.array(z.string()), selection: z.object({ recordId: z.string(), kind: z.literal("replay_selection"), selectedProductRef: z.string(), recordedAt: z.string(), simulated: z.literal(true), merchantActionExecuted: z.literal(false) }).nullable() }).strict();
type ReplayState = z.infer<typeof stateSchema>;
function root() { assertPrivateLocalOnly(); const dir=resolve(".private/replays"); mkdirSync(dir,{recursive:true,mode:0o700});return dir; }
function path(id:string) { z.string().uuid().parse(id); return resolve(root(),id+".json"); }
function write(state:ReplayState) { const target=path(state.id); const temp=target+".tmp";writeFileSync(temp,JSON.stringify(state),{mode:0o600});renameSync(temp,target); }
function source(state:ReplayState) {
  bindPrivateHistorySession(state.id,state.customerRef,state.historyFile);
  const lookup=lookupPrivateHistory(state.id,state.itemRef); const item=lookup.items[0]!;
  if(createHash("sha256").update(JSON.stringify(item)).digest("hex")!==state.sourceHash)throw new Error("Historical source changed; start a new replay rather than rewriting its history.");
  return {lookup,item};
}
function load(id:string) { const file=path(id); if(!existsSync(file))throw new Error("Replay session not found.");const state=stateSchema.parse(JSON.parse(readFileSync(file,"utf8")));source(state);return state; }
function publicProduct(ref:string) {
  const p=PUBLIC_CATALOG_EVIDENCE.products.find(p=>p.id===ref);
  if(p)return {ref:p.id,name:p.name,url:p.productUrl,observedAt:p.observedAt,material:p.material,gsm:p.gsm,priceInr:p.priceInr,fit:p.fit,stock:null,executableExchangeCandidate:false,claim:null};
  const t=MERCHANDISING_COLLECTION.items.find(p=>p.ref===ref);
  if(t)return {...t,observedAt:MERCHANDISING_COLLECTION.membershipObservedAt,fit:null,claim:MERCHANDISING_COLLECTION.permittedClaim};
  throw new Error("Alternative must have exact public catalog or sourced collection evidence.");
}
function snapshot(state:ReplayState) {
  const {lookup,item}=source(state);const diagnosis=state.feedback?diagnoseReturn(state.feedback):null;
  const hardGate=Boolean(diagnosis && (diagnosis.refundOnly || diagnosis.frustrated || diagnosis.labels.some(label=>label==="quality_defect"||label==="wrong_item")));
  const gated=hardGate || Boolean(diagnosis && (!diagnosis.recommendationAllowed && !(diagnosis.labels.includes("sensitive_skin_reaction")&&state.sensitiveExplorationConsent)));
  return {id:state.id,replay:true,nonTransactional:true,sourceItem:item,sourceProvenance:lookup.source,currentFeedback:state.feedback,diagnosis,
    currentMerchantEligibility:null,canonicalDiscountDecision:discountDecision(),selection:state.selection,
    alternatives:gated?[]:state.presentedProductRefs.map(ref=>({...publicProduct(ref),solvesComplaint:null,materialSafety:null})),
    cohortDataAvailable:false,merchantActionExecuted:false,
    status:"Historical feedback replay · app-owned selection only · no merchant exchange/refund",
    boundaryNotice:"Historical dates and status remain unchanged. Public material describes the current listing, not verified purchase composition. Stock and merchant eligibility are unknown. Selection records interest only; comfort and material suitability are not guaranteed."};
}
export function startReplay(input:{customerRef:string;itemRef:string;historyFile:string}) {
  assertPrivateLocalOnly(); const id=randomUUID();bindPrivateHistorySession(id,input.customerRef,input.historyFile);const {items}=lookupPrivateHistory(id,input.itemRef);const item=items[0]!;
  if(item.status!=="Refund Completed")throw new Error("This replay requires an already-refunded historical source item.");
  const state:ReplayState={id,customerRef:input.customerRef,itemRef:input.itemRef,historyFile:resolve(input.historyFile),sourceHash:createHash("sha256").update(JSON.stringify(item)).digest("hex"),createdAt:new Date().toISOString(),feedback:null,sensitiveExplorationConsent:false,presentedProductRefs:[],selection:null};write(state);return snapshot(state);
}
export function getReplay(id:string) { return snapshot(load(id)); }
export function addReplayFeedback(id:string,text:string) {
  const state=load(id);if(state.selection)throw new Error("Replay selection already recorded.");const input=z.string().min(1).max(4000).parse(text);state.feedback=z.string().max(12000).parse(state.feedback ? state.feedback+"\n"+input : input);
  const d=diagnoseReturn(state.feedback);if(d.refundOnly||d.frustrated||revokesMaterialExploration(text))state.sensitiveExplorationConsent=false;
  else if(d.labels.includes("sensitive_skin_reaction")&&/\b(show|explore|want).{0,30}(alternatives|different material)\b/i.test(text))state.sensitiveExplorationConsent=true;
  state.presentedProductRefs=[];write(state);return snapshot(state);
}
export function presentReplayAlternatives(id:string,refs:string[]) {
  const state=load(id);if(!state.feedback)throw new Error("Ask for current feedback before presenting alternatives.");
  if(state.selection)throw new Error("Replay selection already recorded.");
  state.presentedProductRefs=z.array(z.string()).min(1).max(4).parse(refs);for(const ref of state.presentedProductRefs)publicProduct(ref);
  write(state);return snapshot(state);
}
export function selectReplayAlternative(id:string,ref:string,confirmed:boolean) {
  const state=load(id);if(!confirmed)throw new Error("Explicit customer confirmation is required.");
  if(state.selection){if(state.selection.selectedProductRef!==ref)throw new Error("Replay already has a different selection.");return snapshot(state);}
  if(!snapshot(state).alternatives.some(p=>p.ref===ref))throw new Error("Choose a presented, permitted grounded alternative.");
  state.selection={recordId:"REPLAY-"+randomUUID(),kind:"replay_selection",selectedProductRef:ref,recordedAt:new Date().toISOString(),simulated:true,merchantActionExecuted:false};write(state);return snapshot(load(id));
}
