import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { dueCards, nextNewWords } from "../lib/plan";
import { graduateNew, knownCard, newCard, schedule, type Rating } from "../lib/srs";
import { prefetchVoice, speak, stopSpeaking, ttsAvailable } from "../lib/tts";
import { canType, checkTyped, type Verdict } from "../lib/answer";
import { groupsByWord } from "../lib/content";
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
 * A word round (up to 10 new words + due reviews).
 * A new word only counts as learned after it passes every step, from easy to hard:
 *   choose the meaning → recognise it by ear → type the meaning in Hebrew.
 * A wrong answer sends the word one step back. The same word never comes twice in a row,
 * and at most three new words are "in the air" at once, so the round really tests memory.
 */
type Step = "intro" | "pick-he" | "pick-es" | "listen" | "type";
interface Learner {
  wordId: number;
  kind: "new" | "review";
  ladder: Exclude<Step, "intro">[];
  pos: number;
  readyAt: number;
  introduced: boolean;
  failed: boolean;
  done: boolean;
}
interface Item {
  key: string;
  wordId: number;
  step: Step;
  options?: number[];
  knownCheck?: boolean;
}
interface Pending {
  correct: boolean;
  verdict?: Verdict;
  typed?: string;
  gaveUp?: boolean;
}

const NEW_PER_ROUND = 10;
const MAX_REVIEWS = 20;
const IN_FLIGHT = 3;
let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

export const EXTRA_NEW_KEY = "claro:extraNew";
export const REVIEW_ONLY_KEY = "claro:reviewOnly";

function ladderFor(word: Word, canListen: boolean): Exclude<Step, "intro">[] {
  return ["pick-he", canListen ? "listen" : "pick-es", canType(word) ? "type" : "pick-es"];
}

function editDistance(a: string, b: string) {
  const p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let d = p[0];
    p[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = p[j];
      p[j] = Math.min(p[j] + 1, p[j - 1] + 1, d + (a[i - 1] === b[j - 1] ? 0 : 1));
      d = t;
    }
  }
  return p[b.length];
}

/**
 * Wrong options that are actually tempting: words from this round, words with a similar meaning,
 * and (for Spanish options) words that look alike.
 */
function pickOptions(word: Word, step: Step, words: Word[], wordsById: Map<number, Word>, roundIds: number[]): number[] {
  const spanish = step === "pick-es";
  const key = (w: Word) => (spanish ? w.es : w.he);
  const seen = new Set([key(word)]);
  const out: number[] = [];
  const add = (w: Word | undefined) => {
    if (!w || w.id === word.id || out.length >= 3 || seen.has(key(w))) return;
    seen.add(key(w));
    out.push(w.id);
  };
  // 1. a word with a similar meaning
  for (const grp of groupsByWord.get(word.id) ?? []) for (const id of shuffle(grp.words)) if (out.length < 1) add(wordsById.get(id));
  // 2. other words from this round with the same part of speech, then any from this round
  const round = shuffle(roundIds.filter((id) => id !== word.id)).map((id) => wordsById.get(id)!);
  round.filter((w) => w.pos === word.pos).forEach((w) => out.length < 2 && add(w));
  // 3. nearby words: look-alikes for Spanish options, same part of speech for Hebrew options
  const near = words.filter((w) => w.id !== word.id && Math.abs(w.n - word.n) < 300);
  const pool = spanish
    ? near.map((w) => ({ w, d: editDistance(w.es.toLowerCase(), word.es.toLowerCase()) })).sort((a, b) => a.d - b.d).slice(0, 10).map((x) => x.w)
    : near.filter((w) => w.pos === word.pos);
  shuffle(pool).forEach(add);
  round.forEach(add);
  shuffle(words).slice(0, 40).forEach(add);
  return shuffle([word.id, ...out]);
}

export default function Session() {
  const store = useStore();
  const { profile, words, wordsById, cards, saveCards, logReview, addActivity, coverage, newToday } = store;
  const p = profile!;
  const accent = p.accent;
  const canListen = ttsAvailable();
  const gen = p.gender;

  const [sessionCards] = useState(() => new Map(cards));
  const startCoverage = useRef(coverage);

  // ----- build the round -----
  const learners = useRef<Learner[]>([]);
  const counter = useRef(0);
  const roundIds = useRef<number[]>([]);
  const [empty] = useState(() => {
    const extra = Number(sessionStorage.getItem(EXTRA_NEW_KEY) || 0);
    const reviewOnly = sessionStorage.getItem(REVIEW_ONLY_KEY) === "1";
    sessionStorage.removeItem(EXTRA_NEW_KEY);
    sessionStorage.removeItem(REVIEW_ONLY_KEY);
    const due = dueCards(cards).slice(0, MAX_REVIEWS);
    const nNew = reviewOnly ? 0 : extra > 0 ? extra : Math.min(NEW_PER_ROUND, Math.max(0, p.daily_new - newToday));
    const fresh = nextNewWords(words, cards, nNew);
    const list: Learner[] = [];
    due.forEach((c, i) => {
      const w = wordsById.get(c.word_id);
      if (!w) return;
      list.push({ wordId: w.id, kind: "review", ladder: [canType(w) ? "type" : "pick-he"], pos: 0, readyAt: i * 2, introduced: true, failed: false, done: false });
    });
    fresh.forEach((w) => list.push({ wordId: w.id, kind: "new", ladder: ladderFor(w, canListen), pos: 0, readyAt: 0, introduced: false, failed: false, done: false }));
    learners.current = list;
    roundIds.current = list.map((l) => l.wordId);
    return list.length === 0;
  });

  const [current, setCurrent] = useState<Item | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [xp, setXp] = useState(0);
  const [combo, setCombo] = useState(0);
  const [stats, setStats] = useState({ correct: 0, answered: 0, introduced: 0, maxCombo: 0 });
  const [pending, setPending] = useState<Pending | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [comboBanner, setComboBanner] = useState<number | null>(null);
  const lastWord = useRef<number | null>(null);
  const continuedKey = useRef<string | null>(null);
  const answeredKey = useRef<string | null>(null);

  const total = learners.current.length;
  const word = current ? wordsById.get(current.wordId) : undefined;
  const learner = current ? learners.current.find((l) => l.wordId === current.wordId) : undefined;

  /** Choose what comes next: introduce a new word while few are in the air, otherwise the word waiting longest. */
  const pickNext = useCallback((): Item | null => {
    const ls = learners.current;
    const c = counter.current;
    const active = ls.filter((l) => !l.done && l.introduced);
    const inFlightNew = active.filter((l) => l.kind === "new").length;
    const fresh = ls.find((l) => !l.done && !l.introduced);
    const ready = active.filter((l) => l.readyAt <= c && l.wordId !== lastWord.current).sort((a, b) => a.readyAt - b.readyAt);
    let pick: Learner | undefined;
    if (fresh && inFlightNew < IN_FLIGHT && (ready.length === 0 || c % 2 === 0 || inFlightNew === 0)) {
      return { key: nextKey(), wordId: fresh.wordId, step: "intro" };
    }
    pick = ready[0];
    if (!pick && fresh) return { key: nextKey(), wordId: fresh.wordId, step: "intro" };
    if (!pick) {
      const waiting = active.filter((l) => l.wordId !== lastWord.current).sort((a, b) => a.readyAt - b.readyAt);
      pick = waiting[0] ?? active[0];
    }
    if (!pick) return null;
    const w = wordsById.get(pick.wordId)!;
    const step = pick.ladder[pick.pos];
    return {
      key: nextKey(),
      wordId: pick.wordId,
      step,
      options: step === "type" ? undefined : pickOptions(w, step, words, wordsById, roundIds.current),
    };
  }, [wordsById, words]);

  const advance = useCallback(() => {
    counter.current += 1;
    const next = pickNext();
    if (next) lastWord.current = next.wordId;
    setCurrent(next);
    setPending(null);
    setChosen(null);
    if (!next) setFinished(true);
  }, [pickNext]);

  // first item
  useEffect(() => {
    if (empty) return;
    const first = pickNext();
    if (first) lastWord.current = first.wordId;
    setCurrent(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // say the word when a new word or a listening question appears
  useEffect(() => {
    if (!current || !word) return;
    if (current.step !== "listen" && current.step !== "intro") return;
    const t = window.setTimeout(() => void speak(word.es, accent), current.step === "listen" ? 300 : 500);
    return () => window.clearTimeout(t);
  }, [current, word, accent]);

  useEffect(() => () => stopSpeaking(), []);

  // download the voice for this round ahead of time
  useEffect(() => {
    const texts = roundIds.current.slice(0, 14).flatMap((id) => {
      const w = wordsById.get(id);
      return w ? [w.es, ...w.ex.map((x) => x.es)] : [];
    });
    if (texts.length) prefetchVoice(texts, accent);
  }, [wordsById, accent]);

  const gainXp = useCallback((v: number) => v > 0 && setXp((x) => x + v), []);

  function saveCard(c: Card) {
    sessionCards.set(c.word_id, c);
    saveCards([c]);
  }

  // ----- answering -----
  function answer(p: Pending) {
    if (!current || answeredKey.current === current.key) return;
    answeredKey.current = current.key;
    setPending(p);
    if (p.correct) {
      sfx.correct(combo);
      haptic(10);
    } else {
      sfx.wrong();
      haptic(40);
    }
    if (word) window.setTimeout(() => void speak(word.es, accent), p.correct ? 250 : 450);
  }

  function onPick(id: number) {
    if (!current || pending) return;
    setChosen(id);
    answer({ correct: id === current.wordId });
  }

  function onTyped(text: string, gaveUp: boolean) {
    if (!current || !word || pending) return;
    const verdict: Verdict = gaveUp ? "wrong" : checkTyped(text, word);
    answer({ correct: verdict !== "wrong", verdict, typed: text, gaveUp });
  }

  /** "I was right": the typed answer was a valid translation the list didn't have. */
  function overrule() {
    if (!pending || pending.correct) return;
    setPending({ ...pending, correct: true, verdict: "right" });
    sfx.correct(combo);
  }

  function apply(p: Pending) {
    if (!current || !word || !learner) return;
    const correct = p.correct;
    const rating: Rating = correct ? 3 : 1;
    logReview(word.id, rating);
    const typedStep = current.step === "type";
    const earned = correct ? (typedStep ? 5 : 3) + (combo >= 4 ? 1 : 0) : 0;
    gainXp(earned);
    addActivity({ reviews: 1, xp: earned });
    const newCombo = correct ? combo + 1 : 0;
    setCombo(newCombo);
    setStats((s) => ({ ...s, answered: s.answered + 1, correct: s.correct + (correct ? 1 : 0), maxCombo: Math.max(s.maxCombo, newCombo) }));
    if (correct && (newCombo === 5 || newCombo === 10 || newCombo === 20)) {
      setComboBanner(newCombo);
      sfx.levelUp();
      window.setTimeout(() => setComboBanner(null), 1600);
    }

    const card = sessionCards.get(word.id) ?? newCard(word.id);
    const typeStep: Exclude<Step, "intro"> = canType(word) ? "type" : "pick-es";
    let finishedWord = false;

    if (current.knownCheck) {
      if (correct) {
        saveCard(knownCard(word.id));
        finishedWord = true;
      } else {
        learner.pos = 0; // learn it properly
      }
    } else if (learner.kind === "review" && !learner.failed) {
      if (correct) {
        saveCard(schedule(card, 3));
        finishedWord = true;
      } else {
        saveCard(schedule(card, 1)); // back to relearning
        learner.failed = true;
        learner.ladder = ["pick-he", typeStep];
        learner.pos = 0;
      }
    } else if (correct) {
      learner.pos += 1;
      if (learner.pos >= learner.ladder.length) {
        finishedWord = true;
        saveCard(learner.kind === "new" ? graduateNew(card) : schedule(card, 3));
      }
    } else {
      learner.pos = Math.max(0, learner.pos - 1);
      learner.failed = true;
    }

    if (finishedWord) {
      learner.done = true;
      setDoneCount((d) => d + 1);
      if (learner.kind === "new") setStats((s) => ({ ...s, introduced: s.introduced + 1 }));
    }
    learner.readyAt = counter.current + (correct ? 3 : 2);
  }

  function onContinue() {
    if (!current || continuedKey.current === current.key) return;
    continuedKey.current = current.key;
    sfx.tap();
    if (pending) apply(pending);
    advance();
  }

  function onIntro(knowIt: boolean) {
    if (!current || !word || !learner || continuedKey.current === current.key) return;
    continuedKey.current = current.key;
    sfx.tap();
    learner.introduced = true;
    addActivity({ new_words: 1, xp: 1 });
    gainXp(1);
    if (!sessionCards.has(word.id)) saveCard(newCard(word.id));
    if (knowIt) {
      // prove it: type the meaning right now
      counter.current += 1;
      const step: Step = canType(word) ? "type" : "pick-he";
      const item: Item = { key: nextKey(), wordId: word.id, step, knownCheck: true, options: step === "type" ? undefined : pickOptions(word, step, words, wordsById, roundIds.current) };
      lastWord.current = word.id;
      setCurrent(item);
      setPending(null);
      setChosen(null);
      return;
    }
    learner.readyAt = counter.current + 2;
    advance();
  }

  // finish
  useEffect(() => {
    if (!finished || empty) return;
    gainXp(10);
    addActivity({ xp: 10 });
    sfx.complete();
    celebrate("big");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // keyboard shortcuts on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (pending && (e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        onContinue();
        return;
      }
      if (current.step === "intro" && e.key === "Enter") {
        e.preventDefault();
        onIntro(false);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && current.options && !pending && !(e.target instanceof HTMLInputElement)) onPick(current.options[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (empty) return <EmptySession />;
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
  if (!current || !word || !learner) return null;

  const stageLabel =
    current.step === "intro"
      ? { cls: "new", emoji: "✨", text: "מילה חדשה" }
      : current.knownCheck
        ? { cls: "review", emoji: "🧐", text: g(gen, "בוא נבדוק שאתה מכיר", "בואי נבדוק שאת מכירה") }
        : learner.kind === "review" && !learner.failed
          ? { cls: "review", emoji: "🔁", text: "חזרה על מילה" }
          : { cls: "practice", emoji: "🎯", text: "תרגול" };

  return (
    <div className="session">
      <header className="session-top">
        <button
          className="icon-btn"
          aria-label="יציאה"
          onClick={() => {
            if (doneCount > 0 || stats.answered > 0) toast("ההתקדמות נשמרה", "good");
            navigate("/", { replace: true });
          }}
        >
          <IconClose />
        </button>
        <div className="bar grow" aria-hidden="true">
          <span style={{ width: `${Math.max(4, (doneCount / Math.max(1, total)) * 100)}%` }} />
        </div>
        <span className="session-count" aria-label={`${doneCount} מתוך ${total} מילים`}>
          <span className="es">
            {doneCount}/{total}
          </span>
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
            <span>תשובות נכונות ברצף!</span>
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
          <div className="stage-row">
            <div className={`stage-tag ${stageLabel.cls}`}>
              <Emoji3D emoji={stageLabel.emoji} size={20} eager />
              {stageLabel.text}
            </div>
            {learner.kind === "new" && current.step !== "intro" && !current.knownCheck && (
              <div className="ladder" aria-label={`שלב ${learner.pos + 1} מתוך ${learner.ladder.length}`}>
                {learner.ladder.map((_, i) => (
                  <span key={i} className={i < learner.pos ? "on" : i === learner.pos ? "now" : ""} />
                ))}
              </div>
            )}
          </div>

          {current.step === "intro" && (
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

          {current.step === "pick-he" && (
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
              locked={!!pending}
            />
          )}

          {current.step === "pick-es" && (
            <Question
              ask="איך אומרים את זה בספרדית?"
              prompt={
                <>
                  <div className="q-art">
                    <Emoji3D emoji={word.emoji} size={96} eager />
                  </div>
                  <div className="q-he">{word.he}</div>
                </>
              }
              options={current.options!.map((id) => ({ id, label: <span className="es">{wordsById.get(id)!.es}</span> }))}
              chosen={chosen}
              answer={word.id}
              onPick={onPick}
              locked={!!pending}
            />
          )}

          {current.step === "listen" && <ListenQuestion word={word} accent={accent} options={current.options!} chosen={chosen} locked={!!pending} onPick={onPick} />}

          {current.step === "type" && <TypeQuestion key={current.key} word={word} accent={accent} locked={!!pending} onSubmit={onTyped} gender={gen} />}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {pending && (
          <motion.div
            className={`feedback ${pending.correct ? "good" : "bad"}`}
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            role="status"
          >
            <div className="feedback-head">
              <span className="feedback-icon">{pending.correct ? <IconCheck /> : <IconClose />}</span>
              <span className="feedback-title">
                {pending.correct ? (pending.verdict === "close" ? "נכון, רק שימו לב לכתיב" : "נכון!") : pending.gaveUp ? "זאת התשובה:" : "לא בדיוק. התשובה:"}
              </span>
            </div>
            {current.step === "type" && pending.typed && !pending.gaveUp && (
              <div className="feedback-typed">
                כתבת: <b>{pending.typed}</b>
              </div>
            )}
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
            {!pending.correct && current.step === "type" && pending.typed && !pending.gaveUp && (
              <button className="btn-link feedback-overrule" onClick={overrule}>
                {g(gen, "כתבתי תרגום נכון אחר? סמן כנכון", "כתבתי תרגום נכון אחר? סמני כנכון")}
              </button>
            )}
            <button className={`btn btn-block ${pending.correct ? "btn-good" : "btn-bad"}`} onClick={onContinue} autoFocus>
              המשך
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TypeQuestion({ word, accent, locked, onSubmit, gender }: { word: Word; accent: "latam" | "spain"; locked: boolean; onSubmit: (text: string, gaveUp: boolean) => void; gender: "m" | "f" }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus(), 350);
    return () => window.clearTimeout(t);
  }, []);
  const submit = () => {
    if (locked) return;
    if (!text.trim()) {
      input.current?.focus();
      return;
    }
    input.current?.blur();
    onSubmit(text, false);
  };
  return (
    <>
      <div className="card session-card q-card">
        <div className="q-ask">{g(gender, "כתוב בעברית מה זה אומר", "כתבי בעברית מה זה אומר")}</div>
        <div className="q-es es">{word.es}</div>
        <SpeakButtons text={word.es} accent={accent} size="sm" />
      </div>
      <form
        className="type-box"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={input}
          className="input type-input"
          dir="rtl"
          lang="he"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="התרגום בעברית…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={locked}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={locked || !text.trim()}>
          בדיקה
        </button>
        <button
          type="button"
          className="btn-link"
          disabled={locked}
          onClick={() => {
            input.current?.blur();
            onSubmit("", true);
          }}
        >
          {g(gender, "לא זוכר", "לא זוכרת")}
        </button>
      </form>
    </>
  );
}

function ListenQuestion(props: { word: Word; accent: "latam" | "spain"; options: number[]; chosen: number | null; locked: boolean; onPick: (id: number) => void }) {
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
          {props.locked && <div className="q-es es small-es">{word.es}</div>}
        </div>
      }
      options={props.options.map((id) => ({ id, label: wordsById.get(id)!.he }))}
      chosen={props.chosen}
      answer={word.id}
      onPick={props.onPick}
      locked={props.locked}
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
  locked: boolean;
}) {
  return (
    <>
      <div className="card session-card q-card">
        <div className="q-ask">{props.ask}</div>
        {props.prompt}
      </div>
      <div className="options" role="list">
        {props.options.map((o, i) => {
          const state = props.locked ? (o.id === props.answer ? "right" : o.id === props.chosen ? "wrong" : "dim") : "";
          return (
            <motion.button
              key={o.id}
              role="listitem"
              className={`option ${state}`}
              onClick={() => props.onPick(o.id)}
              disabled={props.locked}
              initial={{ opacity: 0, y: 10 }}
              animate={
                state === "wrong"
                  ? { x: [0, -8, 8, -5, 5, 0], opacity: 1, y: 0 }
                  : state === "right"
                    ? { scale: [1, 1.04, 1], opacity: 1, y: 0 }
                    : { opacity: 1, y: 0 }
              }
              transition={{ delay: props.locked ? 0 : 0.04 + i * 0.04, duration: state ? 0.4 : 0.25 }}
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
      sessionStorage.setItem(EXTRA_NEW_KEY, "10");
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
          עוד 10 מילים חדשות
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
