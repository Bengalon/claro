import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { prefetchVoice, speak } from "../lib/tts";
import { haptic, sfx } from "../lib/sound";
import { g, shuffle } from "../lib/util";
import type { Lesson, QuizItem } from "../lib/types";
import { Emoji3D } from "../components/Emoji3D";
import { RichText } from "../components/RichText";
import { celebrate, CountUp, TopBar } from "../components/ui";
import { IconCheck, IconClose, IconSpeaker } from "../components/Icons";
import { starsFor } from "./Lessons";

export default function LessonView({ id }: { id: string }) {
  const { lessons, profile } = useStore();
  const lesson = lessons.find((l) => l.id === id);
  const [phase, setPhase] = useState<"read" | "quiz">("read");
  const accent = profile?.accent;
  useEffect(() => {
    if (!lesson || !accent) return;
    const texts: string[] = [...lesson.new_words.map((w) => w.es)];
    for (const s of lesson.slides) texts.push(...(s.examples ?? []).map((x) => x.es));
    for (const q of lesson.quiz) if (q.type === "build") texts.push(q.answer);
    prefetchVoice(texts, accent);
  }, [lesson, accent]);
  if (!lesson) {
    return (
      <div className="stack gap-16">
        <TopBar title="שיעור" onBack={() => navigate("/lessons", { replace: true })} />
        <p className="muted">השיעור לא נמצא.</p>
      </div>
    );
  }
  return phase === "read" ? <Read key={`r${lesson.id}`} lesson={lesson} onQuiz={() => setPhase("quiz")} /> : <Quiz key={`q${lesson.id}`} lesson={lesson} onRetry={() => setPhase("read")} />;
}

/** Spanish text where every word can be tapped for its meaning. */
export function EsText({ text, lesson, onWord }: { text: string; lesson: Lesson; onWord: (es: string, he: string) => void }) {
  const { wordsById } = useStore();
  const parts = text.split(/([A-Za-zÀ-ÖØ-öø-ÿ]+)/);
  return (
    <span className="es es-text">
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        const low = p.toLowerCase();
        const nw = lesson.new_words.find((w) => w.es.toLowerCase().split("/").some((f) => f.trim() === low));
        const id = lesson.lex?.[low];
        const he = nw?.he ?? (id !== undefined ? wordsById.get(id)?.he : undefined);
        if (!he) return p;
        return (
          <span
            key={i}
            className="tok"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onWord(nw ? nw.es : wordsById.get(id!)!.es, he);
            }}
          >
            {p}
          </span>
        );
      })}
    </span>
  );
}

function useGloss() {
  const [gloss, setGloss] = useState<{ es: string; he: string; k: number } | null>(null);
  const timer = useRef<number | null>(null);
  const show = (es: string, he: string) => {
    setGloss({ es, he, k: Date.now() });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setGloss(null), 3500);
  };
  const hide = () => setGloss(null);
  return { gloss, show, hide };
}

export function GlossBubble({ gloss, accent }: { gloss: { es: string; he: string; k: number } | null; accent: "latam" | "spain" }) {
  return (
    <AnimatePresence>
      {gloss && (
        <motion.button
          key={gloss.k}
          className="gloss"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          onClick={() => void speak(gloss.es, accent)}
        >
          <b className="es">{gloss.es}</b>
          <span>=</span>
          <span>{gloss.he}</span>
          <IconSpeaker className="gloss-speaker" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function Read({ lesson, onQuiz }: { lesson: Lesson; onQuiz: () => void }) {
  const { profile, cards, wordsById } = useStore();
  const accent = profile!.accent;
  const gen = profile!.gender;
  const [i, setI] = useState(0); // 0 = start page, then one page per slide
  const { gloss, show, hide } = useGloss();
  const pages = lesson.slides.length + 1;

  // words in this lesson the learner hasn't learned yet
  const toLearn = useMemo(() => {
    const out: { es: string; he: string }[] = [...lesson.new_words];
    for (const id of lesson.words ?? []) {
      const c = cards.get(id);
      const w = wordsById.get(id);
      if (w && (!c || c.state === 0) && !out.some((x) => x.es === w.es)) out.push({ es: w.es, he: w.he });
    }
    return out.slice(0, 10);
  }, [lesson, cards, wordsById]);

  const go = (n: number) => {
    sfx.tap();
    hide();
    setI(Math.max(0, Math.min(pages - 1, n)));
    window.scrollTo({ top: 0 });
  };
  const slide = i > 0 ? lesson.slides[i - 1] : null;

  return (
    <div className="lesson">
      <div className="lesson-top">
        <button className="icon-btn" aria-label="חזרה לשיעורים" onClick={() => navigate("/lessons", { replace: true })}>
          <IconClose />
        </button>
        <div className="lesson-dots" aria-label={`עמוד ${i + 1} מתוך ${pages}`}>
          {Array.from({ length: pages }).map((_, k) => (
            <span key={k} className={k < i ? "on" : k === i ? "now" : ""} />
          ))}
        </div>
        <span className="small muted">
          שיעור <span className="es">{lesson.order}</span>
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          className="lesson-page"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {i === 0 ? (
            <div className="stack gap-16">
              <header className="lesson-head">
                <div className="floaty">
                  <Emoji3D emoji={lesson.emoji} size={84} eager />
                </div>
                <h1 className="h1">
                  <RichText text={lesson.title} />
                </h1>
                <p className="lesson-goal">
                  <RichText text={lesson.summary} />
                </p>
                <span className="chip">
                  <span className="es">{lesson.slides.length}</span>&nbsp;שלבים קצרים ·&nbsp;<span className="es">{lesson.quiz.length}</span>&nbsp;שאלות
                </span>
              </header>
              {toLearn.length > 0 && (
                <section className="card words-first">
                  <h2 className="h3">{g(gen, "מילים שתפגוש בשיעור", "מילים שתפגשי בשיעור")}</h2>
                  <p className="small muted" style={{ margin: 0 }}>
                    {g(gen, "עוד לא למדת אותן. אפשר ללחוץ כדי לשמוע.", "עוד לא למדת אותן. אפשר ללחוץ כדי לשמוע.")}
                  </p>
                  <div className="words-first-list">
                    {toLearn.map((w) => (
                      <button key={w.es} className="wf-row" onClick={() => void speak(w.es, accent)}>
                        <b className="es">{w.es}</b>
                        <span className="wf-he">{w.he}</span>
                        <IconSpeaker className="example-speaker" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            slide && (
              <section className="card slide">
                <div className="slide-num small muted">
                  <span className="es">{i}</span> מתוך <span className="es">{lesson.slides.length}</span>
                </div>
                <h2 className="h2">
                  <RichText text={slide.title} />
                </h2>
                <p className="slide-text">
                  <RichText text={slide.text} />
                </p>
                {slide.table && (
                  <div className="table-wrap">
                    <table className="lesson-table">
                      <thead>
                        <tr>
                          {slide.table.head.map((h, j) => (
                            <th key={j}>
                              <RichText text={h} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {slide.table.rows.map((r, j) => (
                          <tr key={j}>
                            {r.map((cell, k) => (
                              <td key={k}>{/[\u0590-\u05FF]/.test(cell) ? <RichText text={cell} /> : <EsText text={cell} lesson={lesson} onWord={show} />}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!slide.examples?.length && (
                  <div className="slide-examples">
                    {slide.examples.map((x, j) => (
                      <div key={j} className="slide-ex">
                        <button className="speak-round sm" onClick={() => void speak(x.es, accent)} aria-label="השמעה">
                          <IconSpeaker />
                        </button>
                        <div className="stack grow">
                          <EsText text={x.es} lesson={lesson} onWord={show} />
                          <span className="example-he">{x.he}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {slide.tip && (
                  <div className="word-note">
                    <Emoji3D emoji="💡" size={24} eager />
                    <span>
                      <RichText text={slide.tip} />
                    </span>
                  </div>
                )}
                {i === 1 && <p className="tiny muted center" style={{ margin: 0 }}>{g(gen, "טיפ: לחץ על מילה בספרדית כדי לראות מה היא אומרת", "טיפ: לחצי על מילה בספרדית כדי לראות מה היא אומרת")}</p>}
              </section>
            )
          )}
        </motion.div>
      </AnimatePresence>

      <GlossBubble gloss={gloss} accent={accent} />

      <div className="lesson-cta">
        {i < pages - 1 ? (
          <button className="btn btn-primary btn-block" onClick={() => go(i + 1)}>
            {i === 0 ? "בוא נתחיל" : "הבא"}
          </button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={onQuiz}>
            לתרגול ({lesson.quiz.length} שאלות)
          </button>
        )}
        {i > 0 && (
          <button className="btn-link" onClick={() => go(i - 1)}>
            חזרה
          </button>
        )}
      </div>
    </div>
  );
}

function Quiz({ lesson, onRetry }: { lesson: Lesson; onRetry: () => void }) {
  const { profile, completeLesson, addActivity, lessons } = useStore();
  const { gloss, show: glossShow } = useGloss();
  const gen = profile!.gender;
  const [i, setI] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [result, setResult] = useState<null | boolean>(null);
  const [finished, setFinished] = useState(false);
  const [xp, setXp] = useState(0);
  const q = lesson.quiz[i];
  const advancing = useRef<number | null>(null);
  const answeredIdx = useRef<number | null>(null);

  function answered(ok: boolean) {
    if (answeredIdx.current === i) return;
    answeredIdx.current = i;
    setResult(ok);
    if (ok) {
      setCorrect((c) => c + 1);
      sfx.correct(correct);
      haptic(10);
    } else {
      sfx.wrong();
      haptic(40);
    }
  }

  async function next() {
    if (advancing.current === i) return;
    advancing.current = i;
    sfx.tap();
    if (i + 1 < lesson.quiz.length) {
      setI(i + 1);
      setResult(null);
      return;
    }
    const score = Math.round((correct / lesson.quiz.length) * 100);
    const earned = 15 + correct * 3;
    setXp(earned);
    setFinished(true);
    addActivity({ lessons: 1, xp: earned });
    sfx.complete();
    celebrate(score >= 70 ? "big" : "small");
    await completeLesson(lesson.id, score);
  }

  if (finished) {
    const score = Math.round((correct / lesson.quiz.length) * 100);
    const stars = starsFor(score);
    const idx = lessons.findIndex((l) => l.id === lesson.id);
    const nextLesson = lessons[idx + 1];
    return (
      <div className="summary stack gap-16">
        <motion.div className="summary-hero" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 14 }}>
          <Emoji3D emoji={lesson.emoji} size={120} eager />
        </motion.div>
        <div className="big-stars" aria-label={`${stars} כוכבים`}>
          {[0, 1, 2].map((s) => (
            <motion.span
              key={s}
              className={s < stars ? "on" : ""}
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.25 + s * 0.18, type: "spring", stiffness: 300, damping: 12 }}
            >
              ★
            </motion.span>
          ))}
        </div>
        <h1 className="summary-title es center">{score >= 90 ? "¡Increíble!" : score >= 70 ? "¡Muy bien!" : score >= 50 ? "¡Buen trabajo!" : "¡Casi!"}</h1>
        <p className="center muted" style={{ margin: 0 }}>
          {correct} מתוך {lesson.quiz.length} נכונות
          {score < 60 ? " · כדאי לעבור שוב על השיעור" : ""}
        </p>
        <div className="summary-xp card">
          <Emoji3D emoji="⚡" size={40} eager />
          <span className="summary-xp-num es">
            +<CountUp to={xp} />
          </span>
          <span className="muted">XP</span>
        </div>
        {score < 60 && (
          <button className="btn btn-primary btn-block" onClick={onRetry}>
            לעבור שוב על השיעור
          </button>
        )}
        {nextLesson ? (
          <button className={`btn btn-block ${score < 60 ? "btn-soft" : "btn-primary"}`} onClick={() => navigate(`/lesson/${nextLesson.id}`, { replace: true })}>
            לשיעור הבא: <RichText text={nextLesson.title} />
          </button>
        ) : (
          <button className="btn btn-sun btn-block" onClick={() => navigate("/talk", { replace: true })}>
            {g(gen, "סיימת הכול! לתרגל בשיחה", "סיימת הכול! לתרגל בשיחה")}
          </button>
        )}
        <button className="btn btn-ghost btn-block" onClick={() => navigate("/lessons", { replace: true })}>
          חזרה לשיעורים
        </button>
      </div>
    );
  }

  return (
    <div className="session quiz">
      <header className="session-top">
        <button className="icon-btn" aria-label="יציאה" onClick={() => navigate("/lessons", { replace: true })}>
          <IconClose />
        </button>
        <div className="bar grow">
          <span style={{ width: `${Math.max(4, (i / lesson.quiz.length) * 100)}%` }} />
        </div>
        <span className="small muted es">
          {i + 1}/{lesson.quiz.length}
        </span>
      </header>
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          className="session-body"
          initial={{ opacity: 0, x: -36 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 36 }}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
        >
          {q.type === "choice" ? <ChoiceQ q={q} result={result} onAnswer={answered} lesson={lesson} onWord={glossShow} /> : <BuildQ q={q} result={result} onAnswer={answered} />}
        </motion.div>
      </AnimatePresence>
      <GlossBubble gloss={gloss} accent={profile!.accent} />
      <AnimatePresence>
        {result !== null && (
          <motion.div
            className={`feedback ${result ? "good" : "bad"}`}
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            role="status"
          >
            <div className="row gap-12">
              <Emoji3D emoji={result ? "🎉" : "🤔"} size={44} eager />
              <div className="stack grow">
                <span className="feedback-title">{result ? <span className="es">¡Correcto!</span> : "כמעט"}</span>
                {q.type === "choice" ? (
                  <span className="small">
                    <RichText text={q.explain} />
                  </span>
                ) : (
                  !result && (
                    <span className="small">
                      התשובה: <b className="es">{q.answer}</b>
                    </span>
                  )
                )}
              </div>
            </div>
            <button className={`btn btn-block ${result ? "btn-good" : "btn-bad"}`} onClick={() => void next()} autoFocus>
              {i + 1 < lesson.quiz.length ? "המשך" : "לסיום"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChoiceQ({ q, result, onAnswer, lesson, onWord }: { q: Extract<QuizItem, { type: "choice" }>; result: boolean | null; onAnswer: (ok: boolean) => void; lesson: Lesson; onWord: (es: string, he: string) => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <>
      <div className="card session-card q-card">
        <div className="q-ask big">
          <RichText text={q.q} />
        </div>
        {q.es && (
          <div className="q-sentence static">
            <EsText text={q.es} lesson={lesson} onWord={onWord} />
          </div>
        )}
      </div>
      <div className="options">
        {q.options.map((o, idx) => {
          const state = result === null ? "" : idx === q.answer ? "right" : idx === chosen ? "wrong" : "dim";
          return (
            <motion.button
              key={idx}
              className={`option ${state}`}
              disabled={result !== null}
              onClick={() => {
                setChosen(idx);
                onAnswer(idx === q.answer);
              }}
              animate={state === "wrong" ? { x: [0, -10, 10, -6, 6, 0] } : state === "right" ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 0.45 }}
            >
              <span className="option-label">
                <RichText text={o} />
              </span>
              {(state === "right" || state === "wrong") && <span className="option-mark">{state === "right" ? <IconCheck /> : <IconClose />}</span>}
            </motion.button>
          );
        })}
      </div>
    </>
  );
}

function BuildQ({ q, result, onAnswer }: { q: Extract<QuizItem, { type: "build" }>; result: boolean | null; onAnswer: (ok: boolean) => void }) {
  const bank = useMemo(() => shuffle([...q.tokens, ...(q.extra ?? [])].map((t, i) => ({ t, i }))), [q]);
  const [picked, setPicked] = useState<number[]>([]);
  const { profile } = useStore();
  const built = picked.map((i) => bank.find((b) => b.i === i)!.t).join(" ");

  function check() {
    const norm = (s: string) => s.toLowerCase().replace(/[¿¡]/g, "").trim();
    const ok = norm(built) === norm(q.answer);
    onAnswer(ok);
    if (ok) speak(q.answer, profile!.accent);
  }

  return (
    <>
      <div className="card session-card q-card">
        <div className="q-ask">{"תרגמו לספרדית:"}</div>
        <div className="q-he">{q.he}</div>
      </div>
      <LayoutGroup>
        <div className={`build-answer ${result === true ? "good" : result === false ? "bad" : ""}`} dir="ltr">
          {picked.length === 0 && <span className="build-placeholder">לחצו על המילים לפי הסדר</span>}
          {picked.map((i) => {
            const tok = bank.find((b) => b.i === i)!;
            return (
              <motion.button
                layoutId={`tok-${i}`}
                key={i}
                className="token es"
                disabled={result !== null}
                onClick={() => {
                  sfx.pop();
                  setPicked((p) => p.filter((x) => x !== i));
                }}
              >
                {tok.t}
              </motion.button>
            );
          })}
        </div>
        <div className="build-bank" dir="ltr">
          {bank.map((b) =>
            picked.includes(b.i) ? (
              <span key={b.i} className="token ghost es" aria-hidden="true">
                {b.t}
              </span>
            ) : (
              <motion.button
                layoutId={`tok-${b.i}`}
                key={b.i}
                className="token es"
                disabled={result !== null}
                onClick={() => {
                  sfx.pop();
                  setPicked((p) => [...p, b.i]);
                }}
              >
                {b.t}
              </motion.button>
            ),
          )}
        </div>
      </LayoutGroup>
      {result === null && (
        <div className="session-actions">
          <button className="btn btn-primary btn-block" onClick={check} disabled={picked.length === 0}>
            בדיקה
          </button>
        </div>
      )}
    </>
  );
}
