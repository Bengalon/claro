import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../lib/store";
import { Orb } from "../components/Orb";
import { Emoji3D } from "../components/Emoji3D";
import { celebrate } from "../components/ui";
import { sfx } from "../lib/sound";
import { toast } from "../lib/toast";
import type { Gender } from "../lib/types";

const GOALS = [
  { n: 5, label: "קליל", sub: "כ-5 דקות ביום" },
  { n: 10, label: "רגיל", sub: "כ-10 דקות ביום" },
  { n: 15, label: "רציני", sub: "כ-15 דקות ביום" },
  { n: 20, label: "אינטנסיבי", sub: "כ-20 דקות ביום" },
];

export default function Onboarding() {
  const { profile, updateProfile } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [gender, setGender] = useState<Gender>(profile?.gender ?? "m");
  const [accent, setAccent] = useState<"latam" | "spain">(profile?.accent ?? "latam");
  const [tutor, setTutor] = useState<Gender>(profile?.tutor_voice ?? "f");
  const [goal, setGoal] = useState(profile?.daily_new ?? 10);
  const [saving, setSaving] = useState(false);
  const total = 6;
  const f = gender === "f";

  const next = () => {
    sfx.tap();
    setStep((s) => Math.min(total - 1, s + 1));
  };

  async function finish() {
    setSaving(true);
    const ok = await updateProfile({
      display_name: name.trim() || (f ? "אמיגה" : "אמיגו"),
      gender,
      accent,
      tutor_voice: tutor,
      daily_new: goal,
      onboarded: true,
    });
    setSaving(false);
    if (!ok) {
      toast("לא הצלחנו לשמור. בדקו את החיבור ונסו שוב.", "error");
      return;
    }
    sfx.complete();
    celebrate("big");
  }

  return (
    <main className="frame no-tabs onboarding">
      <div className="ob-progress" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={i <= step ? "on" : ""} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={step}
          className="ob-step"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {step === 0 && (
            <>
              <div className="ob-visual floaty">
                <Orb size={160} mode="happy" />
              </div>
              <h1 className="ob-title es">¡Hola!</h1>
              <p className="ob-lead">ככה זה עובד ב-Claro:</p>
              <ul className="ob-list">
                <li>
                  <Emoji3D emoji="📚" size={44} eager />
                  <span>לומדים את 1,000 המילים הכי נפוצות, תמיד בתוך משפט ועם תמונה</span>
                </li>
                <li>
                  <Emoji3D emoji="🧩" size={44} eager />
                  <span>שיעורים קצרים שמלמדים לבנות משפטים</span>
                </li>
                <li>
                  <Emoji3D emoji="🎙️" size={44} eager />
                  <span>מדברים בקול עם מורה AI שמתאים את עצמו לרמה שלך</span>
                </li>
              </ul>
              <button className="btn btn-primary btn-block" onClick={next}>
                יאללה, מתחילים
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <div className="ob-visual">
                <Emoji3D emoji="👋" size={110} eager />
              </div>
              <h1 className="ob-title">איך קוראים לך?</h1>
              <p className="ob-lead">ככה המורה תפנה אליך בשיחה.</p>
              <input
                className="input ob-input"
                value={name}
                maxLength={30}
                onChange={(e) => setName(e.target.value)}
                placeholder="השם שלך"
                autoFocus
              />
              <button className="btn btn-primary btn-block" onClick={next} disabled={!name.trim()}>
                המשך
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="ob-title">איך לפנות אליך?</h1>
              <p className="ob-lead">בספרדית יש זכר ונקבה גם בתארים, למשל cansado או cansada. כך נלמד אותך את הצורה הנכונה.</p>
              <div className="ob-choices two">
                <Choice active={gender === "m"} onClick={() => setGender("m")} emoji="🙋‍♂️" title="בלשון זכר" sub="estoy listo" />
                <Choice active={gender === "f"} onClick={() => setGender("f")} emoji="🙋‍♀️" title="בלשון נקבה" sub="estoy lista" />
              </div>
              <button className="btn btn-primary btn-block" onClick={next}>
                המשך
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="ob-title">איזו ספרדית?</h1>
              <p className="ob-lead">משפיע על המבטא של ההקראה ושל המורה. אפשר לשנות אחר כך.</p>
              <div className="ob-choices two">
                <Choice active={accent === "latam"} onClick={() => setAccent("latam")} emoji="🌎" title="אמריקה הלטינית" sub="מקסיקו, קולומביה, ארגנטינה" />
                <Choice active={accent === "spain"} onClick={() => setAccent("spain")} emoji="🌍" title="ספרד" sub="מדריד, ברצלונה" />
              </div>
              <button className="btn btn-primary btn-block" onClick={next}>
                המשך
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="ob-title">עם מי בא לך לדבר?</h1>
              <p className="ob-lead">המורה הקולי שלך. {f ? "תוכלי" : "תוכל"} להחליף בכל רגע.</p>
              <div className="ob-choices two">
                <button className={`ob-choice ${tutor === "f" ? "active" : ""}`} onClick={() => setTutor("f")} aria-pressed={tutor === "f"}>
                  <Orb size={78} mode={tutor === "f" ? "happy" : "idle"} />
                  <span className="ob-choice-title es">Lucía</span>
                  <span className="ob-choice-sub">קול נשי</span>
                </button>
                <button className={`ob-choice ${tutor === "m" ? "active" : ""}`} onClick={() => setTutor("m")} aria-pressed={tutor === "m"}>
                  <Orb size={78} mode={tutor === "m" ? "happy" : "idle"} />
                  <span className="ob-choice-title es">Mateo</span>
                  <span className="ob-choice-sub">קול גברי</span>
                </button>
              </div>
              <button className="btn btn-primary btn-block" onClick={next}>
                המשך
              </button>
            </>
          )}

          {step === 5 && (
            <>
              <div className="ob-visual">
                <Emoji3D emoji="🎯" size={104} eager />
              </div>
              <h1 className="ob-title">כמה מילים חדשות ביום?</h1>
              <p className="ob-lead">
                ב-{goal} מילים ביום {f ? "תגיעי" : "תגיע"} ל-1,000 מילים תוך כ-{Math.ceil(1000 / goal)} ימים. החזרות על מילים קודמות מגיעות בנוסף.
              </p>
              <div className="ob-goals">
                {GOALS.map((x) => (
                  <button key={x.n} className={`ob-goal ${goal === x.n ? "active" : ""}`} onClick={() => setGoal(x.n)} aria-pressed={goal === x.n}>
                    <span className="ob-goal-n es">{x.n}</span>
                    <span className="ob-goal-label">{x.label}</span>
                    <span className="ob-goal-sub">{x.sub}</span>
                  </button>
                ))}
              </div>
              <button className="btn btn-sun btn-block" onClick={finish} disabled={saving}>
                {saving ? "שומרים…" : "¡Vamos!"}
              </button>
            </>
          )}
        </motion.section>
      </AnimatePresence>

      {step > 0 && (
        <button className="ob-back" onClick={() => setStep((s) => Math.max(0, s - 1))}>
          חזרה
        </button>
      )}
    </main>
  );
}

function Choice(p: { active: boolean; onClick: () => void; emoji: string; title: string; sub: string }) {
  return (
    <button className={`ob-choice ${p.active ? "active" : ""}`} onClick={p.onClick} aria-pressed={p.active}>
      <Emoji3D emoji={p.emoji} size={72} eager />
      <span className="ob-choice-title">{p.title}</span>
      <span className="ob-choice-sub" lang={p.sub.match(/[a-z]/) ? "es" : undefined}>
        {p.sub}
      </span>
    </button>
  );
}
