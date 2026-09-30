import assert from 'node:assert/strict';
import {startSession,addMessage,serializeSession,hydrateSession,getSessionSnapshot,recordTranscript,executeVoiceTool} from '../agent/lib/demo/service.ts';
const s=startSession({customerId:'CUST-002'});
addMessage(s.id,'This makes my skin itch.');
const explored=addMessage(s.id,'Show alternatives with a different material');
assert.ok(explored.candidates.length>0);
const fit=explored.candidates[0].fit;
assert.ok(explored.messages.at(-1).text.includes(`has ${/^[aeiou]/i.test(fit)?"an":"a"} ${fit} fit`));
assert.doesNotMatch(explored.messages.at(-1).text,/has a oversized fit/);
hydrateSession(JSON.parse(JSON.stringify(serializeSession(s.id))));
assert.equal(getSessionSnapshot(s.id).candidates.length,explored.candidates.length,'consent survives hydration');
assert.doesNotMatch(explored.messages.at(-1).text,/only explore other materials if you ask/);
const discounted=addMessage(s.id,'Can you give me a discount?');
assert.match(discounted.messages.at(-1).text,/cannot.*discount/i);
assert.equal(discounted.pendingAction,null);
recordTranscript(s.id,{role:'assistant',text:'Provider words',itemId:'provider-item-1'});
assert.equal(getSessionSnapshot(s.id).messages.at(-1).itemId,'provider-item-1');
await executeVoiceTool(s.id,{callId:'model-call-1',name:'get_order',arguments:{}});
const trace=getSessionSnapshot(s.id).tools.at(-1);
assert.equal(trace.callId,'model-call-1'); assert.equal(trace.origin,'model');
assert.ok(getSessionSnapshot(s.id).tools.some(t=>t.origin==='startup'&&t.durationMs===null));
const native=startSession({customerId:'CUST-002'});
async function diagnose(text,labels,reason,callId) {
 recordTranscript(native.id,{role:'user',text,itemId:callId+'-transcript'});
 return executeVoiceTool(native.id,{callId,name:'diagnose_return',arguments:{text,primaryReason:reason,secondaryReasons:[],labels,evidence:[{label:reason,quote:text}],likedAttributes:[],confidence:0.95,clarifyingQuestion:null,preferences:[]}});
}
await diagnose('This makes my skin itch.',['sensitive_skin_reaction'],'sensitive.skin_reaction','skin');
assert.equal(getSessionSnapshot(native.id).candidates.length,0);
await diagnose('Show alternatives with a different material',['other'],'other.unclear','consent');
const nativeBefore=getSessionSnapshot(native.id); assert.ok(nativeBefore.candidates.length>0);
hydrateSession(JSON.parse(JSON.stringify(serializeSession(native.id))));
assert.deepEqual(getSessionSnapshot(native.id).candidates,nativeBefore.candidates);
assert.match(explored.messages.at(-1).text,/cannot.*guarantee skin comfort/i);
const beforeDiscount=serializeSession(native.id);
const decision=await executeVoiceTool(native.id,{callId:'discount',name:'get_discount_policy',arguments:{}});
assert.equal(decision.result.allowed,false); assert.equal(decision.result.escalate,false);
const afterDiscount=serializeSession(native.id);
assert.deepEqual(afterDiscount.work,beforeDiscount.work); assert.equal(decision.snapshot.item.priceInr,nativeBefore.item.priceInr);
assert.ok(!decision.snapshot.tools.some(t=>t.name==='escalate_to_human'));
await diagnose('No thanks. I only want a refund.',['changed_mind'],'preference.refund_only','revoke');
hydrateSession(JSON.parse(JSON.stringify(serializeSession(native.id))));
assert.equal(getSessionSnapshot(native.id).candidates.length,0);
console.log('PASS integration gaps: text and native consent/hydration/revocation, no safety guarantees, discount no proposal/price/escalation mutation, item IDs, tool provenance. No provider calls.');
// A skin-consent override cannot relax defect, refund or fulfillment policy.
const {withRecordTransaction}=await import('../agent/lib/engine/records.ts');
for(const nativePath of [false,true]) {
 const gated=startSession({customerId:'CUST-002'});
 const say=async(text,labels,reason,callId)=>nativePath?executeVoiceTool(gated.id,{callId,name:'diagnose_return',arguments:{text,primaryReason:reason,secondaryReasons:[],labels,evidence:[{label:reason,quote:text}],likedAttributes:[],confidence:0.95,clarifyingQuestion:null,preferences:[]}}):addMessage(gated.id,text);
 await say('This makes my skin itch.',['sensitive_skin_reaction'],'sensitive.skin_reaction','g-skin');
 await say('Show alternatives with a different material',['other'],'other.unclear','g-consent');
 assert.ok(getSessionSnapshot(gated.id).candidates.length>0);
 await say('It also arrived with a torn seam on day one.',['quality_defect'],'quality.defect','g-defect');
 assert.equal(getSessionSnapshot(gated.id).candidates.length,0);
 await withRecordTransaction([],()=>{hydrateSession(JSON.parse(JSON.stringify(serializeSession(gated.id))));assert.equal(getSessionSnapshot(gated.id).candidates.length,0);});
 await say("Don't show alternatives with a different material",['other'],'other.unclear','g-revoke');
 assert.equal(serializeSession(gated.id).work[0].sensitiveExplorationConsent,false);
 hydrateSession(JSON.parse(JSON.stringify(serializeSession(gated.id))));assert.equal(getSessionSnapshot(gated.id).candidates.length,0);
}
// Inspect the actual UI object passed to createVoiceClient; duplicates fail closed.
const {readFileSync}=await import('node:fs');
const ui=readFileSync(new URL('../frontend/app.js',import.meta.url),'utf8');
const options=ui.split('state.voice=createVoiceClient(')[1].split('await state.voice.start()')[0];
const callbackNames=[...options.matchAll(/(?:^|\n)\s*(on\w+)\([^)]*\)\{/g)].map(m=>m[1]);
assert.equal(new Set(callbackNames).size,callbackNames.length,'duplicate frontend callback property');
const body=options.match(/onTool\(event\)\{([^}]+)\}/)[1];
const state={};let renders=0;const render=()=>renders++;
const actualHandler=new Function('state','render','event',body);
const event={callId:'actual-binding',name:'request_resolution',status:'discarded'};
actualHandler(state,render,event);assert.equal(state.voiceTools.get(event.callId),event);assert.equal(renders,1);
console.log('PASS sensitive + defect text/native/transaction/hydration and executed actual frontend onTool duplicate guard');

for(const name of ['create_return','create_exchange']) {
 const source=readFileSync(new URL('../agent/tools/'+name+'.ts',import.meta.url),'utf8');
 const body=source.match(/execute\(\)\s*\{([^}]+)\}/)[1];
 assert.throws(()=>new Function(body)(),/Legacy Eve transaction execution is disabled/);
}
console.log('PASS authored Eve transactional tool entrypoints fail closed');
