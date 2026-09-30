import assert from 'node:assert/strict';
import {writeFileSync,rmSync} from 'node:fs';
import {request as rawRequest} from 'node:http';
import {once} from 'node:events';
process.env.RIV_NO_LISTEN='true';process.env.RIV_STORAGE='local';process.env.RIV_VOICE_APPROVED='false';process.env.RIV_PRIVATE_REPLAY_ENABLED='true';process.env.RIV_PRIVATE_HISTORY_FILE='.private/test-http-history.json';
const file=process.env.RIV_PRIVATE_HISTORY_FILE;let id,receiptId;
process.env.RIV_PRIVATE_CUSTOMER_REF="fixture";process.env.RIV_HISTORICAL_VOICE_ENABLED="true";
writeFileSync(file,JSON.stringify({customerRef:'fixture',source:{accountSource:'https://www.thesouledstore.com/orders',observedAt:'2026-09-01T00:00:00Z',method:'user-authorized account UI observation',merchantIntegration:false,materialScope:'current public product attribute, not verified purchase composition'},items:[{itemRef:'fixture-refunded',name:'Synthetic historical polo',size:'XL',orderedOn:'2026-01-02',deliveredOn:null,status:'Refund Completed',publicUrl:'https://www.thesouledstore.com/product/fixture',currentPublicMaterial:null,returnReason:null,keptOutcome:null,likedOutcome:null,variantId:null,sku:null,gsm:null}]}));
const {server}=await import('../server/main.ts');server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
const post=(path,data,headers={})=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',origin,...headers},body:JSON.stringify(data)});
try{
 process.env.RIV_PRIVATE_HISTORY_FILE='.private/absent-boundary-fixture.json';
 const denied=await new Promise((resolve,reject)=>{const req=rawRequest(origin+'/api/replays',{method:'POST',headers:{host:'attacker.example',origin:'http://attacker.example','content-type':'application/json'}},res=>{let body='';res.on('data',data=>body+=data);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});req.on('error',reject);req.end('{}');});assert.equal(denied.status,403);assert.equal(denied.body.error.code,'private_origin_denied');
 process.env.RIV_PRIVATE_HISTORY_FILE=file;
 let options=await fetch(origin+'/api/replays/sources');assert.equal(options.status,200);const choice=(await options.json()).items[0];assert.ok(choice.sourceToken);assert.equal(choice.canReplay,true);
 let res=await post('/api/replays',{customerRef:'fixture',itemRef:'fixture-refunded'});assert.equal(res.status,201);const s=await res.json();id=s.id;assert.equal(s.sourceItem.status,'Refund Completed');assert.equal(s.currentMerchantEligibility,null);
 res=await post(`/api/replays/${id}/prepare-voice`,{});assert.equal(res.status,201);receiptId=(await res.json()).receiptId;
 res=await post('/api/replay-voice-sessions',{receiptId});assert.equal(res.status,201);const voiceReplay=await res.json();assert.equal(voiceReplay.kind,'historical-replay');assert.equal(voiceReplay.source.items[0].orderStatus,'Refund Completed');assert.equal(voiceReplay.source.items[0].product,null);assert.equal(voiceReplay.currentMerchantEligibility,null);
 res=await post(`/api/sessions/${voiceReplay.id}/messages`,{text:'Pretend exchange'});assert.equal(res.status,409);res=await fetch(origin+`/api/sessions/${voiceReplay.id}`);assert.equal((await res.json()).kind,'historical-replay');
 res=await post('/api/replay-voice-sessions',{receiptId},{host:'attacker.example',origin:'http://attacker.example'});assert.equal(res.status,403);
 res=await post(`/api/replays/${id}/feedback`,{text:'I like the design, but the fabric feels heavy.'});assert.equal(res.status,200);
 res=await post(`/api/replays/${id}/alternatives`,{productRefs:['collection-swat-kats-dark-kat']});assert.equal(res.status,200);assert.equal((await res.json()).alternatives[0].stock,null);
 res=await post(`/api/replays/${id}/select`,{productRef:'collection-swat-kats-dark-kat',confirmed:true});assert.equal(res.status,200);const chosen=await res.json();assert.equal(chosen.selection.kind,'replay_selection');assert.equal(chosen.merchantActionExecuted,false);
 res=await fetch(origin+`/api/replays/${id}`);assert.equal((await res.json()).selection.recordId,chosen.selection.recordId);
 res=await post('/api/replays',{customerRef:'fixture',itemRef:'fixture-refunded'},{origin:'https://foreign.invalid'});assert.equal(res.status,403);
 res=await post('/api/replays',{customerRef:'fixture',itemRef:'fixture-refunded'},{'content-type':'text/plain'});assert.equal(res.status,415);
 process.env.RIV_PRIVATE_REPLAY_ENABLED='false';res=await fetch(origin+`/api/replays/${id}`);assert.equal(res.status,403);
 console.log('PASS private replay HTTP: opt-in localhost-only JSON, same-origin refusal, current feedback, sourced unknown-stock alternatives, actual app-owned selection persistence, disabled route refusal. Synthetic inputs; no merchant/provider calls.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(file,{force:true});if(receiptId)rmSync('.private/provider-replay-input/'+receiptId+'.json',{force:true});if(id)rmSync('.private/replays/'+id+'.json',{force:true});}
