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
    const texts: string[] = [];
    for (const b of lesson.blocks) if (b.type === "examples") texts.push(...b.items.map((x) => x.es));
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
  return phase === "read" ? <Read lesson={lesson} onQuiz={() => setPhase("quiz")} /> : <Quiz lesson={lesson} />;
}

function Read({ lesson, onQuiz }: { lesson: Lesson; onQuiz: () => void }) {
  const { profile, lessons } = useStore();
  const accent = profile!.accent;
  const idx = lessons.findIndex((l) => l.id === lesson.id);
  return (
    <div className="lesson stack gap-16">
      <TopBar title={<span className="small muted">שיעור {lesson.order} מתוך {lessons.length}</span>} onBack={() => navigate("/lessons", { replace: true })} />
      <motion.header className="lesson-head" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="floaty">
          <Emoji3D emoji={lesson.emoji} size={96} eager />
        </div>
        <h1 className="h1">
          <RichText text={lesson.title} />
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          {lesson.summary}
        </p>
        <span className="chip">⏱ {lesson.minutes} דקות</span>
      </motion.header>

      {lesson.blocks.map((b, i) => (
        <motion.section
          key={i}
          className={`lesson-block block-${b.type}`}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-30px" }}
          transition={{ duration: 0.4 }}
        >
          {b.type === "text" && (
            <p className="lesson-text">
              <RichText text={b.he} />
            </p>
          )}
          {b.type === "tip" && (
            <div className="lesson-tip">
              <Emoji3D emoji="💡" size={34} />
              <p>
                <RichText text={b.he} />
              </p>
            </div>
          )}
          {b.type === "table" && (
            <div className="table-wrap card">
              <table className="lesson-table">
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th key={j}>
                        <RichText text={h} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((cell, k) => (
                        <td key={k}>
                          <RichText text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {b.type === "examples" && (
            <div className="lesson-examples">
              {b.items.map((x, j) => (
                <button key={j} className="example card" onClick={() => speak(x.es, accent)}>
                  <span className="example-es es">
                    {x.es}
                    <IconSpeaker className="example-speaker" />
                  </span>
                  <span className="example-he">{x.he}</span>
                </button>
              ))}
            </div>
          )}
        </motion.section>
      ))}

      <div className="lesson-cta">
        <button className="btn btn-primary btn-block" onClick={onQuiz}>
          לתרגול ({lesson.quiz.length} שאלות)
        </button>
        {idx < lessons.length - 1 && (
          <button className="btn btn-ghost btn-block btn-sm" onClick={() => navigate(`/lesson/${lessons[idx + 1].id}`, { replace: true })}>
            לשיעור הבא בלי תרגול
          </button>
        )}
      </div>
    </div>
  );
}

function Quiz({ lesson }: { lesson: Lesson }) {
  const { profile, completeLesson, addActivity, lessons } = useStore();
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
        <h1 className="summary-title es center">{score >= 90 ? "¡Increíble!" : score >= 70 ? "¡Muy bien!" : "¡Buen trabajo!"}</h1>
        <p className="center muted" style={{ margin: 0 }}>
          {correct} מתוך {lesson.quiz.length} נכונות
        </p>
        <div className="summary-xp card">
          <Emoji3D emoji="⚡" size={40} eager />
          <span className="summary-xp-num es">
            +<CountUp to={xp} />
          </span>
          <span className="muted">XP</span>
        </div>
        {nextLesson ? (
          <button className="btn btn-primary btn-block" onClick={() => navigate(`/lesson/${nextLesson.id}`, { replace: true })}>
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
          {q.type === "choice" ? <ChoiceQ q={q} result={result} onAnswer={answered} /> : <BuildQ q={q} result={result} onAnswer={answered} />}
        </motion.div>
      </AnimatePresence>
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

function ChoiceQ({ q, result, onAnswer }: { q: Extract<QuizItem, { type: "choice" }>; result: boolean | null; onAnswer: (ok: boolean) => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <>
      <div className="card session-card q-card">
        <div className="q-ask big">
          <RichText text={q.q} />
        </div>
        {q.es && <div className="q-sentence es static">{q.es}</div>}
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
