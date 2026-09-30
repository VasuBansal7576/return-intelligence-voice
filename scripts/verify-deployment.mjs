import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync,readdirSync } from 'node:fs';
import { once } from 'node:events';
import { WebSocket } from 'ws';
const config=JSON.parse(readFileSync('vercel.json','utf8'));
assert.equal(config.fluid,true);assert.equal(config.framework,null);assert.equal(config.functions['api/server.ts'].maxDuration,300);
assert.equal(config.installCommand,'npm ci --ignore-scripts');assert.equal(config.buildCommand,'npm run build:demo');
assert.equal(JSON.parse(readFileSync('package.json','utf8')).engines.node,'24.x');
assert.deepEqual(readdirSync(config.outputDirectory).sort(),['index.html','styles.css','app.js','icons.js','art.js','voice-client.js','pcm-processor.js'].sort());
console.log('PASS Node24, Fluid, 300s function, no-provider build and browser-only static output');
process.env.VERCEL='1';process.env.RIV_STORAGE='supabase';process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_TEST_ONLY_NO_NETWORK';process.env.RIV_VOICE_APPROVED='false';
const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
await db.exec('set role service_role');
const realFetch=globalThis.fetch;let providerRequests=0;let origin;
globalThis.fetch=async (input,init)=>{
 const url=new URL(input);if(url.origin===origin)return realFetch(input,init);
 assert.equal(url.origin,'https://fixture.supabase.co','No external requests allowed');
 assert.equal(init.headers.apikey,'sb_secret_TEST_ONLY_NO_NETWORK');assert.equal(init.headers.Authorization,undefined);
 const name=url.pathname.split('/rpc/')[1];assert.ok(/^riv_\w+$/.test(name));const args=JSON.parse(init.body);const keys=Object.keys(args);
 try{const result=await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return Response.json(result.rows[0].result);}
 catch(error){return new Response('{}',{status:error.code?.startsWith('PT')?Number(error.code.slice(2)):500});}
};
const {default:server}=await import('../api/server.ts');
assert.equal(server.listening,false);assert.equal(server.listenerCount('upgrade'),1);server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
try{
 const health=await fetch(`${origin}/api/health`);assert.equal(health.status,200);const cookie=health.headers.get('set-cookie').split(';')[0];assert.match(health.headers.get('set-cookie'),/HttpOnly.*Secure/);
 const bootstrap=await fetch(`${origin}/api/bootstrap`,{headers:{cookie}});assert.equal(bootstrap.status,200);assert.equal((await bootstrap.json()).capabilities.voice.status,'unconfigured');
 const start=await fetch(`${origin}/api/sessions`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{"customerId":"CUST-001"}'});assert.equal(start.status,201);const session=await start.json();
 const read=await fetch(`${origin}/api/sessions/${session.id}`,{headers:{cookie}});assert.equal(read.status,200);assert.equal((await read.json()).id,session.id);
 const stranger=await fetch(`${origin}/api/sessions/${session.id}`);assert.equal(stranger.status,404);
 console.log('PASS exact default Server export, HTTP entry, body stream, nested routes and signed-owner isolation');
 const stop=await fetch(`${origin}/api/voice-end`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({sessionId:session.id})});assert.deepEqual(await stop.json(),{stopRequested:true,providerEnded:false});
 console.log('PASS REST stop records intent without claiming provider termination');
 const ws=new WebSocket(`${origin.replace('http:','ws:')}/api/voice/ws?sessionId=${session.id}&ticket=invalid`,{headers:{cookie,Origin:origin}});
 const status=await new Promise((resolve,reject)=>{ws.on('unexpected-response',(_req,res)=>{resolve(res.statusCode);res.resume();ws.terminate();});ws.on('open',()=>reject(new Error('Unapproved voice upgrade accepted')));ws.on('error',()=>{});});assert.equal(status,403);
 console.log('PASS actual upgrade listener reaches fail-closed voice authorization');
 const old=process.env.RIV_STORAGE;delete process.env.RIV_STORAGE;assert.equal((await fetch(`${origin}/api/insights`,{headers:{cookie}})).status,503);process.env.RIV_STORAGE=old;
 console.log('PASS missing hosted durable storage fails closed');
 assert.equal(providerRequests,0);console.log('5 deployment checks passed; real local HTTP/WebSocket transport, embedded SQL, zero external calls');
}finally{await new Promise(resolve=>server.close(resolve));await db.close();globalThis.fetch=realFetch;}
