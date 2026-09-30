import assert from 'node:assert/strict';
import recorded from './recorded-fourth-diagnosis.json' with {type:'json'};
import {startSession,recordTranscript,executeVoiceTool,serializeSession} from '../agent/lib/demo/service.ts';
async function run(args){const s=startSession({customerId:'CUST-001',orderId:'TSS-GROUND-2001',itemId:'TSS-GROUND-2001-1'});recordTranscript(s.id,{role:'user',text:args.text,itemId:'actual-recorded'});return {s,result:await executeVoiceTool(s.id,{callId:'diagnose',name:'diagnose_return',arguments:args})};}
const {s,result}=await run(recorded);
assert.deepEqual(result.snapshot.diagnosis.secondaryReasons,[]);assert.equal(result.snapshot.diagnosis.requiresClarification,false);assert.ok(result.snapshot.diagnosis.likedAttributes.includes('fit'));
const search=await executeVoiceTool(s.id,{callId:'search',name:'search_products',arguments:{}});assert.ok(search.result.candidates.length>0);assert.equal(search.result.searchStatus,'candidates_found');
for(const positive of ['I love this fit.','Keep the fit.','I prefer the fit.']){const args={...recorded,text:'The fabric feels too heavy. '+positive,evidence:[recorded.evidence[0],{label:'fit_too_small',quote:positive}],preferences:[]};const out=await run(args);assert.deepEqual(out.result.snapshot.diagnosis.secondaryReasons,[]);}
const ambiguous={...recorded,text:'The fabric feels too heavy. The shoulders feel restrictive.',secondaryReasons:['fit.shoulders_tight'],evidence:[recorded.evidence[0],{label:'fit.shoulders_tight',quote:'The shoulders feel restrictive.'}],preferences:[],likedAttributes:[]};
const kept=await run(ambiguous);assert.ok(kept.result.snapshot.diagnosis.secondaryReasons.includes('fit.shoulders_tight'));assert.equal(kept.result.snapshot.diagnosis.requiresClarification,true);
const gated=await executeVoiceTool(kept.s.id,{callId:'gated',name:'search_products',arguments:{}});assert.equal(gated.result.searchStatus,'clarification_required');assert.equal(gated.result.inventoryConclusion,'not_evaluated');assert.match(gated.result.emptyResultExplanation,/do not indicate out-of-stock/);
const denied=startSession({customerId:'CUST-001'});recordTranscript(denied.id,{role:'user',text:recorded.text,itemId:'denied'});const before=serializeSession(denied.id);
await assert.rejects(()=>executeVoiceTool(denied.id,{callId:'contradiction',name:'diagnose_return',arguments:{...recorded,primaryReason:'fit.too_small'}}),/positive attribute/);assert.deepEqual(serializeSession(denied.id).work,before.work);
console.log('PASS exact recorded fourth-call args, varied positives, actual problem preserved, contradiction rejected, clarification-empty does not assert inventory shortage; zero providers');
