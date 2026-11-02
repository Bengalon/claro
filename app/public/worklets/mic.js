// Converts microphone audio to 16 kHz 16-bit PCM chunks (~100 ms) for the voice tutor.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.acc = 0;
    this.cnt = 0;
    this.chunk = new Int16Array(1600);
    this.n = 0;
    this.sumSq = 0;
    this.levelCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      this.sumSq += s * s;
      this.levelCount++;
      this.acc += s;
      this.cnt++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        let v = this.acc / this.cnt;
        this.acc = 0;
        this.cnt = 0;
        if (v > 1) v = 1;
        else if (v < -1) v = -1;
        this.chunk[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.n === this.chunk.length) {
          const level = Math.sqrt(this.sumSq / Math.max(1, this.levelCount));
          this.port.postMessage({ pcm: this.chunk.buffer, level }, [this.chunk.buffer]);
          this.chunk = new Int16Array(1600);
          this.n = 0;
          this.sumSq = 0;
          this.levelCount = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
