// Spanish pronunciation.
// Every word and example sentence has a natural recorded voice clip (generated offline, served with the app).
// Words also have a calmly slowed version. Anything without a clip falls back to the device's voice.
// Clips are packed into ~300 KB bundles (one card's clips sit in one bundle), listed in index.json.
type Accent = "latam" | "spain";
type ClipRef = [pack: number, offset: number, length: number];
type Index = Map<string, ClipRef>;

const DIRS: Record<Accent, string> = { latam: "mx", spain: "es" };
const indexes: Partial<Record<Accent, Promise<Index>>> = {};
const ready: Partial<Record<Accent, Index>> = {};
const builds: Partial<Record<Accent, string>> = {};

function loadIndex(accent: Accent): Promise<Index> {
  if (!indexes[accent]) {
    indexes[accent] = fetch(`/audio/${DIRS[accent]}/index.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { b?: string; clips?: Record<string, ClipRef> }) => {
        builds[accent] = d?.b ?? "";
        return new Map(Object.entries(d?.clips ?? {}));
      })
      .catch(() => new Map() as Index)
      .then((m) => (ready[accent] = m));
  }
  return indexes[accent]!;
}

// ---------- bundles: downloaded once, kept in memory (last ~40 used) ----------
const packs = new Map<string, Promise<ArrayBuffer | null>>();
const packData = new Map<string, ArrayBuffer>();

function loadPack(accent: Accent, n: number): Promise<ArrayBuffer | null> {
  const id = `${DIRS[accent]}/${n}`;
  let p = packs.get(id);
  if (!p) {
    p = fetch(`/audio/${DIRS[accent]}/p${String(n).padStart(3, "0")}.bin?b=${builds[accent] ?? ""}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null)
      .then((buf) => {
        if (buf && buf.byteLength > 0) {
          packData.set(id, buf);
          if (packData.size > 40) {
            const oldest = packData.keys().next().value!;
            packData.delete(oldest);
            packs.delete(oldest);
          }
        } else packs.delete(id);
        return buf;
      });
    packs.set(id, p);
  }
  return p;
}

let lastUrl: string | null = null;
function clipUrl(buf: ArrayBuffer, ref: ClipRef): string {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(new Blob([buf.slice(ref[1], ref[1] + ref[2])], { type: "audio/mpeg" }));
  return lastUrl;
}

/** Start downloading the clips for these texts (words or sentences) so a tap plays instantly. */
export function prefetchVoice(texts: string[], accent: Accent) {
  void loadIndex(accent).then((index) => {
    const want = new Set<number>();
    for (const t of texts) for (const f of forms(t)) {
      const ref = index.get(textKey(f));
      if (ref) want.add(ref[0]);
    }
    want.forEach((n) => void loadPack(accent, n));
  });
}

/** Same hash as the generator: FNV-1a over UTF-16 code units of the normalized text. */
export function textKey(text: string): string {
  const s = normalize(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const normalize = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
/** "el / la" → ["el", "la"], so each form is said on its own with a short pause. */
const forms = (text: string) => text.split("/").map(normalize).filter(Boolean);

// ---------- one shared audio element (iOS only lets an element play after a tap has "unlocked" it) ----------
let audio: HTMLAudioElement | null = null;
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

function el(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    const a = audio as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
    a.mozPreservesPitch = true;
  }
  return audio;
}

// touchend / click / keydown count as a "user gesture" on phones (pointerdown does not on iOS)
const GESTURES = ["touchend", "click", "keydown"] as const;
if (typeof document !== "undefined") {
  let unlocked = false;
  const unlock = () => {
    const a = el();
    if (!a || unlocked) return;
    const cleanup = () => {
      unlocked = true;
      GESTURES.forEach((e) => document.removeEventListener(e, unlock, true));
    };
    if (!a.paused) return cleanup();
    a.src = SILENT;
    a.play().then(cleanup, () => {});
  };
  GESTURES.forEach((e) => document.addEventListener(e, unlock, true));
}

let token = 0;

function playUrl(url: string, rate: number, my: number): Promise<boolean> {
  return new Promise((resolve) => {
    const a = el();
    if (!a || my !== token) return resolve(false);
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      a.onended = a.onerror = null;
      resolve(ok);
    };
    a.onended = () => done(true);
    a.onerror = () => done(false);
    a.src = url;
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;
    a.play().catch(() => done(false));
  });
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

// ---------- device voice fallback ----------
const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
// novelty voices that sound robotic or silly
const AVOID = /eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bad news|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|ralph|kathy/i;
const PREFERRED: Record<Accent, RegExp[]> = {
  spain: [/m[oó]nica.*(premium|enhanced|mejorad)/i, /m[oó]nica/i, /google español$/i, /elvira|alvaro|helena|laura|pablo/i, /marisol|jorge/i],
  latam: [/paulina.*(premium|enhanced|mejorad)/i, /paulina/i, /google español de estados unidos/i, /dalia|jorge|sabina|angélica|juan/i],
};

function pickVoice(accent: Accent): SpeechSynthesisVoice | undefined {
  const voices = (synth?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith("es") && !AVOID.test(v.name));
  if (!voices.length) return undefined;
  for (const re of PREFERRED[accent]) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  const wantSpain = accent === "spain";
  const byLang = voices.filter((v) => (v.lang.toLowerCase() === "es-es") === wantSpain);
  return byLang.find((v) => v.localService) ?? byLang[0] ?? voices[0];
}

function deviceSay(text: string, accent: Accent, slow: boolean, my: number): Promise<void> {
  return new Promise((resolve) => {
    if (!synth || my !== token) return resolve();
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(accent);
      if (v) u.voice = v;
      u.lang = v?.lang ?? (accent === "spain" ? "es-ES" : "es-MX");
      u.rate = slow ? 0.6 : 0.95;
      u.onend = u.onerror = () => resolve();
      synth.speak(u);
      window.setTimeout(resolve, 8000);
    } catch {
      resolve();
    }
  });
}

export const ttsAvailable = () => typeof window !== "undefined" && (typeof Audio !== "undefined" || !!synth);

export async function speak(text: string, accent: Accent = "latam", opts: { slow?: boolean } = {}) {
  const my = ++token;
  const slow = !!opts.slow;
  stopNow();
  const parts = forms(text);
  // when the clip list and bundle are already loaded, play right away (still inside the tap, which phones require)
  const index = ready[accent] ?? (await Promise.race([loadIndex(accent), wait(2000).then(() => new Map() as Index)]));
  for (let i = 0; i < parts.length; i++) {
    if (my !== token) return;
    if (i > 0) await wait(slow ? 650 : 420);
    if (my !== token) return;
    const k = textKey(parts[i]);
    const slowRef = slow ? index.get(`${k}s`) : undefined;
    const ref = slowRef ?? index.get(k);
    let ok = false;
    if (ref) {
      const id = `${DIRS[accent]}/${ref[0]}`;
      const buf = packData.get(id) ?? (await Promise.race([loadPack(accent, ref[0]), wait(6000).then(() => null)]));
      if (buf && my === token) ok = await playUrl(clipUrl(buf, ref), slow && !slowRef ? 0.72 : 1, my);
    }
    if (!ok && my === token) await deviceSay(parts[i], accent, slow, my);
  }
}

function stopNow() {
  try {
    if (audio && !audio.paused) audio.pause();
  } catch {
    /* ignore */
  }
  try {
    synth?.cancel();
  } catch {
    /* ignore */
  }
}

export function stopSpeaking() {
  token++;
  stopNow();
}

/** Warm up the list of recorded clips so the first tap plays instantly. */
export function preloadVoice(accent: Accent) {
  void loadIndex(accent);
}
