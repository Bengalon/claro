// Real-time voice conversation with the AI tutor (Gemini Live over WebSocket).
import { callFunction, supabase } from "./supabase";

export type TutorState = "connecting" | "listening" | "speaking" | "ended";
export interface TranscriptLine {
  id: number;
  who: "tutor" | "me";
  text: string;
  done: boolean;
}
export type StartError = "mic_denied" | "mic_missing" | "daily_limit" | "token" | "network" | "unsupported";
export type EndReason = "user" | "time" | "server" | "disconnected";

export interface TokenResponse {
  token: string;
  wsUrl: string;
  model: string;
  sessionId: string;
  grantedSeconds: number;
  remainingSeconds: number;
  allowanceSeconds: number;
  tutorName: string;
}

interface Callbacks {
  onState: (s: TutorState) => void;
  onTranscript: (lines: TranscriptLine[]) => void;
  onTick: (secondsLeft: number) => void;
  onEnd: (info: { seconds: number; reason: EndReason }) => void;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function pcm16ToFloat(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const len = bin.length >> 1;
  const out = new Float32Array(new ArrayBuffer(len * 4));
  for (let i = 0; i < len; i++) {
    const lo = bin.charCodeAt(i * 2);
    const hi = bin.charCodeAt(i * 2 + 1);
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

export class LiveTutor {
  private ctx: AudioContext;
  private cb: Callbacks;
  private stream: MediaStream | null = null;
  private micNode: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private outGain: GainNode;
  private analyser: AnalyserNode;
  private ws: WebSocket | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private lines: TranscriptLine[] = [];
  private lineId = 0;
  private startedAt = 0;
  private granted = 0;
  private tickTimer: number | null = null;
  private endSoonSent = false;
  private ending = false;
  private ended = false;
  private state: TutorState = "connecting";
  private wakeLock: { release: () => Promise<void> } | null = null;
  micLevel = 0;
  muted = false;
  halfDuplex = true;
  session: TokenResponse | null = null;

  constructor(ctx: AudioContext, cb: Callbacks) {
    this.ctx = ctx;
    this.cb = cb;
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.outGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  private setState(s: TutorState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState(s);
  }

  /** Output loudness 0..1 for the orb animation. */
  outputLevel(): number {
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }

  /** Still "speaking" for a short moment after the audio ends, so small network gaps don't flip the screen. */
  isPlaying() {
    return this.ctx.currentTime < this.nextTime + 0.7;
  }

  async start(body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: StartError; data?: unknown }> {
    if (!navigator.mediaDevices?.getUserMedia || !this.ctx.audioWorklet || !("WebSocket" in window)) {
      return { ok: false, error: "unsupported" };
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      return { ok: false, error: name === "NotFoundError" ? "mic_missing" : "mic_denied" };
    }

    try {
      await this.ctx.audioWorklet.addModule("/worklets/mic.js");
      this.micSource = this.ctx.createMediaStreamSource(this.stream);
      this.micNode = new AudioWorkletNode(this.ctx, "mic-processor");
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      this.micSource.connect(this.micNode);
      this.micNode.connect(this.sink).connect(this.ctx.destination);
      this.micNode.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => this.onMic(ev.data);
    } catch {
      this.cleanup();
      return { ok: false, error: "unsupported" };
    }

    const res = await callFunction<TokenResponse & { error?: string }>("live-token", body);
    if (!res.ok || !res.data?.token) {
      this.cleanup();
      if (res.status === 429) return { ok: false, error: "daily_limit", data: res.data };
      return { ok: false, error: res.status === 0 ? "network" : "token" };
    }
    this.session = res.data;
    this.granted = res.data.grantedSeconds;

    const opened = await this.connect(res.data);
    if (!opened) {
      void this.report(0);
      this.cleanup();
      return { ok: false, error: "network" };
    }
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      this.wakeLock = (await wl?.request("screen")) ?? null;
    } catch {
      this.wakeLock = null;
    }
    this.startedAt = performance.now();
    this.sendText("[START]");
    this.setState("listening");
    this.tickTimer = window.setInterval(() => this.tick(), 250);
    return { ok: true };
  }

  private connect(tok: TokenResponse): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      const ws = new WebSocket(`${tok.wsUrl}?access_token=${encodeURIComponent(tok.token)}`);
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        finish(false);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 15000);
      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: tok.model } }));
      ws.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg.setupComplete) {
          window.clearTimeout(timeout);
          finish(true);
          return;
        }
        this.onServer(msg);
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        finish(false);
      };
      ws.onclose = () => {
        window.clearTimeout(timeout);
        if (!settled) finish(false);
        else if (!this.ending && !this.ended) this.finish("disconnected");
      };
    });
  }

  private onMic(d: { pcm: ArrayBuffer; level: number }) {
    this.micLevel = d.level;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.ending || this.muted) return;
    if (this.halfDuplex && this.ctx.currentTime < this.nextTime + 0.35) return;
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(d.pcm), mimeType: "audio/pcm;rate=16000" } } }));
  }

  sendText(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ realtimeInput: { text } }));
  }

  private onServer(msg: Record<string, any>) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) this.stopPlayback();
      for (const part of sc.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data as string | undefined;
        if (data) {
          const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1]) || 24000;
          this.play(data, rate);
        }
      }
      if (sc.inputTranscription?.text) this.appendLine("me", sc.inputTranscription.text);
      if (sc.outputTranscription?.text) this.appendLine("tutor", sc.outputTranscription.text);
      if (sc.turnComplete || sc.interrupted) this.closeLine("tutor");
      return;
    }
    if (msg.goAway) {
      // Server is about to close the connection: let the current sentence finish, then end.
      this.ending = true;
      window.setTimeout(() => this.finish("server"), Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000) + 300);
    }
  }

  private play(b64: string, rate: number) {
    const samples = pcm16ToFloat(b64);
    if (!samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const now = this.ctx.currentTime;
    // Jitter buffer: when the queue ran dry (start of a turn, or a late packet on a phone network),
    // wait a little before playing so the following chunks arrive in time and the voice doesn't stutter.
    const underrun = this.nextTime < now + 0.03;
    const at = underrun ? now + (this.nextTime === 0 ? 0.32 : 0.22) : this.nextTime;
    if (underrun) {
      // soft start avoids a click when audio resumes
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + 0.012);
      src.connect(g).connect(this.outGain);
    } else {
      src.connect(this.outGain);
    }
    src.start(at);
    this.nextTime = at + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  private stopPlayback() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  private appendLine(who: "tutor" | "me", text: string) {
    let last = [...this.lines].reverse().find((l) => l.who === who && !l.done);
    if (who === "tutor") this.closeLine("me");
    if (who === "me") {
      const tutorOpen = this.lines.find((l) => l.who === "tutor" && !l.done);
      if (tutorOpen && !this.isPlaying()) tutorOpen.done = true;
    }
    if (!last) {
      last = { id: ++this.lineId, who, text: "", done: false };
      this.lines.push(last);
    }
    last.text = (last.text + text).replace(/\s+/g, " ").trimStart();
    this.lines = this.lines.slice(-40);
    this.cb.onTranscript(this.lines.map((l) => ({ ...l })));
  }

  private closeLine(who: "tutor" | "me") {
    let changed = false;
    for (const l of this.lines) {
      if (l.who === who && !l.done) {
        l.done = true;
        changed = true;
      }
    }
    if (changed) this.cb.onTranscript(this.lines.map((l) => ({ ...l })));
  }

  private elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  private tick() {
    if (this.ended) return;
    const left = Math.max(0, this.granted - this.elapsed());
    this.cb.onTick(left);
    if (!this.ending) this.setState(this.isPlaying() ? "speaking" : "listening");
    if (left <= 25 && !this.endSoonSent) {
      this.endSoonSent = true;
      this.sendText("[END_SOON]");
    }
    if (left <= 0 && !this.ending) {
      this.ending = true;
      const wait = Math.min(6000, Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000) + 400);
      window.setTimeout(() => this.finish("time"), wait);
    }
  }

  /** Asks the tutor for a short explanation in Hebrew. */
  askHelp() {
    this.sendText("[HELP]");
  }

  end() {
    if (this.ended) return;
    this.ending = true;
    this.finish("user");
  }

  private finish(reason: EndReason) {
    if (this.ended) return;
    this.ended = true;
    const seconds = Math.round(Math.min(this.granted, this.elapsed()));
    this.cleanup();
    this.setState("ended");
    void this.report(seconds);
    this.cb.onEnd({ seconds, reason });
  }

  private async report(seconds: number) {
    if (!this.session) return;
    await supabase
      .from("voice_sessions")
      .update({ used_seconds: seconds, ended_at: new Date().toISOString() })
      .eq("id", this.session.sessionId);
  }

  private cleanup() {
    if (this.tickTimer) window.clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.stopPlayback();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    try {
      this.micNode?.port.close();
      this.micSource?.disconnect();
      this.micNode?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }
}
