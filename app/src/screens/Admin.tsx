import { useCallback, useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { callFunction } from "../lib/supabase";
import { toast } from "../lib/toast";
import { Loading, Sheet, TopBar } from "../components/ui";

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  gender: "m" | "f";
  xp: number;
  voice_daily_minutes: number;
  is_admin: boolean;
  last_active: string | null;
}

const ERRORS: Record<string, string> = {
  bad_email: "האימייל לא תקין",
  short_password: "הסיסמה צריכה להיות לפחות 8 תווים",
  email_exists: "כבר יש משתמש עם האימייל הזה",
  create_failed: "לא הצלחנו ליצור את המשתמש",
  update_failed: "לא הצלחנו לעדכן",
  forbidden: "אין לך הרשאת ניהול",
};

function genPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => chars[x % chars.length]).join("");
}

export default function Admin() {
  const { profile } = useStore();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ display_name: "", email: "", password: genPassword(), gender: "m" as "m" | "f" });
  const [busy, setBusy] = useState(false);
  const [pwFor, setPwFor] = useState<AdminUser | null>(null);
  const [newPw, setNewPw] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const r = await callFunction<{ users: AdminUser[] }>("admin-users", { action: "list" });
    if (r.ok && r.data) setUsers(r.data.users);
    else toast(ERRORS[(r.data as { error?: string } | null)?.error ?? ""] ?? "לא הצלחנו לטעון את המשתמשים", "error");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!profile?.is_admin) {
    return (
      <div className="stack gap-16">
        <TopBar title="ניהול משתמשים" />
        <p className="muted">העמוד הזה זמין רק למנהל האפליקציה.</p>
      </div>
    );
  }

  async function create() {
    setBusy(true);
    const r = await callFunction<{ error?: string }>("admin-users", { action: "create", ...form });
    setBusy(false);
    if (!r.ok) {
      toast(ERRORS[r.data?.error ?? ""] ?? "משהו השתבש", "error");
      return;
    }
    setCreated({ email: form.email.trim().toLowerCase(), password: form.password });
    setAddOpen(false);
    setForm({ display_name: "", email: "", password: genPassword(), gender: "m" });
    void load();
  }

  async function setMinutes(u: AdminUser, minutes: number) {
    const r = await callFunction("admin-users", { action: "set_voice_minutes", userId: u.id, minutes });
    if (r.ok) {
      toast("עודכן", "good");
      setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, voice_daily_minutes: minutes } : x)) ?? null);
    } else toast("לא הצלחנו לעדכן", "error");
  }

  async function resetPw() {
    if (!pwFor) return;
    const r = await callFunction<{ error?: string }>("admin-users", { action: "set_password", userId: pwFor.id, password: newPw });
    if (r.ok) {
      setCreated({ email: pwFor.email, password: newPw });
      setPwFor(null);
    } else toast(ERRORS[r.data?.error ?? ""] ?? "לא הצלחנו לעדכן", "error");
  }

  return (
    <div className="stack gap-16">
      <TopBar
        title="ניהול משתמשים"
        right={
          <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
            הוספה
          </button>
        }
      />
      {!users && <Loading />}
      {users?.map((u) => (
        <section key={u.id} className="card set-card stack gap-12">
          <div className="row gap-12">
            <div className={`avatar avatar-${u.gender}`} aria-hidden="true">
              {(u.display_name || u.email).slice(0, 1)}
            </div>
            <div className="stack grow" style={{ minWidth: 0 }}>
              <span className="h3">
                {u.display_name || "ללא שם"}
                {u.is_admin ? " (מנהל)" : ""}
              </span>
              <span className="small muted" dir="ltr" style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
                {u.email}
              </span>
            </div>
            <span className="chip chip-violet es">{u.xp} XP</span>
          </div>
          <div className="small muted">פעילות אחרונה: {u.last_active ? new Date(u.last_active).toLocaleDateString("he-IL") : "עוד לא"}</div>
          <div className="field">
            <label>דקות שיחה ביום</label>
            <div className="seg">
              {[0, 10, 20, 30, 45].map((m) => (
                <button key={m} aria-pressed={u.voice_daily_minutes === m} onClick={() => u.voice_daily_minutes !== m && void setMinutes(u, m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setNewPw(genPassword());
              setPwFor(u);
            }}
          >
            איפוס סיסמה
          </button>
        </section>
      ))}

      <Sheet open={addOpen} onClose={() => setAddOpen(false)}>
        <div className="stack gap-12">
          <h2 className="h2">משתמש חדש</h2>
          <div className="field">
            <label htmlFor="an">שם</label>
            <input id="an" className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ae">אימייל</label>
            <input id="ae" className="input" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ap">סיסמה ראשונית</label>
            <div className="row gap-8">
              <input id="ap" className="input es" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button className="btn btn-soft btn-sm" onClick={() => setForm({ ...form, password: genPassword() })}>
                חדשה
              </button>
            </div>
          </div>
          <div className="field">
            <label>פנייה</label>
            <div className="seg">
              <button aria-pressed={form.gender === "m"} onClick={() => setForm({ ...form, gender: "m" })}>
                זכר
              </button>
              <button aria-pressed={form.gender === "f"} onClick={() => setForm({ ...form, gender: "f" })}>
                נקבה
              </button>
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !form.email || form.password.length < 8} onClick={() => void create()}>
            {busy ? "יוצרים…" : "יצירת משתמש"}
          </button>
        </div>
      </Sheet>

      <Sheet open={!!pwFor} onClose={() => setPwFor(null)}>
        <div className="stack gap-12">
          <h2 className="h2">סיסמה חדשה ל{pwFor?.display_name || pwFor?.email}</h2>
          <input className="input es" dir="ltr" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <button className="btn btn-primary btn-block" disabled={newPw.length < 8} onClick={() => void resetPw()}>
            עדכון סיסמה
          </button>
        </div>
      </Sheet>

      <Sheet open={!!created} onClose={() => setCreated(null)}>
        <div className="stack gap-12">
          <h2 className="h2">פרטי הכניסה</h2>
          <p className="muted" style={{ margin: 0 }}>
            שלחו את הפרטים למשתמש. אחרי הכניסה הוא יכול לשנות סיסמה בהגדרות.
          </p>
          <div className="card set-card es" dir="ltr" style={{ userSelect: "all" }}>
            {created?.email}
            <br />
            {created?.password}
          </div>
          <button
            className="btn btn-soft btn-block"
            onClick={() => {
              void navigator.clipboard?.writeText(`${created?.email}\n${created?.password}`).then(
                () => toast("הועתק", "good"),
                () => toast("לא הצלחנו להעתיק", "error"),
              );
            }}
          >
            העתקה
          </button>
        </div>
      </Sheet>
    </div>
  );
}
