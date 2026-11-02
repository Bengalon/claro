import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { supabase } from "../lib/supabase";
import { Orb } from "../components/Orb";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      if (/invalid/i.test(error.message)) setError("האימייל או הסיסמה לא נכונים. נסו שוב.");
      else if (/fetch|network/i.test(error.message)) setError("אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.");
      else setError("לא הצלחנו להתחבר. נסו שוב בעוד רגע.");
    }
  }

  return (
    <main className="frame no-tabs login">
      <motion.div
        className="login-hero"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="floaty">
          <Orb size={150} mode="happy" />
        </div>
        <div className="wordmark es" aria-label="Claro">
          Claro
        </div>
        <p className="login-tag">ספרדית לשיחות אמיתיות. מילה אחרי מילה, עד שזה פשוט יוצא לך.</p>
      </motion.div>

      <motion.form
        className="card login-card stack gap-16"
        onSubmit={submit}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="field">
          <label htmlFor="email">אימייל</label>
          <input
            id="email"
            className="input"
            type="email"
            dir="ltr"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pw">סיסמה</label>
          <input
            id="pw"
            className="input"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy ? <span className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} /> : "כניסה"}
        </button>
        <p className="tiny muted center" style={{ margin: 0 }}>
          האפליקציה פרטית. חשבון חדש נפתח רק על ידי מנהל האפליקציה.
        </p>
      </motion.form>
    </main>
  );
}
