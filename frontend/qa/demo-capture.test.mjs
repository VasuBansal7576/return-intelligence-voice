import test from 'node:test';import assert from 'node:assert/strict';import {createDemoCapture} from '../demo-capture.js';
test('local capture preserves actual provider PCM, transcript IDs and observation metadata without network',async()=>{
 const capture=createDemoCapture();assert.throws(()=>capture.onOutputAudio({source:'canned',sampleRate:24000,channels:1,pcm16le:new ArrayBuffer(4)}));
 capture.onOutputAudio({source:'provider.reply.audio',sampleRate:24000,channels:1,pcm16le:new Uint8Array([1,0,255,255]).buffer});capture.onTranscript({role:'assistant',itemId:'genuine-provider-item',text:'Synthetic test words'});capture.onTimeline({type:'session.ready',elapsedMs:12});
 const files=capture.artifacts();const wav=await files.outputWav.arrayBuffer();assert.equal(new DataView(wav).getUint32(24,true),24000);assert.deepEqual([...new Uint8Array(wav).slice(44)],[1,0,255,255]);assert.equal(JSON.parse(await files.transcripts.text())[0].itemId,'genuine-provider-item');assert.equal(JSON.parse(await files.timeline.text()).physicalMicrophoneTest,false);assert.equal(JSON.parse(await files.timeline.text()).events[0].elapsedMs,12);
});
