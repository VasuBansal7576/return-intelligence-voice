import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {bindPrivateHistorySession,lookupPrivateHistory,unbindPrivateHistorySession} from '../server/private/history.ts';
import {MERCHANDISING_COLLECTION} from '../agent/lib/knowledge/merchandising.ts';
mkdirSync('.private',{recursive:true});const file='.private/test-history.json';
const item={itemRef:'fixture-item',name:'Fixture polo',size:'XL',orderedOn:'2026-01-02',deliveredOn:null,status:'Refund Completed',publicUrl:'https://www.thesouledstore.com/product/fixture',currentPublicMaterial:null,returnReason:null,keptOutcome:null,likedOutcome:null,variantId:null,sku:null,gsm:null};
const input={customerRef:'fixture-customer',source:{accountSource:'https://www.thesouledstore.com/orders',observedAt:'2026-09-01T00:00:00Z',method:'user-authorized account UI observation',merchantIntegration:false,materialScope:'current public product attribute, not verified purchase composition'},items:[item]};
try {
 writeFileSync(file,JSON.stringify(input)); bindPrivateHistorySession('fixture-session','fixture-customer',file);
 const first=lookupPrivateHistory('fixture-session','fixture-item');assert.equal(first.items[0].returnReason,null);assert.equal(first.items[0].keptOutcome,null);assert.equal(first.currentMerchantEligibility,null);assert.equal(first.transactional,false);
 input.items[0].name='Updated fixture';writeFileSync(file,JSON.stringify(input));assert.equal(lookupPrivateHistory('fixture-session').items[0].name,'Updated fixture','fresh lookup per session, no permanently cached history');
 assert.throws(()=>lookupPrivateHistory('other-session'),/binding/);assert.throws(()=>lookupPrivateHistory('fixture-session','missing'),/not found/);
 bindPrivateHistorySession('wrong-customer','other',file);assert.throws(()=>lookupPrivateHistory('wrong-customer'),/does not match/);
 input.items[0].email='forbidden';writeFileSync(file,JSON.stringify(input));assert.throws(()=>lookupPrivateHistory('fixture-session'));
 for(const env of ['VERCEL','RIV_STORAGE','RIV_VOICE_APPROVED','RIV_PUBLIC_VOICE_APPROVED']){const prior=process.env[env];process.env[env]=env==='RIV_STORAGE'?'supabase':'true';assert.throws(()=>lookupPrivateHistory('fixture-session'),/offline local/);if(prior===undefined)delete process.env[env];else process.env[env]=prior;}
 assert.equal(MERCHANDISING_COLLECTION.items.length,4);for(const p of MERCHANDISING_COLLECTION.items){assert.equal(p.stock,null);assert.equal(p.gsm,null);assert.equal(p.priceInr,null);assert.equal(p.executableExchangeCandidate,false);assert.equal(p.cohortSuccess,null);}
 console.log('PASS private adapter: isolated session binding, fresh selected-item lookup, unknowns, strict PII rejection, hosted/provider denial; collection membership separated from executable stock/cohorts. Synthetic input only; zero external calls.');
}finally{unbindPrivateHistorySession('fixture-session');unbindPrivateHistorySession('wrong-customer');rmSync(file,{force:true});}
