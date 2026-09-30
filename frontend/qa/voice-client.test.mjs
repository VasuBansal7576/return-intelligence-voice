import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createVoiceClient } from '../voice-client.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const capabilities = { voice: { status: 'ready' } };
const response = data => ({ ok: true, json: async () => data });

function setup({ micPending = false, toolPending = false, connectionOverrides = {}, inputMode = "microphone" } = {}) {
  const sockets = [], contexts = [], worklets = [], requests = [], events = [];
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let grantMic, finishTool;
  class Socket extends EventTarget {
    constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    receive(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  }
  class Context {
    constructor(options) { assert.equal(options, undefined); this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {}; this.sources = []; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect: node => node, disconnect() {} }; }
    createBuffer(channels, length, rate) { assert.equal(rate, 24000); return { duration: length / rate, copyToChannel() {} }; }
    createBufferSource() { const source = { connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; } }; this.sources.push(source); return source; }
  }
  class Worklet {
    constructor(context, name, config) { assert.equal(config.processorOptions.inputSampleRate, 44100); this.port = { postMessage: value => events.push(value), close() {} }; worklets.push(this); }
    connect() { return this; }
    disconnect() {}
  }
  const windowMock = new EventTarget();
  Object.assign(windowMock, { AudioContext: Context, AudioWorkletNode: Worklet, isSecureContext: true, location: new URL('http://localhost:3000/') });
  globalThis.window = windowMock;
  globalThis.AudioWorkletNode = Worklet;
  globalThis.WebSocket = Socket;
  let micCalls = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: options => {
    micCalls++;
    assert.equal(options.audio.echoCancellation, true);
    assert.equal(options.audio.noiseSuppression, false);
    return micPending ? new Promise(resolve => { grantMic = () => resolve(stream); }) : Promise.resolve(stream);
  } } } });
  globalThis.fetch = async (path, options) => {
    const body = JSON.parse(options.body);
    requests.push({ path, body });
    if (path === '/api/voice-token') return response({ websocketUrl: '/api/voice/ws?sessionId=session-1&ticket=local-test-ticket', maxDurationSeconds: 180, idleTimeoutSeconds: 30, proxyManagedTools: true, ...connectionOverrides });
    if (path.endsWith('/tools')) {
      const data = { result: { requiresConfirmation: true, proposalId: 'proposal-1' }, snapshot: { id: 'session-1', pendingResolution: {} } };
      return toolPending ? new Promise(resolve => { finishTool = () => resolve(response(data)); }) : response(data);
    }
    if (path.endsWith('/transcript')) return response({ snapshot: { id: 'session-1' } });
    if (path === '/api/voice-end') return response({ ok: true });
    throw new Error(`Unexpected request: ${path}`);
  };
  const statuses = [], transcripts = [], tools = [], errors = [], snapshots = [], timeline = [];
  const client = createVoiceClient({ sessionId: 'session-1', capabilities, inputMode, onTimeline: value => timeline.push(value), onStatus: value => statuses.push(value), onTranscript: value => transcripts.push(value), onTool: value => tools.push(value), onError: value => errors.push(value), onSession: value => snapshots.push(value) });
  return { client, sockets, contexts, worklets, track, requests, statuses, transcripts, tools, errors, snapshots, timeline, windowMock, micCalls: () => micCalls, grantMic: () => grantMic(), finishTool: () => finishTool() };
}
async function startReady(env) {
  const ready = env.client.start();
  await tick();
  env.sockets[0].open();
  assert.equal(env.sockets[0].sent.length, 0);
  assert.equal(env.sockets[0].url.origin, 'ws://localhost:3000');
  assert.equal(env.sockets[0].url.pathname, '/api/voice/ws');
  env.sockets[0].receive({ type: 'session.ready', session_id: 'provider-session' });
  await ready;
  return env.sockets[0];
}
async function close(env) {
  const stopped = env.client.stop();
  env.sockets[0]?.receive({ type: 'session.ended' });
  await stopped;
}

test('disabled capability never requests microphone, audio context, token, or socket', async () => {
  const env = setup();
  const client = createVoiceClient({ sessionId: 'session-1', capabilities: { voice: { status: 'unconfigured' } } });
  await assert.rejects(client.start(), { code: 'voice_unavailable' });
  assert.equal(env.micCalls(), 0);
  assert.equal(env.contexts.length, 0);
  assert.equal(env.requests.length, 0);
  assert.equal(env.sockets.length, 0);
});

test('start is idempotent, captures 24k PCM after ready, mute controls capture, ends cleanly', async () => {
  const env = setup();
  assert.equal(env.micCalls(), 0);
  const ready = env.client.start();
  assert.equal(env.client.start(), ready);
  await tick();
  const socket = env.sockets[0];
  env.worklets[0].port.onmessage({ data: new Int16Array([1, -1]).buffer });
  assert.equal(socket.sent.length, 0);
  socket.open();
  socket.receive({ type: 'session.ready' });
  await ready;
  env.worklets[0].port.onmessage({ data: new Int16Array([1, -1]).buffer });
  assert.equal(socket.sent.at(-1).type, 'input.audio');
  assert.equal(socket.sent.at(-1).audio, 'AQD//w==');
  assert.equal(env.client.mute(), true);
  assert.equal(env.track.enabled, false);
  const count = socket.sent.length;
  env.worklets[0].port.onmessage({ data: new Int16Array([1]).buffer });
  assert.equal(socket.sent.length, count);
  assert.equal(env.client.mute(), false);
  assert.equal(env.track.enabled, true);
  const stopped = env.client.stop();
  assert.equal(env.track.stopped, true);
  assert.equal(env.contexts[0].state, 'closed');
  assert.equal(socket.sent.at(-1).type, 'session.end');
  socket.receive({ type: 'session.ended' });
  await stopped;
  assert.equal(socket.readyState, 3);
  assert.equal(env.client.getStatus().status, 'ended');
  assert.equal(env.requests.filter(value => value.path === '/api/voice-end').length, 1);
});

test('barge-in stops all scheduled audio sources and resets playback schedule', async () => {
  const env = setup();
  const socket = await startReady(env);
  socket.receive({ type: 'reply.audio', data: 'AQD//w==' });
  socket.receive({ type: 'reply.audio', data: 'AQD//w==' });
  assert.equal(env.contexts[0].sources.length, 2);
  socket.receive({ type: 'input.speech.started' });
  assert(env.contexts[0].sources.every(source => source.stopped));
  socket.receive({ type: 'reply.audio', data: 'AQD//w==' });
  assert.equal(env.contexts[0].sources[2].time, 0);
  socket.receive({ type: 'reply.done', status: 'interrupted' });
  assert.equal(env.contexts[0].sources[2].stopped, true);
  await close(env);
});

test('proxy owns tools and confirmation; browser only displays tool events and snapshots', async () => {
  const env = setup();
  const socket = await startReady(env);
  socket.receive({ type: 'tool.call', call_id: 'call-1', name: 'request_resolution', arguments: { kind: 'refund' } });
  await tick();
  assert.equal(env.requests.some(value => value.path.endsWith('/tools')), false);
  assert.equal(env.tools.at(-1).phase, 'running');
  socket.receive({ type: 'reply.done', status: 'completed' });
  assert.equal(socket.sent.some(event => event.type === 'tool.result'), false);
  socket.receive({ type: 'app.tool.result', callId: 'call-1', name: 'request_resolution', result: { requiresConfirmation: true, proposalId: 'p1' } });
  assert.equal(env.tools.at(-1).phase, 'completed');
  socket.receive({ type: 'app.snapshot', snapshot: { id: 'session-1', pendingResolution: { proposalId: 'p1' } } });
  assert.equal(env.snapshots.at(-1).pendingResolution.proposalId, 'p1');
  assert.equal(socket.sent.some(event => ['session.update', 'tool.result'].includes(event.type)), false);
  await close(env);
});

test('interrupted tools are discarded in UI and never run on the browser', async () => {
  const env = setup();
  const socket = await startReady(env);
  socket.receive({ type: 'tool.call', call_id: 'call-2', name: 'check_inventory', arguments: {} });
  socket.receive({ type: 'reply.done', status: 'interrupted' });
  assert(env.tools.some(event => event.phase === 'discarded'));
  socket.receive({ type: 'reply.done', status: 'completed' });
  assert.equal(socket.sent.some(event => event.type === 'tool.result'), false);
  assert.equal(env.requests.some(value => value.path.endsWith('/tools')), false);
  await close(env);
});

test('partial transcripts replace text; final transcript display is deduplicated; proxy owns persistence', async () => {
  const env = setup();
  const socket = await startReady(env);
  socket.receive({ type: 'transcript.user.delta', item_id: 'u1', text: 'I want' });
  socket.receive({ type: 'transcript.user.delta', item_id: 'u1', text: 'I want a refund' });
  socket.receive({ type: 'transcript.user', item_id: 'u1', text: 'I want a refund.' });
  socket.receive({ type: 'transcript.user', item_id: 'u1', text: 'I want a refund.' });
  socket.receive({ type: 'transcript.agent', item_id: 'a1', text: 'I can help.', interrupted: true });
  await tick();
  assert.equal(env.requests.some(value => value.path.endsWith('/transcript')), false);
  assert.equal(env.transcripts.length, 4);
  assert.equal(env.transcripts[1].text, 'I want a refund');
  assert.equal(env.transcripts[3].role, 'assistant');
  assert.equal(env.transcripts[3].interrupted, true);
  await close(env);
});

test('stopping while mic permission is pending closes context and stops a late-granted stream', async () => {
  const env = setup({ micPending: true });
  const ready = env.client.start();
  const rejected = assert.rejects(ready, { code: 'session_ended' });
  await env.client.stop();
  env.grantMic();
  await tick();
  await rejected;
  assert.equal(env.track.stopped, true);
  assert.equal(env.contexts[0].state, 'closed');
  assert.equal(env.requests.length, 0);
});

test('pagehide sends session.end synchronously and releases the microphone', async () => {
  const env = setup();
  const socket = await startReady(env);
  env.windowMock.dispatchEvent(new Event('pagehide'));
  assert.equal(socket.sent.at(-1).type, 'session.end');
  assert.equal(env.track.stopped, true);
  assert.equal(socket.readyState, 3);
  assert.equal(env.requests.filter(value => value.path === '/api/voice-end').length, 1);
});

test('resampler preserves a full second at 48k and 44.1k, posts little-endian 20ms chunks', async () => {
  const code = await readFile(new URL('../pcm-processor.js', import.meta.url), 'utf8');
  for (const inputRate of [48000, 44100, 24000, 16000]) {
    let Processor;
    const chunks = [];
    const context = vm.createContext({ AudioWorkletProcessor: class { constructor() { this.port = { postMessage: buffer => chunks.push(new Uint8Array(buffer).slice().buffer) }; } }, sampleRate: inputRate, registerProcessor: (_, klass) => { Processor = klass; } });
    vm.runInContext(code, context);
    const processor = new Processor({ processorOptions: { inputSampleRate: inputRate, targetSampleRate: 24000 } });
    const input = new Float32Array(inputRate);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(2 * Math.PI * 220 * i / inputRate) * 0.5;
    for (let start = 0; start < input.length; start += 128) processor.process([[input.slice(start, start + 128)]]);
    // Upsampling needs the next interpolation sample to emit the last chunk.
    processor.process([[new Float32Array([0, 0])]]);
    assert.equal(chunks.length, 50, `${inputRate} produced ${chunks.length} chunks`);
    for (const chunk of chunks) assert.equal(chunk.byteLength, 960);
    for (let i = 0; i < 24000; i++) {
      const actual = new DataView(chunks[Math.floor(i / 480)]).getInt16((i % 480) * 2, true);
      const expected = Math.sin(2 * Math.PI * 220 * i / 24000) * 0.5 * 32767;
      assert(Math.abs(actual - expected) < 17, `sample ${i} at ${inputRate}: ${actual} vs ${expected}`);
    }
    const beforeMute = chunks.length;
    processor.port.onmessage({ data: { type: 'mute', muted: true } });
    for (let i = 0; i < 100; i++) processor.process([[new Float32Array(128).fill(1)]]);
    assert.equal(chunks.length, beforeMute);
    processor.port.onmessage({ data: { type: 'stop' } });
    assert.equal(processor.process([[new Float32Array(128)]]), false);
  }
});


test('refuses cross-origin WebSocket URLs and unmanaged tool execution', async () => {
  for (const connectionOverrides of [{ websocketUrl: 'https://foreign.example/api/voice/ws?ticket=x' }, { proxyManagedTools: false }]) {
    const env = setup({ connectionOverrides });
    await assert.rejects(env.client.start(), { code: 'invalid_configuration' });
    assert.equal(env.sockets.length, 0);
    assert.equal(env.track.stopped, true);
    assert.equal(env.contexts[0].state, 'closed');
    assert.equal(env.requests.filter(value => value.path === '/api/voice-end').length, 1);
  }
});

test('an explicit active user gesture is required when the browser exposes activation state', async () => {
  const env = setup();
  navigator.userActivation = { isActive: false };
  await assert.rejects(env.client.start(), { code: 'user_gesture_required' });
  assert.equal(env.micCalls(), 0);
  assert.equal(env.requests.length, 0);
});

test('duration and silence caps end the call without waiting for provider audio', async () => {
  const nativeSet = globalThis.setTimeout;
  const nativeClear = globalThis.clearTimeout;
  for (const reason of ['duration_limit', 'idle_timeout']) {
    const scheduled = [];
    globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, cancelled: false }; scheduled.push(timer); return timer; };
    globalThis.clearTimeout = timer => { if (timer) timer.cancelled = true; };
    try {
      const env = setup();
      const socket = await startReady(env);
      const ms = reason === 'duration_limit' ? 180000 : 30000;
      const timer = scheduled.find(value => value.ms === ms && !value.cancelled);
      assert(timer, `${reason} timer must exist`);
      timer.fn();
      assert.equal(env.track.stopped, true);
      assert.equal(socket.sent.at(-1).type, 'session.end');
      socket.receive({ type: 'session.ended' });
      assert.equal(env.client.getStatus().reason, reason);
      assert.equal(env.client.getStatus().status, 'ended');
    } finally {
      globalThis.setTimeout = nativeSet;
      globalThis.clearTimeout = nativeClear;
    }
  }
});

test('invalid audio and dropped connections clean up microphone and audio context', async () => {
  for (const failure of ['invalid_audio', 'connection_closed']) {
    const env = setup();
    const socket = await startReady(env);
    if (failure === 'invalid_audio') {
      socket.receive({ type: 'reply.audio', data: 'AQ==' });
      socket.receive({ type: 'session.ended' });
    } else socket.close();
    assert.equal(env.track.stopped, true);
    assert.equal(env.contexts[0].state, 'closed');
    assert.equal(env.errors.at(-1).code, failure);
    assert.equal(env.client.getStatus().status, 'error');
  }
});


test('labeled automated test audio uses same proxy after ready without a physical microphone', async () => {
 const env=setup({inputMode:'test-audio'});
 await assert.rejects(env.client.injectTestAudio(new ArrayBuffer(960)),{code:'session_not_ready'});
 const socket=await startReady(env);assert.equal(env.micCalls(),0);assert.equal(env.worklets.length,0);
 assert.equal(env.statuses[0].status,'starting');assert.equal(env.statuses[0].ready,false);
 await assert.rejects(env.client.injectTestAudio(new ArrayBuffer(960),{sampleRate:16000}),{code:'invalid_test_audio'});
 await env.client.injectTestAudio(new ArrayBuffer(960));
 assert.equal(socket.sent[0].type,'input.audio');assert.equal(atob(socket.sent[0].audio).length,960);
 socket.receive({type:'transcript.user',text:'Fixture feedback',item_id:'test-transcript'});
 socket.receive({type:'tool.call',call_id:'test-call',name:'get_order',arguments:{}});
 socket.receive({type:'app.tool.result',callId:'test-call',name:'get_order',result:{synthetic:true},isError:false});
 socket.receive({type:'app.snapshot',snapshot:{id:'session-1',phase:'RECOMMENDATION_FLOW',tools:[]}});
 socket.receive({type:'reply.audio',data:btoa(String.fromCharCode(0,0,0,0))});
 const timeline=env.client.getTimeline();assert.ok(timeline.some(e=>e.type==='session.ready'));assert.ok(timeline.some(e=>e.type==='input.audio'&&e.sampleRate===24000));assert.ok(timeline.some(e=>e.type==='output.audio'));assert.ok(timeline.some(e=>e.itemId==='test-transcript'));assert.ok(timeline.some(e=>e.type==='tool.result'&&e.callId==='test-call'));assert.ok(timeline.some(e=>e.type==='snapshot'));assert.ok(timeline.every(e=>e.inputMode==='test-audio'&&e.elapsedMs>=0));
 await close(env);
});
test('test-audio input does not bypass zero-budget capability gate', async()=>{
 const env=setup({inputMode:'test-audio'});const blocked=createVoiceClient({sessionId:'session-1',capabilities:{voice:{status:'unconfigured'}},inputMode:'test-audio'});
 await assert.rejects(blocked.start(),{code:'voice_unavailable'});assert.equal(env.requests.length,0);assert.equal(env.sockets.length,0);
});
