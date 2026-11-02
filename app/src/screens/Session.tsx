import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { dueCards, nextNewWords } from "../lib/plan";
import { knownCard, newCard, schedule, type Rating } from "../lib/srs";
import { prefetchVoice, speak, stopSpeaking, ttsAvailable } from "../lib/tts";
import { haptic, sfx } from "../lib/sound";
import { g, shuffle } from "../lib/util";
import { toast } from "../lib/toast";
import type { Card, Word } from "../lib/types";
import { Emoji3D } from "../components/Emoji3D";
import { SpeakButtons, useSpeaker, WordCard } from "../components/WordCard";
import { IconCheck, IconClose, IconSpeaker } from "../components/Icons";
import { celebrate, CountUp } from "../components/ui";
import { Orb } from "../components/Orb";

/**
 * A word session, kept deliberately simple:
 *  - a new word is shown once on a clear card,
 *  - every other step is one question with four answers,
 *  - wrong answers come back a little later.
 */
type Kind = "intro" | "pick-he" | "pick-es" | "listen";
type Stage = "new" | "practice" | "review";
interface Item {
  key: string;
  kind: Kind;
  stage: Stage;
  wordId: number;
  options?: number[];
}

const MAX_REVIEWS = 60;
let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

export const EXTRA_NEW_KEY = "claro:extraNew";
export const REVIEW_ONLY_KEY = "claro:reviewOnly";

const STAGE_LABEL: Record<Stage, { emoji: string; text: string }> = {
  new: { emoji: "✨", text: "מילה חדשה" },
  practice: { emoji: "🎯", text: "תרגול" },
  review: { emoji: "🔁", text: "חזרה על מילה" },
};

function pickKind(card: Card | undefined, canListen: boolean): Exclude<Kind, "intro"> {
  const r = Math.random();
  if (!card || card.state !== 2) {
    if (canListen && r < 0.25) return "listen";
    return r < 0.62 ? "pick-he" : "pick-es";
  }
  // well-known words: mostly "what does it mean?"
  if (canListen && r < 0.3) return "listen";
  return r < 0.75 ? "pick-he" : "pick-es";
}

function distractors(word: Word, words: Word[], kind: Kind): number[] {
  const near = words.filter((w) => w.id !== word.id && Math.abs(w.n - word.n) < 250);
  const samePos = near.filter((w) => w.pos === word.pos);
  const pool = shuffle(samePos.length >= 6 ? samePos : near.length >= 6 ? near : words.filter((w) => w.id !== word.id));
  const seen = new Set<string>([kind === "pick-es" ? word.es : word.he]);
  const out: number[] = [];
  for (const w of pool) {
    const k = kind === "pick-es" ? w.es : w.he;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w.id);
    if (out.length === 3) break;
  }
  return shuffle([word.id, ...out]);
}

const makeItem = (wordId: number, kind: Exclude<Kind, "intro">, stage: Stage, word: Word, words: Word[]): Item => ({
  key: nextKey(),
  kind,
  stage,
  wordId,
  options: distractors(word, words, kind),
});

export default function Session() {
  const store = useStore();
  const { profile, words, wordsById, cards, saveCards, logReview, addActivity, coverage, newToday } = store;
  const p = profile!;
  const accent = p.accent;
  const canListen = ttsAvailable();
  const gen = p.gender;

  const [sessionCards] = useState(() => new Map(cards));
  const startCoverage = useRef(coverage);

  const [queue, setQueue] = useState<Item[]>(() => {
    const extra = Number(sessionStorage.getItem(EXTRA_NEW_KEY) || 0);
    const reviewOnly = sessionStorage.getItem(REVIEW_ONLY_KEY) === "1";
    sessionStorage.removeItem(EXTRA_NEW_KEY);
    sessionStorage.removeItem(REVIEW_ONLY_KEY);
    const due = dueCards(cards).slice(0, MAX_REVIEWS);
    const nNew = reviewOnly ? 0 : Math.max(0, p.daily_new - newToday) + extra;
    const fresh = nextNewWords(words, cards, nNew);
    const reviews: Item[] = due.map((c) => makeItem(c.word_id, pickKind(c, canListen), "review", wordsById.get(c.word_id)!, words));
    const intros: Item[] = fresh.map((w) => ({ key: nextKey(), kind: "intro", stage: "new", wordId: w.id }));
    const out: Item[] = [];
    while (reviews.length || intros.length) {
      out.push(...reviews.splice(0, 2));
      if (intros.length) out.push(intros.shift()!);
    }
    return out;
  });

  const [done, setDone] = useState(0);
  const [xp, setXp] = useState(0);
  const [combo, setCombo] = useState(0);
  const [stats, setStats] = useState({ correct: 0, answered: 0, introduced: 0, maxCombo: 0 });
  const [phase, setPhase] = useState<"question" | "feedback">("question");
  const [chosen, setChosen] = useState<number | null>(null);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [lastXp, setLastXp] = useState(0);
  const [finished, setFinished] = useState(false);
  const [comboBanner, setComboBanner] = useState<number | null>(null);
  const pending = useRef<Item | null>(null);
  const empty = useRef(queue.length === 0);

  const current = queue[0];
  // guards against double taps answering or advancing the same step twice
  const answeredKey = useRef<string | null>(null);
  const continuedKey = useRef<string | null>(null);
  const word = current ? wordsById.get(current.wordId) : undefined;
  const total = done + queue.length;

  const gainXp = useCallback((v: number) => {
    if (v > 0) setXp((x) => x + v);
  }, []);

  // say the word when a new word or a listening question appears
  useEffect(() => {
    if (!current || !word) return;
    if (current.kind !== "listen" && current.kind !== "intro") return;
    const t = window.setTimeout(() => void speak(word.es, accent), current.kind === "listen" ? 300 : 500);
    return () => window.clearTimeout(t);
  }, [current, word, accent]);

  useEffect(() => () => stopSpeaking(), []);

  // download the voice for this step and the next one ahead of time
  useEffect(() => {
    const texts = queue.slice(0, 3).flatMap((it) => {
      const w = wordsById.get(it.wordId);
      return w ? [w.es, ...w.ex.map((x) => x.es)] : [];
    });
    if (texts.length) prefetchVoice(texts, accent);
  }, [queue, wordsById, accent]);

  const advance = useCallback((reinsert?: Item | null) => {
    setQueue((q) => {
      const rest = q.slice(1);
      if (reinsert) {
        const pos = Math.min(rest.length, 3 + Math.floor(Math.random() * 3));
        rest.splice(pos, 0, reinsert);
      }
      return rest;
    });
    setDone((d) => d + 1);
    setPhase("question");
    setChosen(null);
    setLastCorrect(null);
  }, []);

  const repeats = useRef(new Map<number, number>());
  const followUp = useCallback(
    (card: Card): Item | null => {
      const soon = new Date(card.due_at).getTime() - Date.now() < 20 * 60_000;
      if (!soon) return null;
      // a word comes back at most 3 times in one session; after that it waits for the next session
      const n = repeats.current.get(card.word_id) ?? 0;
      if (n >= 3) return null;
      repeats.current.set(card.word_id, n + 1);
      return makeItem(card.word_id, pickKind(card, canListen), "practice", wordsById.get(card.word_id)!, words);
    },
    [wordsById, words, canListen],
  );

  const grade = useCallback(
    (rating: Rating) => {
      if (!current) return { next: null as Card | null, earned: 0 };
      const prev = sessionCards.get(current.wordId) ?? newCard(current.wordId);
      const next = schedule(prev, rating);
      sessionCards.set(current.wordId, next);
      saveCards([next]);
      logReview(current.wordId, rating);
      const correct = rating >= 3;
      const newCombo = correct ? combo + 1 : 0;
      setCombo(newCombo);
      const earned = correct ? 3 + (newCombo >= 5 ? 1 : 0) : 0;
      gainXp(earned);
      addActivity({ reviews: 1, xp: earned });
      setStats((s) => ({
        ...s,
        answered: s.answered + 1,
        correct: s.correct + (correct ? 1 : 0),
        maxCombo: Math.max(s.maxCombo, newCombo),
      }));
      if (correct && (newCombo === 5 || newCombo === 10 || newCombo === 20)) {
        setComboBanner(newCombo);
        sfx.levelUp();
        window.setTimeout(() => setComboBanner(null), 1600);
      }
      return { next, earned };
    },
    [current, sessionCards, saveCards, logReview, combo, gainXp, addActivity],
  );

  function onIntro(known: boolean) {
    if (!current || !word || answeredKey.current === current.key) return;
    answeredKey.current = current.key;
    sfx.tap();
    const card = known ? knownCard(word.id) : newCard(word.id);
    sessionCards.set(word.id, card);
    saveCards([card]);
    const earned = known ? 1 : 2;
    gainXp(earned);
    addActivity({ new_words: 1, xp: earned });
    setStats((s) => ({ ...s, introduced: s.introduced + 1 }));
    if (known) advance(null);
    else advance(makeItem(word.id, canListen && Math.random() < 0.3 ? "listen" : "pick-he", "practice", word, words));
  }

  function onPick(optionId: number) {
    if (!current || !word || phase !== "question" || answeredKey.current === current.key) return;
    answeredKey.current = current.key;
    const correct = optionId === current.wordId;
    setChosen(optionId);
    setLastCorrect(correct);
    setPhase("feedback");
    if (correct) {
      sfx.correct(combo);
      haptic(10);
    } else {
      sfx.wrong();
      haptic(40);
    }
    // hear the right answer once more
    window.setTimeout(() => void speak(word.es, accent), correct ? 250 : 450);
    const { next, earned } = grade(correct ? 3 : 1);
    setLastXp(earned);
    pending.current = next ? followUp(next) : null;
  }

  function onContinue() {
    if (!current || continuedKey.current === current.key) return;
    continuedKey.current = current.key;
    sfx.tap();
    const re = pending.current;
    pending.current = null;
    advance(re);
  }

  useEffect(() => {
    if (queue.length === 0 && done > 0) setFinished(true);
  }, [queue.length, done]);

  // finish
  useEffect(() => {
    if (!finished || empty.current) return;
    const bonus = 10;
    gainXp(bonus);
    addActivity({ xp: bonus });
    sfx.complete();
    celebrate("big");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // keyboard shortcuts on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (phase === "feedback" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onContinue();
        return;
      }
      if (current.kind === "intro" && e.key === "Enter") {
        e.preventDefault();
        onIntro(false);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && current.options && phase === "question") onPick(current.options[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (empty.current) return <EmptySession />;
  if (finished) {
    return (
      <Summary
        xp={xp}
        stats={stats}
        coverageFrom={startCoverage.current}
        coverageTo={store.coverage}
        gender={gen}
        tutor={p.tutor_voice === "m" ? "Mateo" : "Lucía"}
      />
    );
  }
  if (!current || !word) return null;
  const label = STAGE_LABEL[current.stage];

  return (
    <div className="session">
      <header className="session-top">
        <button
          className="icon-btn"
          aria-label="יציאה"
          onClick={() => {
            if (done > 0) toast("ההתקדמות נשמרה", "good");
            navigate("/", { replace: true });
          }}
        >
          <IconClose />
        </button>
        <div className="bar grow" aria-hidden="true">
          <span style={{ width: `${Math.max(4, (done / Math.max(1, total)) * 100)}%` }} />
        </div>
        <span className="session-count es" aria-label={`${done} מתוך ${total}`}>
          {done}/{total}
        </span>
      </header>

      <AnimatePresence>
        {comboBanner && (
          <motion.div
            className="combo-banner"
            initial={{ scale: 0.5, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -20 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
          >
            <Emoji3D emoji="🔥" size={64} eager />
            <span className="es">{comboBanner}</span>
            <span>{g(gen, "תשובות נכונות ברצף!", "תשובות נכונות ברצף!")}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={current.key}
          className="session-body"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className={`stage-tag ${current.stage}`}>
            <Emoji3D emoji={label.emoji} size={20} eager />
            {label.text}
          </div>

          {current.kind === "intro" && (
            <>
              <div className="card session-card">
                <WordCard word={word} accent={accent} examples={1} diffCollapsed />
              </div>
              <div className="session-actions">
                <button className="btn btn-primary btn-block" onClick={() => onIntro(false)}>
                  הבנתי, הלאה
                </button>
                <button className="btn-link" onClick={() => onIntro(true)}>
                  {g(gen, "אני כבר מכיר את המילה הזאת", "אני כבר מכירה את המילה הזאת")}
                </button>
              </div>
            </>
          )}

          {current.kind === "pick-he" && (
            <Question
              ask="מה פירוש המילה?"
              prompt={
                <>
                  <div className="q-es es">{word.es}</div>
                  <SpeakButtons text={word.es} accent={accent} size="sm" />
                </>
              }
              options={current.options!.map((id) => ({ id, label: wordsById.get(id)!.he }))}
              chosen={chosen}
              answer={word.id}
              onPick={onPick}
              phase={phase}
            />
          )}

          {current.kind === "pick-es" && (
            <Question
              ask="איך אומרים את זה בספרדית?"
              prompt={
                <>
                  <div className="q-art">
                    <Emoji3D emoji={word.emoji} size={104} eager />
                  </div>
                  <div className="q-he">{word.he}</div>
                </>
              }
              options={current.options!.map((id) => ({ id, label: <span className="es">{wordsById.get(id)!.es}</span> }))}
              chosen={chosen}
              answer={word.id}
              onPick={onPick}
              phase={phase}
            />
          )}

          {current.kind === "listen" && <ListenQuestion word={word} accent={accent} options={current.options!} chosen={chosen} phase={phase} onPick={onPick} />}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {phase === "feedback" && lastCorrect !== null && (
          <motion.div
            className={`feedback ${lastCorrect ? "good" : "bad"}`}
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            role="status"
          >
            <div className="feedback-head">
              <span className="feedback-icon">{lastCorrect ? <IconCheck /> : <IconClose />}</span>
              <span className="feedback-title">{lastCorrect ? "נכון!" : "התשובה הנכונה:"}</span>
              {lastCorrect && lastXp > 0 && (
                <motion.span className="feedback-xp es" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, type: "spring", stiffness: 500, damping: 16 }}>
                  +{lastXp} XP
                </motion.span>
              )}
            </div>
            <div className="feedback-word">
              <Emoji3D emoji={word.emoji} size={44} eager />
              <div className="stack grow">
                <b className="es feedback-es">{word.es}</b>
                <span>{word.he}</span>
              </div>
              <button className="speak-round" onClick={() => void speak(word.es, accent)} aria-label="השמעה">
                <IconSpeaker />
              </button>
            </div>
            <button className={`btn btn-block ${lastCorrect ? "btn-good" : "btn-bad"}`} onClick={onContinue} autoFocus>
              המשך
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ListenQuestion(props: { word: Word; accent: "latam" | "spain"; options: number[]; chosen: number | null; phase: "question" | "feedback"; onPick: (id: number) => void }) {
  const { word, accent } = props;
  const { wordsById } = useStore();
  const { playing, say } = useSpeaker(accent);
  return (
    <Question
      ask="מה שמעת?"
      prompt={
        <div className="listen-prompt">
          <button className={`listen-btn ${playing === "n" ? "playing" : ""}`} onClick={() => say(word.es, "n")} aria-label="השמעה">
            <IconSpeaker />
          </button>
          <button className={`speak-pill slow ${playing === "s" ? "playing" : ""}`} onClick={() => say(word.es, "s", true)}>
            <Emoji3D emoji="🐢" size={22} eager />
            <span>לאט</span>
          </button>
          {props.phase === "feedback" && <div className="q-es es small-es">{word.es}</div>}
        </div>
      }
      options={props.options.map((id) => ({ id, label: wordsById.get(id)!.he }))}
      chosen={props.chosen}
      answer={word.id}
      onPick={props.onPick}
      phase={props.phase}
    />
  );
}

function Question(props: {
  ask: string;
  prompt: ReactNode;
  options: { id: number; label: ReactNode }[];
  chosen: number | null;
  answer: number;
  onPick: (id: number) => void;
  phase: "question" | "feedback";
}) {
  return (
    <>
      <div className="card session-card q-card">
        <div className="q-ask">{props.ask}</div>
        {props.prompt}
      </div>
      <div className="options" role="list">
        {props.options.map((o, i) => {
          const state =
            props.phase === "feedback" ? (o.id === props.answer ? "right" : o.id === props.chosen ? "wrong" : "dim") : "";
          return (
            <motion.button
              key={o.id}
              role="listitem"
              className={`option ${state}`}
              onClick={() => props.onPick(o.id)}
              disabled={props.phase === "feedback"}
              initial={{ opacity: 0, y: 10 }}
              animate={
                state === "wrong"
                  ? { x: [0, -8, 8, -5, 5, 0], opacity: 1, y: 0 }
                  : state === "right"
                    ? { scale: [1, 1.04, 1], opacity: 1, y: 0 }
                    : { opacity: 1, y: 0 }
              }
              transition={{ delay: props.phase === "feedback" ? 0 : 0.04 + i * 0.04, duration: state ? 0.4 : 0.25 }}
            >
              <span className="option-label">{o.label}</span>
              {state === "right" && (
                <span className="option-mark">
                  <IconCheck />
                </span>
              )}
              {state === "wrong" && (
                <span className="option-mark">
                  <IconClose />
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </>
  );
}

function Summary(props: {
  xp: number;
  stats: { correct: number; answered: number; introduced: number; maxCombo: number };
  coverageFrom: number;
  coverageTo: number;
  gender: "m" | "f";
  tutor: string;
}) {
  const { stats } = props;
  const acc = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 100;
  const delta = props.coverageTo - props.coverageFrom;
  return (
    <div className="summary stack gap-16">
      <motion.div className="summary-hero" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 14 }}>
        <Emoji3D emoji="🏆" size={140} eager />
      </motion.div>
      <h1 className="summary-title es center">¡Lo lograste!</h1>
      <p className="center muted" style={{ margin: 0 }}>
        {g(props.gender, "סיימת את הסבב. ככה בונים שפה.", "סיימת את הסבב. ככה בונים שפה.")}
      </p>
      <div className="summary-xp card">
        <Emoji3D emoji="⚡" size={40} eager />
        <span className="summary-xp-num es">
          +<CountUp to={props.xp} />
        </span>
        <span className="muted">XP</span>
      </div>
      <div className="summary-grid">
        <Stat emoji="✨" value={stats.introduced} label="מילים חדשות" />
        <Stat emoji="🎯" value={`${acc}%`} label="דיוק" />
        <Stat emoji="🔁" value={stats.answered} label="תרגולים" />
        <Stat emoji="🔥" value={stats.maxCombo} label="רצף שיא" />
      </div>
      <div className="card summary-cov">
        <span className="small muted">{g(props.gender, "אתה מבין עכשיו", "את מבינה עכשיו")}</span>
        <span className="coverage-num es">{props.coverageTo.toFixed(1)}%</span>
        <span className="small muted">
          מהמילים בשיחה יומיומית{delta > 0.05 ? ` (+${delta.toFixed(1)}% בסבב הזה)` : ""}
        </span>
      </div>
      <button className="btn btn-sun btn-block" onClick={() => navigate("/talk", { replace: true })}>
        לתרגל בשיחה עם {props.tutor}
      </button>
      <button className="btn btn-ghost btn-block" onClick={() => navigate("/", { replace: true })}>
        חזרה לבית
      </button>
    </div>
  );
}

function Stat({ emoji, value, label }: { emoji: string; value: number | string; label: string }) {
  return (
    <div className="stat card">
      <Emoji3D emoji={emoji} size={34} eager />
      <span className="stat-v es">{value}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

function EmptySession() {
  const { profile } = useStore();
  const gen = profile?.gender;
  const tutor = profile?.tutor_voice === "m" ? "Mateo" : "Lucía";
  const more = useMemo(
    () => () => {
      sessionStorage.setItem(EXTRA_NEW_KEY, "5");
      navigate("/words", { replace: true });
      window.setTimeout(() => navigate("/words/session"), 30);
    },
    [],
  );
  return (
    <div className="page-center">
      <div className="stack gap-16 center" style={{ alignItems: "center", maxWidth: 340 }}>
        <Orb size={110} mode="happy" />
        <h1 className="h2">הכול מעודכן להיום</h1>
        <p className="muted" style={{ margin: 0 }}>
          {g(gen, "סיימת את כל החזרות והמילים של היום. אפשר להמשיך עם עוד מילים, או לתרגל בשיחה.", "סיימת את כל החזרות והמילים של היום. אפשר להמשיך עם עוד מילים, או לתרגל בשיחה.")}
        </p>
        <button className="btn btn-primary btn-block" onClick={more}>
          עוד 5 מילים חדשות
        </button>
        <button className="btn btn-soft btn-block" onClick={() => navigate("/talk", { replace: true })}>
          לדבר עם {tutor}
        </button>
        <button className="btn btn-ghost btn-block btn-sm" onClick={() => navigate("/", { replace: true })}>
          חזרה לבית
        </button>
      </div>
    </div>
  );
}
