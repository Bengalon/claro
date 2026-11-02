import { motion } from "motion/react";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { Emoji3D } from "../components/Emoji3D";
import { RichText } from "../components/RichText";

export function starsFor(score: number) {
  if (score >= 90) return 3;
  if (score >= 70) return 2;
  return 1;
}

export default function Lessons() {
  const { lessons, lessonsDone } = useStore();
  const nextIdx = lessons.findIndex((l) => !lessonsDone.has(l.id));
  const doneCount = lessonsDone.size;

  return (
    <div className="stack gap-16">
      <div className="stack gap-4">
        <h1 className="h1">שיעורים</h1>
        <p className="muted" style={{ margin: 0 }}>
          איך בונים משפט, צעד אחרי צעד. {doneCount} מתוך {lessons.length} הושלמו.
        </p>
      </div>
      <div className="path">
        {lessons.map((l, i) => {
          const done = lessonsDone.get(l.id);
          const current = i === nextIdx;
          return (
            <motion.button
              key={l.id}
              className={`path-row ${done ? "done" : ""} ${current ? "current" : ""}`}
              onClick={() => navigate(`/lesson/${l.id}`)}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ duration: 0.3 }}
            >
              <span className="path-node">
                {current && <span className="path-pulse" aria-hidden="true" />}
                <Emoji3D emoji={l.emoji} size={40} />
              </span>
              <span className="path-text">
                <span className="path-meta">
                  שיעור <span className="es">{l.order}</span>
                  {l.minutes ? <> · <span className="es">{l.minutes}</span> דק׳</> : null}
                </span>
                <span className="path-title">
                  <RichText text={l.title} />
                </span>
              </span>
              <span className="path-end">
                {done ? (
                  <span className="path-stars" aria-label={`${starsFor(done.best_score)} כוכבים`}>
                    {[0, 1, 2].map((s) => (
                      <span key={s} className={s < starsFor(done.best_score) ? "on" : ""}>
                        ★
                      </span>
                    ))}
                  </span>
                ) : current ? (
                  <span className="chip chip-violet">להתחיל</span>
                ) : null}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
