import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { supabase } from "../lib/supabase";
import { Emoji3D } from "../components/Emoji3D";
import { Loading, TopBar } from "../components/ui";

interface Row {
  user_id: string;
  display_name: string;
  gender: string;
  week_xp: number;
  total_xp: number;
  streak: number;
  is_me: boolean;
}

export default function Friends() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    supabase.rpc("leaderboard").then(({ data, error }) => {
      if (error) setErr(true);
      else setRows(data as Row[]);
    });
  }, []);

  return (
    <div className="stack gap-16">
      <TopBar title="החבר׳ה" />
      <p className="muted" style={{ margin: 0 }}>
        מי צבר הכי הרבה XP בשבעת הימים האחרונים.
      </p>
      {err && <div className="error-box">לא הצלחנו לטעון את הטבלה. נסו שוב מאוחר יותר.</div>}
      {!rows && !err && <Loading />}
      {rows && (
        <div className="stack gap-8">
          {rows.map((r, i) => (
            <motion.div
              key={r.user_id}
              className={`card board-row ${r.is_me ? "me" : ""}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <span className="board-rank">{i < 3 ? <Emoji3D emoji={["🥇", "🥈", "🥉"][i]} size={34} eager /> : <span className="es">{i + 1}</span>}</span>
              <div className={`avatar avatar-${r.gender === "f" ? "f" : "m"}`} aria-hidden="true">
                {(r.display_name || "?").slice(0, 1)}
              </div>
              <div className="stack grow">
                <span className="h3">
                  {r.display_name || "חבר"}
                  {r.is_me ? " (את/ה)" : ""}
                </span>
                <span className="small muted">
                  <span className="es">{r.total_xp}</span> XP בסך הכול
                </span>
              </div>
              <div className="stack" style={{ alignItems: "flex-end" }}>
                <span className="board-xp es">{r.week_xp}</span>
                <span className="row gap-4 small muted">
                  <Emoji3D emoji="🔥" size={16} eager /> {r.streak}
                </span>
              </div>
            </motion.div>
          ))}
          {rows.length <= 1 && <p className="center muted">כשעוד חברים יצטרפו, הם יופיעו כאן.</p>}
        </div>
      )}
    </div>
  );
}
