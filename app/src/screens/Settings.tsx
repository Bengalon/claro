import { useState } from "react";
import { useStore } from "../lib/store";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import { speak } from "../lib/tts";
import { sfx } from "../lib/sound";
import { g } from "../lib/util";
import type { Profile } from "../lib/types";
import { Sheet, TopBar } from "../components/ui";
import { Emoji3D } from "../components/Emoji3D";

export default function Settings() {
  const { profile, updateProfile, signOut, user } = useStore();
  const p = profile!;
  const [name, setName] = useState(p.display_name);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  async function save(patch: Partial<Profile>, msg = "נשמר") {
    const ok = await updateProfile(patch);
    toast(ok ? msg : "לא הצלחנו לשמור. נסו שוב.", ok ? "good" : "error");
  }

  async function changePw() {
    if (pw.length < 8) {
      toast("הסיסמה צריכה להיות לפחות 8 תווים", "error");
      return;
    }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) toast("לא הצלחנו לשנות את הסיסמה", "error");
    else {
      toast("הסיסמה עודכנה", "good");
      setPw("");
      setPwOpen(false);
    }
  }

  return (
    <div className="stack gap-16 settings">
      <TopBar title="הגדרות" />

      <section className="card set-card stack gap-12">
        <div className="field">
          <label htmlFor="nm">השם שלך</label>
          <div className="row gap-8">
            <input id="nm" className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-soft btn-sm" disabled={!name.trim() || name.trim() === p.display_name} onClick={() => void save({ display_name: name.trim() })}>
              שמירה
            </button>
          </div>
        </div>
        <div className="small muted" dir="ltr" style={{ textAlign: "right" }}>
          {user?.email}
        </div>
      </section>

      <section className="card set-card stack gap-16">
        <SegRow label="איך לפנות אליך" value={p.gender} options={[["m", "זכר"], ["f", "נקבה"]]} onChange={(v) => void save({ gender: v as "m" | "f" })} />
        <SegRow
          label="מבטא"
          value={p.accent}
          options={[["latam", "אמריקה הלטינית"], ["spain", "ספרד"]]}
          onChange={(v) => {
            void save({ accent: v as "latam" | "spain" });
            window.setTimeout(() => speak("¡Hola! ¿Qué tal?", v as "latam" | "spain"), 150);
          }}
        />
        <SegRow label="המורה הקולי" value={p.tutor_voice} options={[["f", "Lucía"], ["m", "Mateo"]]} onChange={(v) => void save({ tutor_voice: v as "m" | "f" })} />
        <SegRow
          label="מילים חדשות ביום"
          value={String(p.daily_new)}
          options={[["5", "5"], ["10", "10"], ["15", "15"], ["20", "20"], ["30", "30"]]}
          onChange={(v) => void save({ daily_new: Number(v) })}
        />
      </section>

      <section className="card set-card stack gap-4">
        <ToggleRow
          emoji="🔊"
          title="צלילים"
          sub="צלילים קטנים כשעונים נכון או מסיימים"
          checked={p.sound_on}
          onChange={(v) => {
            void save({ sound_on: v });
            if (v) window.setTimeout(() => sfx.correct(0), 50);
          }}
        />
        <ToggleRow
          emoji="🏆"
          title="להופיע בטבלת החבר׳ה"
          sub="מציג רק שם, XP ורצף ימים"
          checked={p.show_in_board}
          onChange={(v) => void save({ show_in_board: v })}
        />
      </section>

      <section className="card set-card stack gap-8">
        <div className="row gap-12">
          <Emoji3D emoji="🎙️" size={34} />
          <div className="stack grow">
            <span className="h3">דקות שיחה ביום</span>
            <span className="small muted">{p.voice_daily_minutes} דקות. רק מנהל האפליקציה יכול לשנות.</span>
          </div>
        </div>
      </section>

      <button className="btn btn-soft btn-block" onClick={() => setInstallOpen(true)}>
        להוסיף את Claro למסך הבית
      </button>
      <button className="btn btn-ghost btn-block" onClick={() => setPwOpen(true)}>
        שינוי סיסמה
      </button>
      <button className="btn btn-ghost btn-block" onClick={() => void signOut()}>
        התנתקות
      </button>
      <p className="tiny muted center" style={{ margin: "4px 0 0" }}>
        קולות ההגייה: Piper (קוד פתוח). איורים: Microsoft Fluent Emoji.
      </p>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)}>
        <div className="stack gap-16">
          <h2 className="h2">סיסמה חדשה</h2>
          <input className="input" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="לפחות 8 תווים" />
          <button className="btn btn-primary btn-block" disabled={pwBusy} onClick={() => void changePw()}>
            {pwBusy ? "שומרים…" : "שמירת הסיסמה"}
          </button>
        </div>
      </Sheet>

      <Sheet open={installOpen} onClose={() => setInstallOpen(false)}>
        <div className="stack gap-12">
          <h2 className="h2">להוסיף למסך הבית</h2>
          <p style={{ margin: 0 }}>
            <b>באייפון (Safari):</b> {g(p.gender, "לחץ", "לחצי")} על כפתור השיתוף בתחתית המסך, ואז על „הוספה למסך הבית”.
          </p>
          <p style={{ margin: 0 }}>
            <b>באנדרואיד (Chrome):</b> {g(p.gender, "לחץ", "לחצי")} על שלוש הנקודות למעלה, ואז על „הוספה למסך הבית”.
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            האפליקציה תיפתח במסך מלא, כמו אפליקציה רגילה.
          </p>
        </div>
      </Sheet>
    </div>
  );
}

function SegRow({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} aria-pressed={value === v} onClick={() => value !== v && onChange(v)} lang={/^[A-Za-z]/.test(l) ? "es" : undefined}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ emoji, title, sub, checked, onChange }: { emoji: string; title: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <Emoji3D emoji={emoji} size={34} />
      <span className="grow">
        <span className="h3" style={{ display: "block" }}>
          {title}
        </span>
        <span className="small muted">{sub}</span>
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
