import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type Toast = { id: number; text: string; tone: "info" | "error" | "good" };
let listeners: ((t: Toast) => void)[] = [];
let n = 0;

export function toast(text: string, tone: Toast["tone"] = "info") {
  const t = { id: ++n, text, tone };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x, t]);
      window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 3200);
    };
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast-${t.tone}`}
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
