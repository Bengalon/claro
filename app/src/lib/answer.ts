// Checking a typed Hebrew translation against a word's meanings, forgiving small typos and spelling variants.
import type { Word } from "./types";

const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

export function normHe(s: string): string {
  return s
    .replace(/[֑-ׇ]/g, "") // niqqud and cantillation
    .replace(/[׳״'"`´]/g, "")
    .replace(/[־\-–—]/g, "")
    .replace(/[.,;:!?()[\]{}/\\]/g, " ")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/\s+/g, " ")
    .trim();
}

/** The accepted meanings: "להיות (מצב ומקום) / להימצא" → ["להיות", "להימצא"]. */
export function meanings(word: Word): string[] {
  const out = new Set<string>();
  for (const part of word.he.split(/[/,;]| או /)) {
    const base = normHe(part.replace(/\(.*?\)/g, ""));
    if (base) out.add(base);
  }
  return [...out];
}

/** Function words (articles, prepositions, conjunctions) are tested by choosing, not typing. */
export function canType(word: Word): boolean {
  if (["det", "prep", "conj"].includes(word.pos)) return false;
  return meanings(word).some((m) => m.replace(/ /g, "").length >= 2);
}

function lev(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const variants = (s: string) => {
  const v = new Set([s, s.replace(/ /g, "")]);
  // "הזה" ~ "זה", "הבית" ~ "בית"
  if (s.startsWith("ה") && s.length > 2) v.add(s.slice(1));
  // full / defective spelling: "שולחן" ~ "שלחן", "ישן" ~ "יישן"
  const plain = s.replace(/[וי]/g, "");
  if (s.length >= 4 && plain.length >= 3) v.add(plain);
  return [...v];
};

export type Verdict = "right" | "close" | "wrong";

export function checkTyped(input: string, word: Word): Verdict {
  const a = normHe(input);
  if (!a) return "wrong";
  let close = false;
  for (const m of meanings(word)) {
    for (const x of variants(a)) {
      for (const y of variants(m)) {
        if (x === y) return "right";
        const len = Math.max(x.length, y.length);
        const d = lev(x, y);
        if ((len >= 4 && d <= 1) || (len >= 8 && d <= 2)) close = true;
      }
    }
    // a meaning made of several words: accept typing one clear word of it ("מאוד יפה" → "יפה")
    const words = m.split(" ").filter((w) => w.length >= 3);
    if (words.length > 1 && words.includes(a)) return "right";
  }
  return close ? "close" : "wrong";
}
