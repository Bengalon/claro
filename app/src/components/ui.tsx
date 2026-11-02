import { useEffect, useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import confetti from "canvas-confetti";
import { IconBack, IconCards, IconGrid, IconHome, IconPath } from "./Icons";
import { Orb } from "./Orb";
import { back, navigate } from "../lib/router";
import { prefersReducedMotion } from "../lib/util";

/* ---------- Tab bar ---------- */
const TABS = [
  { path: "/", label: "בית", icon: IconHome },
  { path: "/words", label: "מילים", icon: IconCards },
  { path: "/talk", label: "לדבר", icon: null },
  { path: "/lessons", label: "שיעורים", icon: IconPath },
  { path: "/more", label: "עוד", icon: IconGrid },
] as const;

export function TabBar({ path }: { path: string }) {
  const section = "/" + (path.split("/")[1] ?? "");
  return (
    <nav className="tabbar" aria-label="ניווט ראשי">
      {TABS.map((t) => {
        const active = t.path === "/" ? section === "/" : section === t.path || (t.path === "/lessons" && section === "/lesson");
        if (!t.icon) {
          return (
            <div className="tab-talk" key={t.path}>
              <button className="tab-talk-btn" onClick={() => navigate(t.path)} aria-label="לדבר עם המורה">
                <Orb size={54} />
              </button>
            </div>
          );
        }
        const Icon = t.icon;
        return (
          <button key={t.path} className="tab" aria-current={active ? "page" : undefined} onClick={() => navigate(t.path)}>
            <Icon />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ---------- Top bar ---------- */
export function TopBar({ title, right, onBack }: { title?: ReactNode; right?: ReactNode; onBack?: () => void }) {
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onBack ?? (() => back())} aria-label="חזרה">
        <IconBack />
      </button>
      <h1 className="h2">{title}</h1>
      {right}
    </header>
  );
}

/* ---------- Progress ring ---------- */
export function Ring({
  value,
  size = 120,
  stroke = 12,
  children,
  colors = ["#ffb23f", "#ff5c8a", "#6d4aff"],
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  colors?: string[];
}) {
  const id = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            {colors.map((col, i) => (
              <stop key={col} offset={`${(i / Math.max(1, colors.length - 1)) * 100}%`} stopColor={col} />
            ))}
          </linearGradient>
        </defs>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          stroke={`url(#g${id})`}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

/* ---------- Bottom sheet ---------- */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            initial={{ y: "100%", x: "-50%" }}
            animate={{ y: 0, x: "-50%" }}
            exit={{ y: "100%", x: "-50%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            <div className="sheet-grip" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ---------- Confetti ---------- */
const BRAND = ["#6d4aff", "#9d82ff", "#ffb23f", "#ff5c8a", "#3d7bff", "#19b981"];

export function celebrate(power: "small" | "big" = "big") {
  if (prefersReducedMotion()) return;
  const end = Date.now() + (power === "big" ? 900 : 250);
  const frame = () => {
    confetti({ particleCount: power === "big" ? 6 : 4, angle: 60, spread: 70, origin: { x: 0, y: 0.75 }, colors: BRAND, scalar: 1.05, disableForReducedMotion: true });
    confetti({ particleCount: power === "big" ? 6 : 4, angle: 120, spread: 70, origin: { x: 1, y: 0.75 }, colors: BRAND, scalar: 1.05, disableForReducedMotion: true });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
  if (power === "big") {
    confetti({ particleCount: 90, spread: 100, startVelocity: 38, origin: { y: 0.4 }, colors: BRAND, shapes: ["circle", "square"], disableForReducedMotion: true });
  }
}

/* ---------- Count-up number ---------- */
export function CountUp({ to, duration = 900 }: { to: number; duration?: number }) {
  return (
    <motion.span
      key={to}
      initial={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <Counter to={to} duration={duration} />
    </motion.span>
  );
}

function Counter({ to, duration }: { to: number; duration: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{v.toLocaleString("he-IL")}</>;
}

/* ---------- Loading ---------- */
export function Loading({ label }: { label?: string }) {
  return (
    <div className="page-center">
      <div className="stack gap-12" style={{ alignItems: "center" }}>
        <Orb size={88} mode="think" />
        {label && <div className="muted">{label}</div>}
      </div>
    </div>
  );
}
