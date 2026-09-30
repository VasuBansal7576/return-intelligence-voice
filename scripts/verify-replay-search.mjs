import assert from 'node:assert/strict';
import {searchReplayCatalog} from '../agent/lib/engine/replay-search.ts';
import * as replay from '../server/replay-session.ts';
import {PUBLIC_CATALOG_EVIDENCE} from '../agent/lib/knowledge/public-catalog.ts';
const night='https://www.thesouledstore.com/product/hot-wheels-first-race-men-oversized-t-shirts';const known=PUBLIC_CATALOG_EVIDENCE.products.find(p=>p.name==='TSS Originals: Midnight');
const run=(url,text)=>searchReplayCatalog(url,text,'XL');
assert.equal(run(night,'The fabric feels heavy. Show alternatives.').candidates.length,0,'Unknown source GSM cannot prove a lighter match');
let r=run(night,'The fabric feels heavy. Show alternatives with a different composition. I want a relaxed shirt with linen.');assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>c.product.category==='shirt'&&c.product.fit==='relaxed'&&c.product.material.includes('Linen')));assert.ok(r.limitations.some(l=>/GSM unknown/.test(l)));assert.ok(r.candidates.every(c=>c.why.some(w=>/unverified/.test(w))));
r=run(night,'The fabric feels heavy. Show different material. I want a slim polo with linen.');assert.equal(r.candidates.length,0,'Unsupported intersection must not fallback to trending');
r=run(night,'The fabric feels heavy. Show different material. I want linen shirts. Avoid polyester.');assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>c.product.material.includes('Linen')&&!/polyester/i.test(c.product.material)));
r=run(known.productUrl,'The fabric feels heavy. Show alternatives.');assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>c.product.gsm!==null&&c.product.gsm<250&&c.product.category===known.category));assert.ok(r.candidates.every(c=>c.why.some(w=>/250 GSM/.test(w))));
r=run(known.productUrl,'The fabric feels heavy. I like the theme and the fit. Show alternatives.');assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>c.product.name.startsWith('TSS Originals:')&&c.product.fit==='oversized'));
r=run(night,'The fabric feels heavy. Keep the color. Show different material.');assert.equal(r.candidates.length,0,'Unknown source color cannot be invented');
r=run(night,'The fabric feels heavy. Show different material. I want linen shirts. I do not want linen.');assert.ok(r.candidates.every(c=>!/linen/i.test(c.product.material)),'Latest negative preference revokes positive');
r=run(night,'The fabric feels heavy. Show different material. I want a relaxed shirt under 1200.');assert.ok(r.candidates.every(c=>c.product.priceInr<=1200));
for(const text of ['I only want a refund.','The stitching came apart. Show different material.','This makes my skin itch.','I am furious. Show different material.']){
 const s=replay.startReplaySession({historicalReplay:true,merchantIntegration:false,items:[{product:{name:'Hot Wheels: Nightburn',url:night},size:'XL',orderStatus:'Refund Completed'}]});replay.replayTranscript(s.id,{role:'user',text,itemId:crypto.randomUUID()});replay.executeReplayTool(s.id,{callId:crypto.randomUUID(),name:'diagnose_replay_feedback',arguments:{}});const out=replay.executeReplayTool(s.id,{callId:crypto.randomUUID(),name:'search_replay_products',arguments:{}});assert.equal(out.result.products.length,0);assert.equal(out.snapshot.source.items[0].orderStatus,'Refund Completed');
}
console.log('PASS public-only replay catalog: unknown GSM no-match, known lower GSM, composition+fit+category intersection, preserved explicit theme/fit/color, revocation, budget and hard gates. Offline only.');
