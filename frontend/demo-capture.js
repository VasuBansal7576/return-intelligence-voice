/** Local recording only. No requests, uploads, microphone or provider connection. */
export function createDemoCapture({maxSeconds=180}={}) {
  if(maxSeconds!==180)throw new Error('Demo capture limit must be 180 seconds.');
  const chunks=[],transcripts=[],timeline=[];let bytes=0,truncated=false;
  return {
    onOutputAudio(event){
      if(event.source!=='provider.reply.audio'||event.sampleRate!==24000||event.channels!==1||!(event.pcm16le instanceof ArrayBuffer)||event.pcm16le.byteLength%2)throw new Error('Invalid provider PCM metadata.');
      if(bytes+event.pcm16le.byteLength>180*24000*2){truncated=true;return;}
      chunks.push(new Uint8Array(event.pcm16le.slice(0)));bytes+=event.pcm16le.byteLength;
    },
    onTranscript(event){transcripts.push({...event});},
    onTimeline(event){timeline.push({...event});},
    artifacts(){
      const wav=new ArrayBuffer(44+bytes),view=new DataView(wav);const label=(offset,text)=>{[...text].forEach((ch,i)=>view.setUint8(offset+i,ch.charCodeAt(0)));};
      label(0,'RIFF');view.setUint32(4,36+bytes,true);label(8,'WAVE');label(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);label(36,'data');view.setUint32(40,bytes,true);
      let offset=44;for(const chunk of chunks){new Uint8Array(wav,offset,chunk.length).set(chunk);offset+=chunk.length;}
      return {outputWav:new Blob([wav],{type:'audio/wav'}),transcripts:new Blob([JSON.stringify(transcripts)],{type:'application/json'}),timeline:new Blob([JSON.stringify({automatedCustomerInput:true,physicalMicrophoneTest:false,outputSource:'provider.reply.audio',outputTruncated:truncated,events:timeline})],{type:'application/json'})};
    },
  };
}
