import { useDeferredValue, useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { isKnown } from "../lib/srs";
import type { Word } from "../lib/types";
import { Emoji3D } from "../components/Emoji3D";
import { Sheet, TopBar } from "../components/ui";
import { WordCard } from "../components/WordCard";
import { IconSearch } from "../components/Icons";

type Filter = "all" | "known" | "learning" | "new";

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Dictionary() {
  const { words, cards, profile } = useStore();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Word | null>(null);
  const dq = useDeferredValue(q);

  const list = useMemo(() => {
    const needle = strip(dq.trim());
    return words.filter((w) => {
      const c = cards.get(w.id);
      const status: Filter = isKnown(c) ? "known" : c ? "learning" : "new";
      if (filter !== "all" && status !== filter) return false;
      if (!needle) return true;
      return strip(w.es).includes(needle) || w.he.includes(dq.trim()) || (w.fem && strip(w.fem).includes(needle));
    });
  }, [words, cards, dq, filter]);

  const shown = list.slice(0, 200);

  return (
    <div className="stack gap-12">
      <TopBar title="המילון שלי" />
      <div className="search">
        <IconSearch />
        <input className="input" placeholder="חיפוש בעברית או בספרדית" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="seg" role="group" aria-label="סינון">
        {(
          [
            ["all", "הכול"],
            ["known", "יודע/ת"],
            ["learning", "בלמידה"],
            ["new", "עוד לא"],
          ] as [Filter, string][]
        ).map(([k, l]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {list.length} מילים{list.length > shown.length ? ` (מוצגות ${shown.length} הראשונות)` : ""}
      </p>
      <div className="dict-list">
        {shown.map((w) => {
          const c = cards.get(w.id);
          const st = isKnown(c) ? "known" : c ? "learning" : "new";
          return (
            <button key={w.id} className="dict-row" onClick={() => setOpen(w)}>
              <Emoji3D emoji={w.emoji} size={40} />
              <span className="dict-es es">{w.es}</span>
              <span className="dict-he grow">{w.he}</span>
              <span className={`dict-dot ${st}`} aria-label={st === "known" ? "ידועה" : st === "learning" ? "בלמידה" : "חדשה"} />
            </button>
          );
        })}
        {list.length === 0 && <p className="center muted">לא נמצאו מילים. נסו חיפוש אחר.</p>}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)}>
        {open && <WordCard word={open} accent={profile!.accent} />}
      </Sheet>
    </div>
  );
}
