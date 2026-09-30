const PCM_RATE = 24000;
const MAX_CLIENT_DURATION_SECONDS = 180;

function voiceError(message, code = 'voice_error') {
  return Object.assign(new Error(message), { code });
}

function emit(callback, value) {
  // Rendering failures must not prevent microphone cleanup.
  try { callback?.(value); } catch { console.warn('Voice UI callback failed'); }
}

async function requestJson(path, body, signal) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  });
  const data = await response.json();
  if (!response.ok) {
    throw voiceError(data.error?.message || 'The voice request failed.', data.error?.code || 'request_failed');
  }
  return data;
}

function encodePCM(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodePCM(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 2_000_000) {
    throw voiceError('The voice service sent invalid audio.', 'invalid_audio');
  }
  const binary = atob(encoded);
  if (binary.length % 2 !== 0) throw voiceError('The voice service sent invalid audio.', 'invalid_audio');
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    const word = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    samples[i] = (word >= 32768 ? word - 65536 : word) / 32768;
  }
  return samples;
}

/**
 * Live AssemblyAI client through the app's same-origin WebSocket proxy.
 * Constructing it never requests microphone access or a connection ticket.
 * Call start() directly from the explicit Start voice button's click handler.
 * capabilities must be the backend's current bootstrap capabilities object.
 *
 * start(): Promise<status>, resolves only on session.ready.
 * stop(reason?): Promise<void>, releases mic immediately and ends the session.
 * mute(boolean?): boolean, toggles when omitted. destroy(): Promise<void>.
 * getStatus(): {status, mode:'live', muted, reason?}.
 *
 * onTranscript({role:'user'|'assistant',text,final,itemId,interrupted}) uses
 * replacement text for partials; never append the entire partial repeatedly.
 * onTool({phase,callId,name,result?,error?}), onSession(backendSnapshot),
 * onError(Error with code), and onStatus(status) are optional callbacks.
 * Demo text conversations belong to the app and never use this client.
 */
export function createVoiceClient({
  sessionId, capabilities, onStatus, onTranscript, onTool, onError, onSession,
  inputMode = "microphone", onTimeline,
}) {
  let current = null;
  let destroyed = false;
  if (!["microphone", "test-audio"].includes(inputMode)) throw voiceError('Unknown audio input mode.', 'invalid_input_mode');
  const timeline = [];
  let observationStart;
  function observe(type, detail = {}) {
    const event = { type, observedAt: new Date().toISOString(), elapsedMs: observationStart === undefined ? 0 : performance.now() - observationStart, inputMode, ...detail };
    timeline.push(event); if (timeline.length > 10000) timeline.shift(); emit(onTimeline, event);
  }
  let status = { status: 'idle', mode: 'live', muted: false };

  function update(next, extra = {}) {
    status = { status: next, mode: 'live', inputMode, ready: current?.ready || false, muted: current?.muted || false, ...extra };
    observe('status', { status: next, ready: status.ready });
    emit(onStatus, { ...status });
  }

  function isCurrent(run) { return current === run && !run.closed; }

  function send(run, message) {
    if (run.socket?.readyState === 1) {
      try {
        run.socket.send(JSON.stringify(message));
        return true;
      } catch { return false; }
    }
    return false;
  }

  function stopPlayback(run) {
    for (const source of run.playback) {
      source.onended = null;
      try { source.stop(); } catch { /* A source may already have ended. */ }
      source.disconnect();
    }
    run.playback.clear();
    run.playbackTime = run.context?.currentTime || 0;
  }

  function releaseAudio(run) {
    stopPlayback(run);
    run.stream?.getTracks().forEach(track => track.stop());
    run.stream = null;
    if (run.worklet) {
      run.worklet.port.onmessage = null;
      run.worklet.port.postMessage({ type: 'stop' });
      run.worklet.disconnect();
      run.worklet.port.close();
      run.worklet = null;
    }
    run.source?.disconnect();
    run.source = null;
    const context = run.context;
    run.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  function discardTools(run) {
    for (const tool of run.tools.values()) {
      emit(onTool, { phase: 'discarded', callId: tool.callId, name: tool.name });
    }
    run.tools.clear();
  }

  function releaseReservation(run, useBeacon = false) {
    if (!run.reserved || run.reservationReleased) return;
    run.reservationReleased = true;
    const body = JSON.stringify({ sessionId });
    if (useBeacon && navigator.sendBeacon?.('/api/voice-end', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/voice-end', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body,
    }).catch(() => {});
  }

  function finish(run, reason = 'ended') {
    if (run.closed) return;
    run.closed = true;
    for (const timer of [run.connectionTimer, run.durationTimer, run.idleTimer, run.endTimer]) clearTimeout(timer);
    run.startController.abort();
    discardTools(run);
    releaseAudio(run);
    window.removeEventListener('pagehide', run.pagehide);
    if (run.socket && run.socket.readyState < 2) run.socket.close(1000, 'Voice session ended');
    releaseReservation(run);
    run.rejectReady(voiceError('The voice session ended before it was ready.', 'session_ended'));
    if (current === run) {
      current = null;
      if (!run.failed) update('ended', { reason });
    }
    run.resolveStopped();
  }

  function end(run, reason = 'user') {
    if (run.closed || run.stopping) return run.stopped;
    run.stopping = true;
    run.endReason = reason;
    clearTimeout(run.connectionTimer);
    clearTimeout(run.durationTimer);
    clearTimeout(run.idleTimer);
    run.startController.abort();
    releaseAudio(run);
    discardTools(run);
    if (!run.failed) update('stopping', { reason });
    if (send(run, { type: 'session.end' })) {
      // Do not leave the microphone on while waiting for provider acknowledgement.
      run.endTimer = setTimeout(() => finish(run, reason), 2000);
    } else {
      finish(run, reason);
    }
    return run.stopped;
  }

  function fail(run, error) {
    if (!isCurrent(run) || run.stopping) return;
    const normalized = error instanceof Error ? error : voiceError('Voice could not connect.');
    run.failed = true;
    run.rejectReady(normalized);
    update('error', { reason: normalized.message });
    emit(onError, normalized);
    void end(run, 'error');
  }

  function touch(run) {
    clearTimeout(run.idleTimer);
    run.idleTimer = setTimeout(() => void end(run, 'idle_timeout'), run.idleSeconds * 1000);
  }

  function play(run, data) {
    const samples = decodePCM(data);
    if (!samples.length || !run.context) return;
    const context = run.context;
    const when = Math.max(context.currentTime, run.playbackTime);
    if (when - context.currentTime > 20) {
      throw voiceError('Audio playback fell behind. Please start a new call.', 'playback_backlog');
    }
    // A 24 kHz AudioBuffer is resampled by the default-rate AudioContext.
    const buffer = context.createBuffer(1, samples.length, PCM_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    run.playback.add(source);
    source.onended = () => {
      run.playback.delete(source);
      source.disconnect();
      if (isCurrent(run) && !run.stopping && !run.playback.size && status.status === 'speaking') update('listening');
    };
    source.start(when);
    run.playbackTime = when + buffer.duration;
    update('speaking');
    touch(run);
  }

  function showTool(run, event) {
    if (typeof event.call_id !== 'string' || typeof event.name !== 'string') {
      throw voiceError('The voice service sent an invalid tool call.', 'invalid_tool_call');
    }
    if (run.seenCalls.has(event.call_id)) return;
    run.seenCalls.add(event.call_id);
    const tool = { callId: event.call_id, name: event.name };
    run.tools.set(tool.callId, tool);
    // Execution and confirmation gating happen on the proxy. These events only
    // update the UI; the browser never sends a tool.result or confirmation.
    emit(onTool, { phase: 'running', ...tool });
  }

  function transcript(run, event) {
    const role = event.type.startsWith('transcript.user') ? 'user' : 'assistant';
    const final = !event.type.endsWith('.delta');
    const itemId = event.item_id || event.reply_id;
    const keyId = itemId || (final ? `unidentified-${++run.unidentifiedTranscriptCount}` : `${role}-current`);
    const key = `${role}:${keyId}`;
    let text = event.text;
    if (role === 'assistant' && !final) {
      text = `${run.partials.get(key) || ''}${event.delta || ''}`;
      run.partials.set(key, text);
    }
    if (typeof text !== 'string') return;
    if (final && run.savedTranscripts.has(key)) return;
    emit(onTranscript, { role, text, final, itemId, interrupted: Boolean(event.interrupted) });
    if (!final) return;
    run.partials.delete(key);
    run.savedTranscripts.add(key);
    // The proxy persists actual finalized transcripts, including interruptions.
    touch(run);
  }

  function handleMessage(run, raw) {
    if (!isCurrent(run)) return;
    const event = JSON.parse(raw);
    if (event.type === 'session.ready') observe('session.ready', { providerSessionId: event.session_id });
    else if (event.type === 'reply.audio') observe('output.audio', { encodedBytes: typeof event.data === 'string' ? event.data.length : null });
    else if (event.type.startsWith('transcript.')) observe(event.type, { itemId: event.item_id || event.reply_id || null, interrupted: Boolean(event.interrupted) });
    else if (event.type === 'tool.call') observe('tool.call', { callId: event.call_id, name: event.name });
    else if (event.type === 'app.tool.result') observe('tool.result', { callId: event.callId, name: event.name, result: event.result, isError: event.isError });
    else if (event.type === 'app.tool.discarded') observe('tool.discarded', { callId: event.callId, operationOutcome: 'unknown' });
    else if (event.type === 'app.snapshot') observe('snapshot', { sessionId: event.snapshot?.id, phase: event.snapshot?.phase, pendingProposalId: event.snapshot?.pendingAction?.proposalId || null, resolutionId: event.snapshot?.resolution?.recordId || null, toolCount: event.snapshot?.tools?.length });
    if (event.type === 'session.ended') { finish(run, run.endReason || 'provider_ended'); return; }
    if (run.stopping) return;
    switch (event.type) {
      case 'session.ready':
        run.ready = true;
        clearTimeout(run.connectionTimer);
        update('listening');
        run.resolveReady({ ...status });
        touch(run);
        break;
      case 'input.speech.started':
        stopPlayback(run);
        update('listening');
        touch(run);
        break;
      case 'input.speech.stopped': update('thinking'); touch(run); break;
      case 'reply.started': update('thinking'); break;
      case 'reply.audio': play(run, event.data); break;
      case 'reply.done':
        if (event.status === 'interrupted') {
          stopPlayback(run);
          discardTools(run);
        }
        if (!run.playback.size) update('listening');
        break;
      case 'tool.call': showTool(run, event); break;
      case 'app.tool.result':
        run.tools.delete(event.callId);
        emit(onTool, { phase: event.isError ? 'error' : 'completed', callId: event.callId, name: event.name, result: event.result, error: event.isError ? event.result?.error : undefined });
        touch(run);
        break;
      case 'app.tool.discarded':
        run.tools.delete(event.callId);
        emit(onTool, { phase: 'discarded', callId: event.callId, name: event.name });
        break;
      case 'app.snapshot':
        if (event.snapshot && typeof event.snapshot === 'object') emit(onSession, event.snapshot);
        break;
      case 'transcript.user.delta': case 'transcript.user':
      case 'transcript.agent.delta': case 'transcript.agent': transcript(run, event); break;
      case 'session.error': case 'error':
        fail(run, voiceError(event.message || 'The voice service reported an error.', event.code));
        break;
      default: break;
    }
  }

  async function connect(run) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.isSecureContext || (inputMode === "microphone" && (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode))) {
      throw voiceError('Live voice needs a secure browser with microphone and AudioWorklet support.', 'unsupported_browser');
    }
    // Both calls start before any await, preserving the Start button's gesture.
    run.context = new AudioContextClass();
    const resumed = run.context.resume();
    const permission = inputMode === "test-audio" ? Promise.resolve(null) : navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } });
    // Observe resume rejection immediately while the microphone prompt is open.
    void resumed.catch(() => {});
    const stream = await permission;
    if (!isCurrent(run) || run.stopping) { stream?.getTracks().forEach(track => track.stop()); return; }
    run.stream = stream;
    stream?.getAudioTracks().forEach(track => { track.enabled = !run.muted; });
    await resumed;
    if (inputMode === "microphone") {
    await run.context.audioWorklet.addModule(new URL('./pcm-processor.js', import.meta.url));
    if (!isCurrent(run) || run.stopping) return;
    run.source = run.context.createMediaStreamSource(stream);
    run.worklet = new AudioWorkletNode(run.context, 'pcm-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { inputSampleRate: run.context.sampleRate, targetSampleRate: PCM_RATE },
    });
    run.worklet.port.postMessage({ type: 'mute', muted: run.muted });
    run.worklet.port.onmessage = ({ data }) => {
      if (!isCurrent(run) || run.stopping || !run.ready || run.muted) return;
      if (run.socket?.bufferedAmount > 256_000) {
        fail(run, voiceError('The network is too slow for live audio. Please start a new call.', 'network_backlog'));
        return;
      }
      try { transmitPCM(run, data); } catch (error) { fail(run, error); }
    };
    run.source.connect(run.worklet).connect(run.context.destination);
    }
    update('connecting');
    const connection = await requestJson('/api/voice-token', { sessionId }, run.startController.signal);
    run.reserved = true;
    if (!isCurrent(run) || run.stopping) { releaseReservation(run); return; }
    if (typeof connection.websocketUrl !== 'string' || !connection.websocketUrl || connection.proxyManagedTools !== true) {
      throw voiceError('The server returned incomplete voice configuration.', 'invalid_configuration');
    }
    const url = new URL(connection.websocketUrl, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== '/api/voice/ws' || url.username || url.password || url.hash) {
      throw voiceError('The server returned an invalid voice proxy address.', 'invalid_configuration');
    }
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const duration = Number(connection.maxDurationSeconds);
    const idle = Number(connection.idleTimeoutSeconds);
    if (!Number.isFinite(duration) || duration < 1 || !Number.isFinite(idle) || idle < 1) {
      throw voiceError('The server did not provide voice usage limits.', 'missing_usage_limits');
    }
    run.idleSeconds = Math.min(idle, 120);
    run.durationTimer = setTimeout(() => void end(run, 'duration_limit'), Math.min(duration, MAX_CLIENT_DURATION_SECONDS) * 1000);
    run.socket = new WebSocket(url);
    // The server sends its fixed session.update upstream. The browser receives
    // no provider token and cannot change model, prompt, voice, or tool config.
    run.socket.addEventListener('message', ({ data }) => {
      try { handleMessage(run, data); } catch (error) { fail(run, error); }
    });
    run.socket.addEventListener('error', () => fail(run, voiceError('Could not connect to the voice service.', 'connection_failed')));
    run.socket.addEventListener('close', () => {
      if (!isCurrent(run)) return;
      if (!run.stopping) fail(run, voiceError('The voice connection closed. Start a new call to reconnect.', 'connection_closed'));
      finish(run, run.endReason || 'connection_closed');
    });
  }

  function start() {
    if (destroyed) return Promise.reject(voiceError('This voice client has been closed.', 'client_destroyed'));
    if (current) return current.stopping ? Promise.reject(voiceError('The previous call is still ending.', 'session_stopping')) : current.readyPromise;
    if (!sessionId || capabilities?.voice?.status !== 'ready') {
      const error = voiceError(capabilities?.voice?.reason || 'Live voice is not enabled. You can use the text demo.', 'voice_unavailable');
      update('error', { reason: error.message });
      emit(onError, error);
      return Promise.reject(error);
    }
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      const error = voiceError('Use the Start voice button to enable the microphone.', 'user_gesture_required');
      emit(onError, error);
      return Promise.reject(error);
    }
    const run = {
      muted: false, closed: false, stopping: false, ready: false, failed: false,
      playback: new Set(), playbackTime: 0, tools: new Map(), seenCalls: new Set(),
      partials: new Map(), savedTranscripts: new Set(), unidentifiedTranscriptCount: 0,
      startController: new AbortController(), idleSeconds: 30,
    };
    run.readyPromise = new Promise((resolve, reject) => { run.resolveReady = resolve; run.rejectReady = reject; });
    run.stopped = new Promise(resolve => { run.resolveStopped = resolve; });
    run.pagehide = () => {
      send(run, { type: 'session.end' });
      releaseReservation(run, true);
      finish(run, 'navigation');
    };
    current = run;
    observationStart = performance.now();
    observe('input.mode', { automatedAudioInjection: inputMode === 'test-audio', physicalMicrophoneTest: inputMode === 'microphone' });
    update(inputMode === 'test-audio' ? 'starting' : 'requesting-microphone');
    window.addEventListener('pagehide', run.pagehide);
    run.connectionTimer = setTimeout(() => fail(run, voiceError('Voice setup timed out. Please try again.', 'connection_timeout')), 30000);
    void connect(run).catch(error => {
      if (error.name === 'NotAllowedError') fail(run, voiceError('Microphone access was denied. You can use the text demo or allow the microphone and retry.', 'microphone_denied'));
      else fail(run, error);
    });
    return run.readyPromise;
  }

  function transmitPCM(run, data) {
    if (!isCurrent(run) || run.stopping || !run.ready || run.muted) return false;
    if (run.socket?.bufferedAmount > 256_000) throw voiceError('Audio network backlog.', 'network_backlog');
    const sent = send(run, { type: 'input.audio', audio: encodePCM(data) });
    if (sent) observe('input.audio', { bytes: data.byteLength, encoding: 'pcm16le', sampleRate: PCM_RATE, channels: 1 });
    return sent;
  }
  async function injectTestAudio(pcm, { sampleRate = PCM_RATE, channels = 1 } = {}) {
    const run = current;
    if (inputMode !== 'test-audio') throw voiceError('Enable labeled test-audio mode first.', 'test_input_disabled');
    if (!run?.ready || run.stopping) throw voiceError('Wait for session.ready before injecting audio.', 'session_not_ready');
    if (sampleRate !== PCM_RATE || channels !== 1 || !(pcm instanceof ArrayBuffer) || pcm.byteLength % 2 || pcm.byteLength === 0 || pcm.byteLength > PCM_RATE * 2 * MAX_CLIENT_DURATION_SECONDS) throw voiceError('Expected PCM16 little-endian mono 24 kHz, at most 180 seconds.', 'invalid_test_audio');
    if (run.injecting) throw voiceError('A test clip is already playing.', 'test_audio_busy');
    run.injecting = true;
    try {
      for (let offset = 0; offset < pcm.byteLength; offset += 960) {
        if (!isCurrent(run) || run.stopping) break;
        const chunk = pcm.slice(offset, offset + 960);
        if (!transmitPCM(run, chunk)) throw voiceError('Test audio was not sent.', 'test_audio_not_sent');
        await new Promise(resolve => setTimeout(resolve, chunk.byteLength / 2 / PCM_RATE * 1000));
      }
    } finally { run.injecting = false; }
  }
  function mute(value) {
    if (!current || current.stopping) return false;
    current.muted = value === undefined ? !current.muted : Boolean(value);
    current.stream?.getAudioTracks().forEach(track => { track.enabled = !current.muted; });
    current.worklet?.port.postMessage({ type: 'mute', muted: current.muted });
    update(status.status);
    return current.muted;
  }

  return {
    start,
    injectTestAudio,
    getTimeline: () => timeline.map(event => ({ ...event })),
    stop: (reason = 'user') => current ? end(current, reason) : Promise.resolve(),
    mute,
    destroy: () => { destroyed = true; return current ? end(current, 'destroyed') : Promise.resolve(); },
    getStatus: () => ({ ...status }),
  };
}
