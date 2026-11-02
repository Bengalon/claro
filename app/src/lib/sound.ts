// Small synthesized sound effects (no audio files). Respects the user's sound setting.
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", vol = 0.16) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const semis = (base: number, n: number) => base * Math.pow(2, n / 12);

export const sfx = {
  tap() {
    tone(880, 0, 0.06, "triangle", 0.05);
  },
  correct(combo = 0) {
    const shift = Math.min(combo, 10);
    const base = semis(784, shift); // G5 rising with the combo
    tone(base, 0, 0.16, "sine", 0.14);
    tone(semis(base, 4), 0.07, 0.22, "sine", 0.13);
    tone(semis(base, 7), 0.13, 0.3, "triangle", 0.07);
  },
  wrong() {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(260, t0);
    osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.22);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  },
  flip() {
    tone(520, 0, 0.08, "sine", 0.06);
    tone(780, 0.04, 0.1, "sine", 0.05);
  },
  complete() {
    [0, 4, 7, 12, 16].forEach((s, i) => tone(semis(523.25, s), i * 0.09, 0.4, "sine", 0.12));
    tone(semis(523.25, 24), 0.48, 0.6, "triangle", 0.06);
  },
  levelUp() {
    [0, 7, 12, 19, 24].forEach((s, i) => tone(semis(392, s), i * 0.07, 0.35, "triangle", 0.09));
  },
  pop() {
    tone(1200, 0, 0.05, "sine", 0.06);
  },
};

export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
