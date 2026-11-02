import { useEffect, useRef } from "react";

export type OrbMode = "idle" | "listen" | "speak" | "think" | "happy";

interface Props {
  size?: number;
  mode?: OrbMode;
  /** Returns a loudness value 0..1, polled every frame (tutor voice or mic). */
  level?: () => number;
  className?: string;
}

/** Lucía / Mateo — the tutor's living glossy orb with a face. */
export function Orb({ size = 160, mode = "idle", level, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!level) return;
    let raf = 0;
    let smooth = 0;
    let last = 0;
    let shown = -1;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 33) return; // ~30 fps is plenty and keeps phones smooth
      last = t;
      const v = Math.max(0, Math.min(1, level()));
      // gentle envelope: rise moderately, fall slowly, so the orb breathes instead of jittering
      smooth += (v - smooth) * (v > smooth ? 0.25 : 0.08);
      const q = Math.round(smooth * 50) / 50;
      if (q !== shown) {
        shown = q;
        ref.current?.style.setProperty("--level", q.toFixed(2));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level]);

  return (
    <div
      ref={ref}
      className={`orb orb-${mode} ${className ?? ""}`}
      style={{ ["--size" as string]: `${size}px` }}
      aria-hidden="true"
    >
      <div className="orb-halo" />
      <div className="orb-body">
        <div className="orb-swirl" />
        <div className="orb-shine" />
        <svg className="orb-face" viewBox="0 0 100 100">
          <g className="orb-eyes">
            <ellipse cx="37" cy="46" rx="6.2" ry="8.4" fill="#fff" />
            <ellipse cx="63" cy="46" rx="6.2" ry="8.4" fill="#fff" />
            <circle className="orb-pupil" cx="37.6" cy="47.5" r="3.3" fill="#1f1a44" />
            <circle className="orb-pupil" cx="63.6" cy="47.5" r="3.3" fill="#1f1a44" />
            <circle cx="39" cy="45.6" r="1.1" fill="#fff" />
            <circle cx="65" cy="45.6" r="1.1" fill="#fff" />
          </g>
          <path className="orb-mouth" d="M42 62 Q50 69 58 62" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
          <ellipse cx="27" cy="58" rx="5" ry="3" fill="#ff8fb1" opacity="0.55" />
          <ellipse cx="73" cy="58" rx="5" ry="3" fill="#ff8fb1" opacity="0.55" />
        </svg>
      </div>
    </div>
  );
}
