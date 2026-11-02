import type { Gender } from "./types";

/** Picks the masculine or feminine Hebrew form. */
export const g = (gender: Gender | undefined, m: string, f: string) => (gender === "f" ? f : m);

/** Local calendar day as YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return localDay(x);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function greetingEs(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "¡Buenas noches";
  if (h < 12) return "¡Buenos días";
  if (h < 20) return "¡Buenas tardes";
  return "¡Buenas noches";
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("he-IL").format(n);
}

export function minutesLabel(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function articleFor(gender?: "m" | "f" | "mf") {
  if (gender === "f") return "la";
  if (gender === "m") return "el";
  if (gender === "mf") return "el/la";
  return "";
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
