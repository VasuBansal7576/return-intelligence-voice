import assert from 'node:assert/strict';
import {z} from 'zod';
import {structuredDiagnosisSchema,startSession,recordTranscript,executeVoiceTool,serializeSession} from '../agent/lib/demo/service.ts';
// Recorded final synthetic transcript, third judge capture 2026-09-30.
// Constructed regression arguments: failed tool arguments were not retained.
const text='This is an automated synthetic customer test. I am calling about the TSS Originals Midnight Tee in my demo order. The fabric feels too heavy. I like the oversized fit. Please show me the size chart. source-backed alternatives with a lower published GSM and explain any trade-offs. I understand the order and inventory are simulated.';
const input={text,primaryReason:'material.too_heavy',secondaryReasons:[],labels:['material_too_heavy'],evidence:[{label:'material.too_heavy',quote:'The fabric feels too heavy.'}],likedAttributes:['fit'],confidence:0.95,clarifyingQuestion:null,preferences:[]};
const schema=z.toJSONSchema(structuredDiagnosisSchema);
const publishedChoices=schema.properties.primaryReason.enum;
const {DIAGNOSIS_REASONS}=await import('../agent/lib/engine/diagnosis.ts');
assert.deepEqual(publishedChoices,[...DIAGNOSIS_REASONS]);
assert.deepEqual(schema.properties.secondaryReasons.items.enum,publishedChoices);
for(const reason of ['material.too_heavy','fit.shoulders_tight','quality.stitching_failure','fulfillment.wrong_item','other.unclear_primary']){
 assert.ok(publishedChoices.includes(reason));assert.equal(structuredDiagnosisSchema.parse({...input,primaryReason:reason}).primaryReason,reason);
}
for(const reason of ['material\\.too_heavy','materialXtoo_heavy','invented.too_heavy','material.invented_cure','material.too-heavy','material.too_heavy\n','material_too_heavy']){
 assert.equal(publishedChoices.includes(reason),false);assert.equal(structuredDiagnosisSchema.safeParse({...input,primaryReason:reason}).success,false);
}
assert.equal(structuredDiagnosisSchema.safeParse({...input,labels:['invented_label']}).success,false);
assert.equal(structuredDiagnosisSchema.safeParse({...input,confidence:2}).success,false);
assert.equal(structuredDiagnosisSchema.safeParse({...input,evidence:[]}).success,false);
const s=startSession({customerId:'CUST-001',orderId:'TSS-GROUND-2001',itemId:'TSS-GROUND-2001-1'});
recordTranscript(s.id,{role:'user',text,itemId:'recorded-synthetic-transcript'});
const result=await executeVoiceTool(s.id,{callId:'constructed-recorded-regression',name:'diagnose_return',arguments:input});
assert.equal(result.snapshot.diagnosis.primaryReason,'material.too_heavy');assert.equal(result.snapshot.pendingAction,null);
const before=serializeSession(s.id);
await assert.rejects(()=>executeVoiceTool(s.id,{callId:'unspoken-regression',name:'diagnose_return',arguments:{...input,evidence:[{label:'material.too_heavy',quote:'A completely invented complaint'}]}}),/actual transcript/);
assert.deepEqual(serializeSession(s.id).work,before.work);
console.log('PASS literal-dot reason contract, generated JSON/runtime parity, taxonomy/evidence guards, recorded synthetic transcript with explicitly constructed args; zero providers');
