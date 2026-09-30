// AssemblyAI expects mono PCM16, little-endian, at 24 kHz. Keep fractional
// positions across render quanta so 44.1 kHz devices do not drift or skip audio.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions || {};
    const inputRate = config.inputSampleRate || sampleRate;
    const targetRate = config.targetSampleRate || 24000;
    this.ratio = inputRate / targetRate;
    this.chunkSize = Math.round(targetRate * 0.02);
    this.chunk = new ArrayBuffer(this.chunkSize * 2);
    this.view = new DataView(this.chunk);
    this.written = 0;
    this.inputPosition = 0;
    this.outputPosition = 0;
    this.previous = 0;
    this.muted = false;
    this.running = true;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'stop') this.running = false;
      if (data?.type === 'mute') {
        this.muted = Boolean(data.muted);
        this.written = 0;
      }
    };
  }

  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    const start = this.inputPosition;
    const last = start + input.length - 1;
    if (this.muted) {
      this.outputPosition = last + 1;
    } else {
      while (this.outputPosition <= last) {
        const left = Math.floor(this.outputPosition);
        const fraction = this.outputPosition - left;
        // A fractional position at the boundary needs the next render quantum.
        if (left === last && fraction > 0) break;
        const index = left - start;
        const a = index < 0 ? this.previous : input[index];
        const b = fraction === 0 ? a : input[index + 1];
        const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction));
        const value = Math.round(sample * (sample < 0 ? 32768 : 32767));
        this.view.setInt16(this.written * 2, value, true);
        this.written += 1;
        if (this.written === this.chunkSize) {
          this.port.postMessage(this.chunk, [this.chunk]);
          this.chunk = new ArrayBuffer(this.chunkSize * 2);
          this.view = new DataView(this.chunk);
          this.written = 0;
        }
        this.outputPosition += this.ratio;
      }
    }
    this.previous = input[input.length - 1];
    this.inputPosition += input.length;
    // No output is written: the worklet's destination connection is silent.
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
