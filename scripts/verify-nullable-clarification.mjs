import assert from 'node:assert/strict';
import {z} from 'zod';
import captured from './recorded-final-diagnosis.json' with {type:'json'};
import {normalizeClarifyingQuestion,structuredDiagnosisSchema,startSession,recordTranscript,executeVoiceTool,serializeSession} from '../agent/lib/demo/service.ts';
async function run(args){const s=startSession({customerId:'CUST-001',orderId:'TSS-GROUND-2001',itemId:'TSS-GROUND-2001-1'});recordTranscript(s.id,{role:'user',text:args.text,itemId:'actual-final'});return {s,result:await executeVoiceTool(s.id,{callId:'diagnose',name:'diagnose_return',arguments:args})};}
for(const sentinel of [null,undefined,'None',' NONE ','null','N/A','No question','No clarification needed','Not needed.','','  ']){
 assert.equal(normalizeClarifyingQuestion(sentinel),null);
 const {s,result}=await run({...captured,clarifyingQuestion:sentinel});
 assert.equal(result.snapshot.diagnosis.clarifyingQuestion,null);assert.equal(result.snapshot.diagnosis.requiresClarification,false);
 const search=await executeVoiceTool(s.id,{callId:'search',name:'search_products',arguments:{}});assert.equal(search.result.searchStatus,'candidates_found');assert.ok(search.result.candidates.length>0);
}
for(const question of ['Was the weight the only concern?','None of these options works; what else would you prefer?']){
 const {result}=await run({...captured,clarifyingQuestion:question});assert.equal(result.snapshot.diagnosis.clarifyingQuestion,question);assert.equal(result.snapshot.diagnosis.requiresClarification,true);
}
const low=await run({...captured,confidence:0.5});assert.equal(low.result.snapshot.diagnosis.requiresClarification,true);assert.match(low.result.snapshot.diagnosis.clarifyingQuestion,/clarify/i);
const ambiguity={...captured,text:'I did not like the fit.',primaryReason:'other.unclear',labels:['other'],likedAttributes:[],evidence:[{label:'other.unclear',quote:'I did not like the fit.'}],preferences:[]};
const unclear=await run(ambiguity);assert.equal(unclear.result.snapshot.diagnosis.requiresClarification,true);assert.match(unclear.result.snapshot.diagnosis.clarifyingQuestion,/tight.*loose/);
const before=serializeSession(unclear.s.id);
await assert.rejects(()=>executeVoiceTool(unclear.s.id,{callId:'fabricated',name:'diagnose_return',arguments:{...ambiguity,evidence:[{label:'other.unclear',quote:'An invented statement'}]}}),/actual transcript/);assert.deepEqual(serializeSession(unclear.s.id).work,before.work);
const json=JSON.parse(JSON.stringify(z.toJSONSchema(structuredDiagnosisSchema)));assert.ok(json.properties.clarifyingQuestion.anyOf.some(x=>x.type==='null'));assert.match(json.properties.clarifyingQuestion.description,/JSON null/);
assert.equal(structuredDiagnosisSchema.safeParse({...captured,clarifyingQuestion:42}).success,false);
console.log('PASS exact recorded final args, no-question sentinels/omission, real questions/ambiguity/low confidence/evidence preserved, nullable JSON schema; offline only');
