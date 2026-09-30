import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
process.env.RIV_STORAGE='supabase';
process.env.SUPABASE_URL='https://fixture.supabase.co';
process.env.SUPABASE_SECRET_KEY='sb_secret_TEST_ONLY_NO_NETWORK';
const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');for (const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));await db.exec('set role service_role');
const calls=[];
globalThis.fetch=async (url,init)=>{
 const name=String(url).split('/rpc/')[1];assert.ok(name,'Only local fake RPC calls allowed');calls.push(name);
 const args=JSON.parse(init.body);
 const keys=Object.keys(args);const bindings=keys.map((key,i)=>`${key} => $${i+1}`).join(',');
 try{const result=await db.query(`select public.${name}(${bindings}) as result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return new Response(JSON.stringify(result.rows[0].result),{status:200,headers:{'content-type':'application/json'}});}
 catch(error){const status=error.code?.startsWith('PT')?Number(error.code.slice(2)):500;return new Response('{}',{status});}
};
const {persisted}=await import('../server/storage/supabase.ts');const {withKnownOwner}=await import('../server/access.ts');const app=await import('../agent/lib/demo/service.ts');
const owner='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const run=(id,fn,mode)=>withKnownOwner(owner,()=>persisted(id,fn,mode));
const s=await run(null,()=>app.startSession({customerId:'CUST-001'}));
const d=await run(s.id,()=>app.addMessage(s.id,'The fit is too tight and the fabric is too hot.'));
assert.ok(d.candidates.length);
const c=d.candidates[0];const p=await run(s.id,()=>app.proposeResolution(s.id,{action:'exchange',productId:c.productId,size:d.item.size,color:c.colors[0]}));
const completed=await run(s.id,()=>app.resolveProposal(s.id,{proposalId:p.pendingAction.proposalId,confirmed:true,conditionConfirmed:true}));assert.equal(completed.phase,'COMPLETED');
const retry=await run(s.id,()=>app.resolveProposal(s.id,{proposalId:p.pendingAction.proposalId,confirmed:true,conditionConfirmed:true}));assert.equal(retry.resolution.recordId,completed.resolution.recordId);
const read=await run(s.id,()=>app.getSessionSnapshot(s.id),'read');assert.equal(read.resolution.recordId,completed.resolution.recordId);
await assert.rejects(()=>withKnownOwner(other,()=>persisted(s.id,()=>app.getSessionSnapshot(s.id),'read')),/unavailable/);
const otherDashboard=await withKnownOwner(other,()=>persisted(null,()=>app.merchantInsights(),'all'));assert.equal(otherDashboard.insights.length,0);assert.equal(otherDashboard.sessions.length,0);
const ledger=await db.query("select count(*)::integer n from riv_private.records where kind='exchange'");assert.equal(ledger.rows[0].n,1);
console.log('PASS: real domain -> request-scoped store -> SQL RPC -> fresh request hydration -> idempotent confirmation; cross-owner session and merchant dashboard denied. All fetches intercepted locally; no Supabase account or network used.');
await db.close();
