import type { Card, Word } from "./types";

export function dueCards(cards: Map<number, Card>, now = Date.now()): Card[] {
  const out: Card[] = [];
  for (const c of cards.values()) if (new Date(c.due_at).getTime() <= now) out.push(c);
  return out.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
}

export function nextNewWords(words: Word[], cards: Map<number, Card>, n: number): Word[] {
  if (n <= 0) return [];
  const out: Word[] = [];
  for (const w of words) {
    if (!cards.has(w.id)) {
      out.push(w);
      if (out.length >= n) break;
    }
  }
  return out;
}

export function todayPlan(opts: {
  cards: Map<number, Card>;
  dailyNew: number;
  newToday: number;
  reviewsDone: number;
  totalWords: number;
}) {
  const due = dueCards(opts.cards).length;
  const unseen = Math.max(0, opts.totalWords - opts.cards.size);
  const newLeft = Math.min(unseen, Math.max(0, opts.dailyNew - opts.newToday));
  const done = opts.reviewsDone + opts.newToday;
  const total = done + due + newLeft;
  return { due, newLeft, done, total, progress: total === 0 ? 1 : done / total };
}

export const POS_HE: Record<string, string> = {
  verb: "פועל",
  noun: "שם עצם",
  adj: "תואר",
  adv: "תואר הפועל",
  pron: "כינוי",
  prep: "מילת יחס",
  conj: "מילת חיבור",
  det: "מילית",
  intj: "קריאה",
  phrase: "ביטוי",
  num: "מספר",
};
