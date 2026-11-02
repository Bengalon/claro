import { useMemo } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { todayPlan } from "../lib/plan";
import { isKnown } from "../lib/srs";
import { g } from "../lib/util";
import { Emoji3D } from "../components/Emoji3D";
import { EXTRA_NEW_KEY, PRACTICE_KEY, PRACTICE_SIZE, REVIEW_ONLY_KEY } from "./Session";

export default function WordsHub() {
  const { profile, cards, words, today, newToday, knownCount } = useStore();
  const p = profile!;
  const plan = todayPlan({ cards, dailyNew: p.daily_new, newToday, reviewsDone: today.reviews, totalWords: words.length });
  const learning = [...cards.values()].filter((c) => c.state === 0).length;

  const bands = useMemo(() => {
    const out: { from: number; to: number; known: number; started: number; size: number }[] = [];
    for (let i = 0; i < words.length; i += 100) {
      const slice = words.slice(i, i + 100);
      let known = 0;
      let started = 0;
      for (const w of slice) {
        const c = cards.get(w.id);
        if (c) started++;
        if (isKnown(c)) known++;
      }
      out.push({ from: i + 1, to: i + slice.length, known, started, size: slice.length });
    }
    return out;
  }, [words, cards]);

  const start = (opts: { extra?: number; reviewOnly?: boolean; practice?: number } = {}) => {
    if (opts.extra) sessionStorage.setItem(EXTRA_NEW_KEY, String(opts.extra));
    if (opts.reviewOnly) sessionStorage.setItem(REVIEW_ONLY_KEY, "1");
    if (opts.practice) sessionStorage.setItem(PRACTICE_KEY, String(opts.practice));
    navigate("/words/session");
  };

  const nothing = plan.due === 0 && plan.newLeft === 0;
  const total = words.length || 1000;

  return (
    <div className="stack gap-16">
      <h1 className="h1">מילים</h1>

      <motion.section className="card words-today" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="h3">{nothing ? "סיימת את המילים של היום" : "המילים של היום"}</h2>
        {!nothing && (
          <div className="today-items">
            <div className="today-item">
              <Emoji3D emoji="🔁" size={36} eager />
              <span className="today-num es">{plan.due}</span>
              <span className="today-label">לחזור עליהן</span>
            </div>
            <div className="today-item">
              <Emoji3D emoji="✨" size={36} eager />
              <span className="today-num es">{plan.newLeft}</span>
              <span className="today-label">מילים חדשות</span>
            </div>
          </div>
        )}
        {nothing ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              {g(p.gender, "כל הכבוד! אם בא לך, אפשר ללמוד עוד כמה.", "כל הכבוד! אם בא לך, אפשר ללמוד עוד כמה.")}
            </p>
            <button className="btn btn-primary btn-block" onClick={() => start({ extra: 10 })}>
              עוד 10 מילים חדשות
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-block" onClick={() => start()}>
              להתחיל ללמוד
            </button>
            <div className="today-links">
              {plan.due > 0 && (
                <button className="btn-link" onClick={() => start({ reviewOnly: true })}>
                  רק חזרות
                </button>
              )}
              <button className="btn-link" onClick={() => start({ extra: 10 })}>
                סבב של 10 מילים חדשות
              </button>
            </div>
          </>
        )}
      </motion.section>

      <motion.section className="card practice-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <div className="practice-head">
          <Emoji3D emoji="🧠" size={48} eager />
          <div className="stack">
            <h2 className="h3">חזרה על מילים שלמדתי</h2>
            <p className="small muted" style={{ margin: 0 }}>
              {knownCount > 0
                ? "תרגול כללי כדי לא לשכוח. מתחילים מהמילים שהכי קשות לך."
                : g(p.gender, "אחרי שתלמד כמה מילים, אפשר לחזור עליהן כאן.", "אחרי שתלמדי כמה מילים, אפשר לחזור עליהן כאן.")}
            </p>
          </div>
        </div>
        {knownCount > 0 && (
          <button className="btn btn-soft btn-block" onClick={() => start({ practice: PRACTICE_SIZE })}>
            {knownCount >= PRACTICE_SIZE ? `חזרה על ${PRACTICE_SIZE} מילים` : `חזרה על ${knownCount === 1 ? "המילה" : `${knownCount} המילים`} שלמדתי`}
          </button>
        )}
      </motion.section>

      <section className="card words-progress">
        <div className="row between">
          <span className="small muted">{g(p.gender, "מילים שאתה כבר יודע", "מילים שאת כבר יודעת")}</span>
          <span className="small muted">
            בלמידה: <b className="es">{learning}</b>
          </span>
        </div>
        <div className="words-progress-num">
          <span className="es">{knownCount}</span>
          <span className="words-progress-of">
            מתוך <span className="es">{total.toLocaleString("en-US")}</span>
          </span>
        </div>
        <div className="bar">
          <span style={{ width: `${Math.max(2, (knownCount / total) * 100)}%` }} />
        </div>
      </section>

      <section className="stack gap-12">
        <div className="row between">
          <h2 className="h3">כל המילים, מהנפוצה ביותר</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/dict")}>
            למילון
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          כל שורה היא 100 מילים. כשמסיימים שורה, היא נצבעת בירוק.
        </p>
        <div className="band-list card">
          {bands.map((b) => {
            const pct = b.known / b.size;
            const full = pct >= 0.999;
            return (
              <div key={b.from} className={`band-row ${full ? "full" : ""} ${b.started === 0 ? "untouched" : ""}`}>
                <span className="band-range es">
                  {b.from}–{b.to}
                </span>
                <div className="band-bar">
                  <span style={{ width: `${pct * 100}%` }} />
                </div>
                <span className="band-pct es">{full ? "✓" : `${Math.round(pct * 100)}%`}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
