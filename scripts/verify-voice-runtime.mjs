import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'riv-voice-runtime-'));
Object.assign(process.env,{RIV_STORAGE:'local',RIV_VOICE_APPROVED:'true',RIV_FREE_CREDIT_BALANCE_VERIFIED:'true',ASSEMBLYAI_API_KEY:'TEST_ONLY_NO_NETWORK',RIV_MAX_RESERVED_VOICE_SECONDS:'1080',RIV_VOICE_BUDGET_FILE:join(dir,'budget.json'),RIV_RECORDS_FILE:join(dir,'records.jsonl')});
delete process.env.VERCEL; delete process.env.RIV_DEPLOYMENT;
let currentClient; const providers=[]; const timers=[]; let providerRequests=0;
class FakeSocket extends EventEmitter {
 static OPEN=1; static CLOSED=3;
 readyState=1; frames=[];
 constructor(url){super();if(url){assert.equal(url.hostname,'agents.assemblyai.com');providers.push(this);}}
 send(value){this.frames.push(JSON.parse(value));}
 close(){this.readyState=3;this.emit('close');}
}
class FakeServer { handleUpgrade(_request,_socket,_head,callback){callback(currentClient);} }
mock.module('ws',{namedExports:{WebSocket:FakeSocket,WebSocketServer:FakeServer}});
globalThis.fetch=async (input,init)=>{
 const url=new URL(input);assert.equal(url.origin,'https://agents.assemblyai.com');assert.equal(url.pathname,'/v1/token');
 assert.equal(url.searchParams.get('max_session_duration_seconds'),'180');assert.equal(url.searchParams.get('expires_in_seconds'),'60');
 assert.equal(init.headers.Authorization,'Bearer TEST_ONLY_NO_NETWORK');providerRequests++;
 return new Response(JSON.stringify({token:'SYNTHETIC_TEST_TOKEN'}),{status:200});
};
const app=await import('../agent/lib/demo/service.ts');
const voice=await import('../server/voice.ts');
const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
globalThis.setTimeout=(fn,delay)=>{const timer={fn,delay,cancelled:false,unref(){return this;}};timers.push(timer);return timer;};
globalThis.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
const request={headers:{host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787'},socket:{remoteAddress:'127.0.0.1'}};
const flush=()=>new Promise(setImmediate);
async function connection(){
 const s=app.startSession({customerId:'CUST-001'});const ticket=await voice.createVoiceTicket(request,s.id);
 assert.equal(ticket.maxDurationSeconds,180);assert.equal(ticket.proxyManagedTools,true);assert.equal(ticket.idleTimeoutSeconds,30);
 currentClient=new FakeSocket();const client=currentClient;
 await voice.upgradeVoice({...request,url:ticket.websocketUrl},{write(){},destroy(){}},Buffer.alloc(0));await flush();
 const provider=providers.at(-1);provider.emit('open');await flush();
 const config=provider.frames.find(f=>f.type==='session.update').session;
 assert.equal('llm' in config,false);assert.equal(config.tools.some(t=>t.name==='request_resolution'),true);
 return {client,provider,session:s};
}
try{
 const first=await connection();
 const duration=timers.find(t=>t.delay===180000&&!t.cancelled);assert.ok(duration);duration.fn();
 assert.equal(first.provider.frames.at(-1).type,'session.end');
 const cleanup=timers.findLast(t=>t.delay===1000&&!t.cancelled);assert.ok(cleanup);cleanup.fn();assert.equal(first.client.readyState,3);
 console.log('PASS actual proxy schedules 180-second cutoff, sends session.end and closes sockets');
 const second=await connection();const idle=timers.findLast(t=>t.delay===30000&&!t.cancelled);assert.ok(idle);idle.fn();assert.equal(second.provider.frames.at(-1).type,'session.end');
 console.log('PASS actual proxy schedules 30-second idle termination');
 const third=await connection();third.client.emit('message',Buffer.from(JSON.stringify({type:'session.update',session:{llm:[{model:'forbidden'}]}})));
 assert.equal(third.provider.frames.filter(f=>f.type==='session.update').length,1);
 assert.equal(third.provider.frames.at(-1).type,'session.end');assert.equal(third.client.frames.at(-1).code,'client_configuration_forbidden');
 console.log('PASS browser model overrides rejected before forwarding');
 const fourth=await connection();fourth.client.emit('message',Buffer.from('{"type":"session.end"}'));assert.equal(fourth.provider.frames.at(-1).type,'session.end');
 console.log('PASS client session.end terminates the connection-owning instance');
 const cancelled=app.startSession({customerId:'CUST-001'});const ticket=await voice.createVoiceTicket(request,cancelled.id);
 assert.deepEqual(await voice.endVoice(cancelled.id),{stopRequested:true,providerEnded:false});const before=providerRequests;
 let rejected=false;await voice.upgradeVoice({...request,url:ticket.websocketUrl},{write(){rejected=true;},destroy(){}},Buffer.alloc(0));await flush();
 assert.equal(rejected,true);assert.equal(providerRequests,before);
 console.log('PASS REST stop does not claim acknowledgment; cancelled local ticket makes zero provider requests');
 console.log(`5 runtime checks passed; ${providerRequests} provider token operations mocked, zero network/provider usage`);
}finally{globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;mock.restoreAll();}
