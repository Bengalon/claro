import type { Card } from "./types";

/** 1 = forgot, 2 = hard, 3 = knew it, 4 = easy */
export type Rating = 1 | 2 | 3 | 4;

const MIN = 60_000;
const DAY = 86_400_000;
const LEARN_STEPS = [1, 10]; // minutes
const RELEARN_STEPS = [10];
const MAX_INTERVAL = 365;

export function newCard(wordId: number, now = new Date()): Card {
  return {
    word_id: wordId,
    state: 0,
    step: 0,
    ease: 2.5,
    interval_days: 0,
    reps: 0,
    lapses: 0,
    due_at: now.toISOString(),
    last_review: null,
    introduced_at: now.toISOString(),
  };
}

/** Marks a new word as already known: straight into long-term review. */
export function knownCard(wordId: number, now = new Date()): Card {
  const c = newCard(wordId, now);
  c.state = 1;
  c.reps = 1;
  c.interval_days = 21;
  c.ease = 2.7;
  c.due_at = new Date(now.getTime() + 21 * DAY).toISOString();
  c.last_review = now.toISOString();
  return c;
}

function fuzz(days: number) {
  if (days < 3) return days;
  const f = 1 + (Math.random() * 0.1 - 0.05);
  return days * f;
}

export function schedule(card: Card, rating: Rating, now = new Date()): Card {
  const c: Card = { ...card, reps: card.reps + 1, last_review: now.toISOString() };
  const t = now.getTime();

  if (c.state === 0 || c.state === 2) {
    const steps = c.state === 0 ? LEARN_STEPS : RELEARN_STEPS;
    if (rating === 1) {
      c.step = 0;
      c.due_at = new Date(t + steps[0] * MIN).toISOString();
    } else if (rating === 2) {
      const cur = steps[Math.min(c.step, steps.length - 1)];
      const next = steps[Math.min(c.step + 1, steps.length - 1)];
      c.due_at = new Date(t + ((cur + next) / 2) * MIN).toISOString();
    } else if (rating === 3 && c.step + 1 < steps.length) {
      c.step += 1;
      c.due_at = new Date(t + steps[c.step] * MIN).toISOString();
    } else {
      // graduate
      const relearning = c.state === 2;
      let ivl: number;
      if (rating === 4) ivl = relearning ? Math.max(1, c.interval_days * 1.2) : 4;
      else ivl = relearning ? Math.max(1, c.interval_days) : 1;
      c.state = 1;
      c.step = 0;
      c.interval_days = ivl;
      c.due_at = new Date(t + ivl * DAY).toISOString();
    }
    return c;
  }

  // review
  let ivl = c.interval_days;
  if (rating === 1) {
    c.lapses += 1;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.interval_days = Math.max(1, ivl * 0.5);
    c.state = 2;
    c.step = 0;
    c.due_at = new Date(t + RELEARN_STEPS[0] * MIN).toISOString();
    return c;
  }
  if (rating === 2) {
    c.ease = Math.max(1.3, c.ease - 0.15);
    ivl = Math.max(ivl * 1.2, ivl + 1);
  } else if (rating === 3) {
    ivl = Math.max(ivl * c.ease, ivl + 1);
  } else {
    c.ease = c.ease + 0.15;
    ivl = Math.max(ivl * c.ease * 1.3, ivl + 2);
  }
  ivl = Math.min(MAX_INTERVAL, fuzz(ivl));
  c.interval_days = ivl;
  c.due_at = new Date(t + ivl * DAY).toISOString();
  return c;
}

/** Human label for when a card will come back, in Hebrew. */
export function dueLabel(card: Card, rating: Rating): string {
  const next = schedule(card, rating);
  const ms = new Date(next.due_at).getTime() - Date.now();
  const mins = Math.round(ms / MIN);
  if (mins < 60) return mins <= 1 ? "עוד דקה" : `עוד ${mins} דק׳`;
  const days = ms / DAY;
  if (days < 1.5) return "מחר";
  if (days < 30) return `עוד ${Math.round(days)} ימים`;
  const months = days / 30;
  return months < 1.5 ? "עוד חודש" : `עוד ${Math.round(months)} חודשים`;
}

/** A word counts as "known" once it has graduated from learning at least once. */
export const isKnown = (c: Card | undefined) => !!c && (c.state === 1 || c.state === 2);
export const isDue = (c: Card, now = Date.now()) => new Date(c.due_at).getTime() <= now;
