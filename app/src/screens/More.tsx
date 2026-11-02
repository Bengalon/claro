import { useStore } from "../lib/store";
import { navigate } from "../lib/router";
import { Emoji3D } from "../components/Emoji3D";

export default function More() {
  const { profile } = useStore();
  const items = [
    { path: "/listen", emoji: "🎧", title: "להקשיב", sub: "סרטונים ופודקאסטים לפי רמה" },
    { path: "/friends", emoji: "🏆", title: "החבר׳ה", sub: "טבלת השבוע ורצפים" },
    { path: "/dict", emoji: "📖", title: "המילון שלי", sub: "חיפוש בכל המילים" },
    { path: "/lessons", emoji: "🧩", title: "שיעורים", sub: "איך בונים משפט" },
    { path: "/settings", emoji: "⚙️", title: "הגדרות", sub: "פרופיל, מבטא, יעד יומי" },
  ];
  if (profile?.is_admin) items.push({ path: "/admin", emoji: "🛠️", title: "ניהול משתמשים", sub: "הוספה, סיסמאות ודקות שיחה" });
  return (
    <div className="stack gap-16">
      <h1 className="h1">עוד</h1>
      <div className="tiles">
        {items.map((it) => (
          <button key={it.path} className="tile" onClick={() => navigate(it.path)}>
            <Emoji3D emoji={it.emoji} size={52} />
            <span className="tile-title">{it.title}</span>
            <span className="tile-sub">{it.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
