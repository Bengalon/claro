import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { supabase } from "../lib/supabase";
import { LiveTutor, type EndReason, type StartError, type TranscriptLine, type TutorState } from "../lib/live";
import { isKnown } from "../lib/srs";
import { g, minutesLabel, sample, startOfLocalDay } from "../lib/util";
import { sfx } from "../lib/sound";
import { toast } from "../lib/toast";
import { Orb, type OrbMode } from "../components/Orb";
import { Emoji3D } from "../components/Emoji3D";
import { celebrate, CountUp } from "../components/ui";
import { IconHelp, IconMic, IconMicOff, IconPhoneOff } from "../components/Icons";

const MODES = [
  { id: "free", emoji: "💬", title: "שיחה חופשית", sub: "על היום שלך, תחביבים, תוכניות" },
  { id: "words", emoji: "🧠", title: "המילים שלמדתי", sub: "שיחה שמשלבת את המילים החדשות" },
  { id: "meet", emoji: "🎉", title: "היכרות במסיבה", sub: "להציג את עצמך ולשאול שאלות" },
  { id: "cafe", emoji: "☕", title: "בבית קפה", sub: "להזמין, לשאול מחיר, לשלם" },
  { id: "restaurant", emoji: "🍽️", title: "במסעדה", sub: "תפריט, הזמנה וחשבון" },
  { id: "directions", emoji: "🗺️", title: "לשאול דרך", sub: "תייר/ת שהלך/ה לאיבוד" },
  { id: "shopping", emoji: "🛍️", title: "קניות", sub: "מידות, צבעים ומחירים" },
  { id: "plans", emoji: "📅", title: "תוכניות לסופ״ש", sub: "לקבוע עם חבר/ה" },
];

interface DoneInfo {
  seconds: number;
  reason: EndReason;
  xp: number;
}

export default function Talk() {
  const { profile, cards, wordsById, lessons, lessonsDone, knownCount, addActivity } = useStore();
  const p = profile!;
  const gen = p.gender;
  const tutorName = p.tutor_voice === "m" ? "Mateo" : "Lucía";
  const tutorFem = p.tutor_voice !== "m";

  const [mode, setMode] = useState("free");
  const [headphones, setHeadphones] = useState(false);
  const [usedToday, setUsedToday] = useState<number | null>(null);
  const [phase, setPhase] = useState<"lobby" | "starting" | "call" | "done">("lobby");
  const [state, setState] = useState<TutorState>("connecting");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [left, setLeft] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<{ code: StartError; data?: unknown } | null>(null);
  const [done, setDone] = useState<DoneInfo | null>(null);
  const tutorRef = useRef<LiveTutor | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allowance = p.voice_daily_minutes * 60;

  const refreshUsage = useCallback(async () => {
    const { data } = await supabase
      .from("voice_sessions")
      .select("granted_seconds, used_seconds")
      .gte("started_at", startOfLocalDay().toISOString());
    if (data) setUsedToday(data.reduce((s, r) => s + (r.used_seconds ?? r.granted_seconds), 0));
  }, []);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  // stop everything if the screen is left mid-call
  useEffect(
    () => () => {
      tutorRef.current?.end();
      void ctxRef.current?.close().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const remaining = usedToday === null ? null : Math.max(0, allowance - usedToday);

  const payload = useMemo(() => {
    const known: string[] = [];
    const recent: { es: string; t: number }[] = [];
    const weekAgo = Date.now() - 4 * 86_400_000;
    for (const c of cards.values()) {
      const w = wordsById.get(c.word_id);
      if (!w) continue;
      if (isKnown(c)) known.push(w.es);
      const t = new Date(c.introduced_at).getTime();
      if (t >= weekAgo) recent.push({ es: w.es, t });
    }
    const focus = recent.sort((a, b) => b.t - a.t).slice(0, 20).map((r) => r.es);
    return {
      knownCount,
      knownWords: known.length > 300 ? sample(known, 300) : known,
      focusWords: focus,
      lessons: lessons.filter((l) => lessonsDone.has(l.id)).map((l) => l.title),
    };
  }, [cards, wordsById, knownCount, lessons, lessonsDone]);

  async function start() {
    setError(null);
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo")) {
      // local design preview of the call screen, no network
      setPhase("call");
      setState("speaking");
      setLeft(512);
      setLines([
        { id: 1, who: "tutor", text: "¡Hola Roee! ¿Qué tal tu día?", done: true },
        { id: 2, who: "me", text: "Muy bien, gracias. Hoy trabajo mucho.", done: true },
        { id: 3, who: "tutor", text: "¡Qué bien! ¿Y qué haces en tu trabajo?", done: false },
      ]);
      return;
    }
    // Audio must be unlocked inside the tap itself (iPhone).
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
      void ctx.resume();
    } catch {
      setError({ code: "unsupported" });
      return;
    }
    ctxRef.current = ctx;
    sfx.tap();
    setPhase("starting");
    setLines([]);
    setState("connecting");

    const tutor = new LiveTutor(ctx, {
      onState: setState,
      onTranscript: setLines,
      onTick: setLeft,
      onEnd: (info) => onEnded(info),
    });
    tutor.halfDuplex = !headphones;
    tutorRef.current = tutor;
    const res = await tutor.start({ mode, ...payload });
    if (!res.ok) {
      tutorRef.current = null;
      void ctx.close().catch(() => undefined);
      setError({ code: res.error, data: res.data });
      setPhase("lobby");
      void refreshUsage();
      return;
    }
    setLeft(tutor.session?.grantedSeconds ?? 0);
    setPhase("call");
  }

  function onEnded(info: { seconds: number; reason: EndReason }) {
    const xp = Math.round((info.seconds / 60) * 4);
    if (info.seconds > 0) addActivity({ talk_seconds: info.seconds, xp });
    tutorRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setDone({ ...info, xp });
    setPhase("done");
    void refreshUsage();
    if (info.seconds >= 60) {
      sfx.complete();
      celebrate("small");
    }
    if (info.reason === "disconnected") toast("החיבור נותק. אפשר להתחיל שיחה חדשה.", "error");
  }

  const orbMode: OrbMode = state === "speaking" ? "speak" : state === "connecting" ? "think" : "listen";
  const level = useCallback(() => {
    const t = tutorRef.current;
    if (!t) return 0;
    return state === "speaking" ? t.outputLevel() : Math.min(1, t.micLevel * 6) * 0.6;
  }, [state]);

  // ---------- in call ----------
  if (phase === "call" || phase === "starting") {
    const statusText =
      phase === "starting" || state === "connecting"
        ? `${tutorFem ? "מתחברת" : "מתחבר"}…`
        : state === "speaking"
          ? `${tutorName} ${tutorFem ? "מדברת" : "מדבר"}`
          : muted
            ? "המיקרופון כבוי"
            : g(gen, "תורך לדבר", "תורך לדבר");
    return (
      <div className="call">
        <div className="call-top">
          <span className="chip">
            <Emoji3D emoji={MODES.find((m) => m.id === mode)?.emoji ?? "💬"} size={20} eager />
            {MODES.find((m) => m.id === mode)?.title}
          </span>
          <span className={`chip es ${left < 60 && phase === "call" ? "chip-sun" : ""}`}>{phase === "call" ? minutesLabel(left) : "…"}</span>
        </div>

        <div className="call-orb">
          <Orb size={210} mode={orbMode} level={level} />
          <div className="call-name es">{tutorName}</div>
          <AnimatePresence mode="wait">
            <motion.div key={statusText} className="call-status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {statusText}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="transcript" ref={scrollRef} aria-live="polite">
          {lines.length === 0 && <p className="transcript-hint">{g(gen, "דבר בקצב שלך. אם נתקעת, אפשר לבקש עזרה בעברית.", "דברי בקצב שלך. אם נתקעת, אפשר לבקש עזרה בעברית.")}</p>}
          {lines.map((l) => (
            <motion.div key={l.id} className={`bubble ${l.who}`} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
              <span dir="auto">{l.text}</span>
            </motion.div>
          ))}
        </div>

        <div className="call-controls">
          <button
            className={`call-btn ${muted ? "off" : ""}`}
            onClick={() => {
              const m = !muted;
              setMuted(m);
              if (tutorRef.current) tutorRef.current.muted = m;
            }}
            aria-label={muted ? "הפעלת מיקרופון" : "השתקת מיקרופון"}
            disabled={phase !== "call"}
          >
            {muted ? <IconMicOff /> : <IconMic />}
            <span>{muted ? "מושתק" : "מיקרופון"}</span>
          </button>
          <button className="call-btn end" onClick={() => tutorRef.current?.end()} aria-label="סיום שיחה">
            <IconPhoneOff />
          </button>
          <button className="call-btn" onClick={() => tutorRef.current?.askHelp()} disabled={phase !== "call"} aria-label="עזרה בעברית">
            <IconHelp />
            <span>עזרה</span>
          </button>
        </div>
      </div>
    );
  }

  // ---------- after call ----------
  if (phase === "done" && done) {
    return (
      <div className="summary stack gap-16">
        <div className="summary-hero">
          <Orb size={130} mode="happy" />
        </div>
        <h1 className="summary-title es center">{done.seconds >= 60 ? "¡Qué buena charla!" : "¡Hasta pronto!"}</h1>
        <p className="center muted" style={{ margin: 0 }}>
          {done.reason === "time"
            ? "הזמן של השיחה נגמר."
            : done.reason === "server"
              ? "השיחה הגיעה לאורך המקסימלי."
              : g(gen, `דיברת ${Math.max(1, Math.round(done.seconds / 60))} דקות עם ${tutorName}.`, `דיברת ${Math.max(1, Math.round(done.seconds / 60))} דקות עם ${tutorName}.`)}
        </p>
        <div className="summary-xp card">
          <Emoji3D emoji="⚡" size={40} eager />
          <span className="summary-xp-num es">
            +<CountUp to={done.xp} />
          </span>
          <span className="muted">XP</span>
        </div>
        {remaining !== null && (
          <p className="center small muted" style={{ margin: 0 }}>
            נשארו להיום {Math.floor(remaining / 60)} דקות שיחה
          </p>
        )}
        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            setDone(null);
            setPhase("lobby");
          }}
          disabled={remaining !== null && remaining < 30}
        >
          עוד שיחה
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => navigate("/", { replace: true })}>
          חזרה לבית
        </button>
      </div>
    );
  }

  // ---------- lobby ----------
  const noMinutes = remaining !== null && remaining < 30;
  return (
    <div className="talk stack gap-16">
      <section className="talk-hero">
        <div className="floaty">
          <Orb size={150} mode="happy" />
        </div>
        <h1 className="h1 es">{tutorName}</h1>
        <p className="muted center" style={{ margin: 0 }}>
          {tutorFem ? "המורה הקולית שלך. מדברת לאט, מתקנת בעדינות ועוזרת בעברית כשצריך." : "המורה הקולי שלך. מדבר לאט, מתקן בעדינות ועוזר בעברית כשצריך."}
        </p>
        <span className={`chip ${noMinutes ? "chip-sun" : "chip-violet"}`}>
          {remaining === null ? "בודקים כמה זמן נשאר…" : noMinutes ? "נגמרו הדקות להיום" : `נשארו היום ${Math.floor(remaining / 60)} דקות שיחה`}
        </span>
      </section>

      {error && <StartErrorBox code={error.code} gender={gen} />}

      <section className="stack gap-8">
        <h2 className="h3">על מה מדברים?</h2>
        <div className="modes">
          {MODES.map((m) => (
            <button key={m.id} className={`mode ${mode === m.id ? "active" : ""}`} onClick={() => setMode(m.id)} aria-pressed={mode === m.id}>
              <Emoji3D emoji={m.emoji} size={40} />
              <span className="mode-title">{m.title}</span>
              <span className="mode-sub">{m.sub}</span>
            </button>
          ))}
        </div>
      </section>

      <label className="toggle-row card">
        <Emoji3D emoji="🎧" size={34} />
        <span className="grow">
          <span className="h3" style={{ display: "block" }}>
            {g(gen, "יש לי אוזניות", "יש לי אוזניות")}
          </span>
          <span className="small muted">עם אוזניות אפשר לקטוע את המורה באמצע. בלי אוזניות המיקרופון מחכה שהמורה תסיים.</span>
        </span>
        <input type="checkbox" className="switch" checked={headphones} onChange={(e) => setHeadphones(e.target.checked)} />
      </label>

      <button className="btn btn-sun btn-block talk-start" onClick={() => void start()} disabled={noMinutes}>
        {g(gen, "להתחיל לדבר", "להתחיל לדבר")}
      </button>
      <p className="tiny muted center" style={{ margin: 0 }}>
        השיחה עוברת דרך Google Gemini. שיחה אחת נמשכת עד 9 דקות.
      </p>
    </div>
  );
}

function StartErrorBox({ code, gender }: { code: StartError; gender: "m" | "f" }) {
  const text: Record<StartError, string> = {
    mic_denied: g(
      gender,
      "אין גישה למיקרופון. אשר גישה בהגדרות הדפדפן (בסמל המנעול שליד הכתובת) ונסה שוב.",
      "אין גישה למיקרופון. אשרי גישה בהגדרות הדפדפן (בסמל המנעול שליד הכתובת) ונסי שוב.",
    ),
    mic_missing: "לא נמצא מיקרופון במכשיר.",
    daily_limit: "נגמרו דקות השיחה להיום. מחר יש עוד!",
    token: "השיחה לא זמינה כרגע. נסו שוב בעוד דקה.",
    network: "לא הצלחנו להתחבר. בדקו את החיבור לאינטרנט ונסו שוב.",
    unsupported: "הדפדפן הזה לא תומך בשיחה קולית. נסו ב-Chrome או ב-Safari מעודכן.",
  };
  return (
    <div className="error-box" role="alert">
      {text[code]}
    </div>
  );
}
