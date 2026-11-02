import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { todayPlan } from "../lib/plan";
import { addDays, g, greetingEs, localDay } from "../lib/util";
import { supabase } from "../lib/supabase";
import { Emoji3D } from "../components/Emoji3D";
import { Orb } from "../components/Orb";
import { Ring } from "../components/ui";
import { RichText } from "../components/RichText";

const DAYS_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

interface BoardRow {
  user_id: string;
  display_name: string;
  gender: string;
  week_xp: number;
  streak: number;
  is_me: boolean;
}

export default function Home() {
  const { profile, cards, words, lessons, lessonsDone, today, days, knownCount, coverage, streak, newToday } = useStore();
  const p = profile!;
  const gen = p.gender;
  const [board, setBoard] = useState<BoardRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.rpc("leaderboard").then(({ data }) => {
      if (alive && data) setBoard(data as BoardRow[]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const plan = todayPlan({ cards, dailyNew: p.daily_new, newToday, reviewsDone: today.reviews, totalWords: words.length });
  const nextLesson = lessons.find((l) => !lessonsDone.has(l.id)) ?? lessons[lessons.length - 1];
  const tutorName = p.tutor_voice === "m" ? "Mateo" : "Lucía";
  const firstName = p.display_name.split(" ")[0] || "";

  const week = useMemo(() => {
    const active = new Set(days.filter((d) => d.xp > 0).map((d) => d.day));
    const todayKey = localDay();
    return Array.from({ length: 7 }).map((_, i) => {
      const day = addDays(todayKey, i - 6);
      const [y, m, d] = day.split("-").map(Number);
      return { day, on: active.has(day), today: day === todayKey, label: DAYS_HE[new Date(y, m - 1, d).getDay()] };
    });
  }, [days]);

  const planDone = plan.total > 0 && plan.due === 0 && plan.newLeft === 0;
  const ctaLabel = planDone
    ? g(gen, "סיימת את התוכנית! בא לך לדבר?", "סיימת את התוכנית! בא לך לדבר?")
    : plan.done > 0
      ? "להמשיך"
      : g(gen, "בוא נתחיל", "בואי נתחיל");

  return (
    <div className="home stack gap-16">
      <header className="home-head row between">
        <div className="row gap-12">
          <div className={`avatar avatar-${gen}`} aria-hidden="true">
            {firstName.slice(0, 1)}
          </div>
          <div className="stack">
            <span className="small muted">{g(gen, "ברוך הבא", "ברוכה הבאה")}</span>
            <span className="h3">{firstName}</span>
          </div>
        </div>
        <button className="chip chip-sun streak-chip" onClick={() => navigate("/friends")} aria-label={`רצף של ${streak} ימים`}>
          <Emoji3D emoji="🔥" size={24} eager />
          <span className="es">{streak}</span>
        </button>
      </header>

      <motion.h1
        className="home-greet es"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {greetingEs()}!
      </motion.h1>

      <motion.section
        className="card today-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="row gap-16">
          <Ring value={plan.progress} size={112} stroke={12}>
            {planDone ? <Emoji3D emoji="🏆" size={50} eager /> : <span className="ring-pct es">{Math.round(plan.progress * 100)}%</span>}
          </Ring>
          <div className="stack gap-8 grow">
            <h2 className="h3">התוכנית של היום</h2>
            <PlanLine done={plan.due === 0} label={plan.due === 0 ? "אין חזרות שמחכות" : `${plan.due} חזרות מחכות`} />
            <PlanLine done={plan.newLeft === 0} label={plan.newLeft === 0 ? `${newToday} מילים חדשות היום` : `${plan.newLeft} מילים חדשות`} />
            <PlanLine done={today.talk_seconds >= 120} label={today.talk_seconds >= 120 ? `דיברת ${Math.round(today.talk_seconds / 60)} דק׳` : `שיחה קצרה עם ${tutorName}`} es={false} />
          </div>
        </div>
        <button
          className={`btn ${planDone ? "btn-sun" : "btn-primary"} btn-block`}
          style={{ marginTop: 18 }}
          onClick={() => navigate(planDone ? "/talk" : "/words/session")}
        >
          {ctaLabel}
        </button>
      </motion.section>

      <motion.button
        className="card coverage-card"
        onClick={() => navigate("/words")}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div className="stack">
            <span className="small muted">{g(gen, "אתה כבר מבין בערך", "את כבר מבינה בערך")}</span>
            <span className="coverage-num es">{coverage.toFixed(coverage < 10 ? 1 : 0)}%</span>
            <span className="small muted">מהמילים בשיחה יומיומית</span>
          </div>
          <div className="stack" style={{ alignItems: "flex-end" }}>
            <span className="coverage-words es">{knownCount}</span>
            <span className="tiny muted">מילים</span>
          </div>
        </div>
        <div className="coverage-track" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (coverage / 85) * 100)}%` }} />
        </div>
      </motion.button>

      <div className="tiles">
        <button className="tile tile-talk" onClick={() => navigate("/talk")}>
          <Orb size={56} />
          <span className="tile-title">לדבר עם {tutorName}</span>
          <span className="tile-sub">שיחה קולית בקצב שלך</span>
        </button>
        <button className="tile" onClick={() => navigate(nextLesson ? `/lesson/${nextLesson.id}` : "/lessons")}>
          <Emoji3D emoji={nextLesson?.emoji ?? "🧩"} size={52} eager />
          <span className="tile-title">{nextLesson ? <RichText text={nextLesson.title} /> : "שיעורים"}</span>
          <span className="tile-sub">{lessonsDone.size === lessons.length ? "חזרה על שיעור" : "השיעור הבא שלך"}</span>
        </button>
        <button className="tile" onClick={() => navigate("/listen")}>
          <Emoji3D emoji="🎧" size={52} eager />
          <span className="tile-title">להקשיב</span>
          <span className="tile-sub">סרטונים, פודקאסטים ומעקב שעות</span>
        </button>
        <button className="tile" onClick={() => navigate("/dict")}>
          <Emoji3D emoji="📖" size={52} eager />
          <span className="tile-title">המילון שלי</span>
          <span className="tile-sub">כל 1,000 המילים</span>
        </button>
      </div>

      <section className="card week-card">
        <div className="row between">
          <h2 className="h3">השבוע שלך</h2>
          <span className="small muted">{streak > 0 ? `${streak} ימים ברצף` : "היום מתחילים רצף"}</span>
        </div>
        <div className="week-row">
          {week.map((d) => (
            <div key={d.day} className={`week-day ${d.on ? "on" : ""} ${d.today ? "today" : ""}`}>
              <div className="week-dot">{d.on ? <Emoji3D emoji="🔥" size={26} eager /> : null}</div>
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      {board && board.length > 1 && (
        <button className="card board-mini" onClick={() => navigate("/friends")}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 className="h3">החבר׳ה השבוע</h2>
            <Emoji3D emoji="🏆" size={30} eager />
          </div>
          {board.slice(0, 3).map((r, i) => (
            <div key={r.user_id} className={`board-mini-row ${r.is_me ? "me" : ""}`}>
              <Emoji3D emoji={["🥇", "🥈", "🥉"][i]} size={28} eager />
              <span className="grow">{r.display_name || "חבר"}</span>
              <span className="es small">{r.week_xp} XP</span>
            </div>
          ))}
        </button>
      )}
    </div>
  );
}

function PlanLine({ done, label, es: _es }: { done: boolean; label: string; es?: boolean }) {
  return (
    <div className={`plan-line ${done ? "done" : ""}`}>
      <span className="plan-check" aria-hidden="true">
        {done ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : null}
      </span>
      <span>{label}</span>
    </div>
  );
}
