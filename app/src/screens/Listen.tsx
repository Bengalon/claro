import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import { supabase } from "../lib/supabase";
import { sfx } from "../lib/sound";
import { toast } from "../lib/toast";
import { g } from "../lib/util";
import { Emoji3D } from "../components/Emoji3D";
import { celebrate, Sheet, TopBar } from "../components/ui";
import { IconExternal } from "../components/Icons";

// Listening milestones (hours of understandable input), after the Dreaming Spanish roadmap.
const LEVELS = [
  { h: 0, title: "מתחילים מאפס" },
  { h: 50, title: "מכירים מילים נפוצות" },
  { h: 150, title: "עוקבים אחרי נושאים מותאמים" },
  { h: 300, title: "מבינים דוברים סבלניים" },
  { h: 600, title: "מבינים דיבור רגיל" },
  { h: 1000, title: "נוח בשיחה יומיומית" },
  { h: 1500, title: "כמעט כמו דוברי השפה" },
];

const yt = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const RESOURCES = [
  {
    level: "מתחילים",
    items: [
      { emoji: "🎬", title: "Dreaming Spanish — Superbeginner", sub: "סרטונים בספרדית פשוטה מאוד, עם הרבה ציורים", url: "https://www.dreamingspanish.com" },
      { emoji: "🎧", title: "Language Transfer — Complete Spanish", sub: "קורס שמע חינמי שמלמד לבנות משפטים", url: "https://www.languagetransfer.org" },
      { emoji: "📺", title: "Extr@ en español", sub: "סיטקום שנכתב במיוחד ללומדים", url: yt("Extra en español capítulo 1") },
    ],
  },
  {
    level: "בינוניים",
    items: [
      { emoji: "🎙️", title: "Duolingo Spanish Podcast", sub: "סיפורים אמיתיים בספרדית איטית עם קריין באנגלית", url: "https://podcast.duolingo.com" },
      { emoji: "🚶", title: "Easy Spanish", sub: "ראיונות ברחוב עם כתוביות", url: yt("Easy Spanish street interviews") },
      { emoji: "🎵", title: "שירים עם מילים", sub: "לשמוע ולקרוא יחד את המילים בספרדית", url: yt("canciones en español con letra") },
    ],
  },
  {
    level: "מתקדמים",
    items: [
      { emoji: "🍿", title: "סדרות בספרדית", sub: "עם כתוביות בספרדית, לא בעברית", url: "https://www.netflix.com/search?q=spanish" },
      { emoji: "📻", title: "פודקאסטים לדוברי ספרדית", sub: "נושאים שמעניינים אותך, בקצב אמיתי", url: yt("podcast en español") },
    ],
  },
];

export default function Listen() {
  const { profile, logListen } = useStore();
  const gen = profile!.gender;
  const [totalMin, setTotalMin] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [customMin, setCustomMin] = useState("15");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("input_log")
      .select("minutes")
      .then(({ data }) => setTotalMin((data ?? []).reduce((s, r) => s + r.minutes, 0)));
  }, []);

  const hours = (totalMin ?? 0) / 60;
  const lvlIdx = LEVELS.reduce((acc, l, i) => (hours >= l.h ? i : acc), 0);
  const nextLvl = LEVELS[lvlIdx + 1];
  const prog = nextLvl ? (hours - LEVELS[lvlIdx].h) / (nextLvl.h - LEVELS[lvlIdx].h) : 1;

  async function add(min: number, source = "") {
    if (!min || min < 1 || busy) return;
    setBusy(true);
    const ok = await logListen(min, source);
    setBusy(false);
    if (!ok) {
      toast("לא הצלחנו לשמור. נסו שוב.", "error");
      return;
    }
    const before = (totalMin ?? 0) / 60;
    const after = ((totalMin ?? 0) + min) / 60;
    setTotalMin((t) => (t ?? 0) + min);
    const crossed = LEVELS.some((l) => l.h > 0 && before < l.h && after >= l.h);
    if (crossed) {
      sfx.levelUp();
      celebrate("big");
      toast("עלית שלב בהקשבה!", "good");
    } else {
      sfx.correct(0);
      toast(`נוספו ${min} דקות הקשבה`, "good");
    }
  }

  return (
    <div className="stack gap-16">
      <TopBar title="להקשיב" />
      <section className="card listen-hero">
        <div className="row gap-16">
          <Emoji3D emoji="🎧" size={72} eager />
          <div className="stack grow">
            <span className="small muted">{g(gen, "הקשבת עד עכשיו", "הקשבת עד עכשיו")}</span>
            <span className="coverage-num es">{totalMin === null ? "…" : hours < 10 ? hours.toFixed(1) : Math.round(hours)}</span>
            <span className="small muted">שעות</span>
          </div>
        </div>
        <div className="stack gap-8" style={{ marginTop: 14 }}>
          <div className="row between small">
            <b>{LEVELS[lvlIdx].title}</b>
            {nextLvl && <span className="muted">הבא: {nextLvl.h} שעות</span>}
          </div>
          <div className="bar">
            <span style={{ width: `${Math.max(3, prog * 100)}%` }} />
          </div>
        </div>
        <p className="small muted" style={{ margin: "12px 0 0" }}>
          {g(gen, "הקשבת, ראית סרטון או פודקאסט בספרדית? תוסיף כאן:", "הקשבת, ראית סרטון או פודקאסט בספרדית? תוסיפי כאן:")}
        </p>
        <div className="listen-add">
          {[10, 20, 30, 45].map((m) => (
            <motion.button key={m} whileTap={{ scale: 0.92 }} className="btn btn-soft btn-sm" disabled={busy} onClick={() => void add(m)}>
              <bdi dir="ltr">+{m}</bdi> דק׳
            </motion.button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setCustom(true)}>
            אחר
          </button>
        </div>
      </section>

      <p className="small muted" style={{ margin: 0 }}>
        הכי טוב להקשיב לתוכן שמבינים ממנו בערך 80%. כשזה נהיה קל, עוברים לרמה הבאה.
      </p>

      {RESOURCES.map((grp) => (
        <section key={grp.level} className="stack gap-8">
          <h2 className="h3">{grp.level}</h2>
          {grp.items.map((r) => (
            <a key={r.title} className="resource card" href={r.url} target="_blank" rel="noopener noreferrer">
              <Emoji3D emoji={r.emoji} size={44} />
              <span className="stack grow">
                <span className="resource-title" dir="auto">
                  {r.title}
                </span>
                <span className="small muted">{r.sub}</span>
              </span>
              <IconExternal className="resource-ext" />
            </a>
          ))}
        </section>
      ))}

      <Sheet open={custom} onClose={() => setCustom(false)}>
        <div className="stack gap-16">
          <h2 className="h2">כמה דקות הקשבת?</h2>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            value={customMin}
            onChange={(e) => setCustomMin(e.target.value)}
          />
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              const n = Math.round(Number(customMin));
              if (n >= 1 && n <= 600) {
                setCustom(false);
                void add(n);
              } else toast("אפשר להוסיף בין 1 ל-600 דקות", "error");
            }}
          >
            הוספה
          </button>
        </div>
      </Sheet>
    </div>
  );
}
