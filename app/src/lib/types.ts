export type Gender = "m" | "f";

export interface Example {
  es: string;
  he: string;
  hl: string;
  fm?: string; // meaning of the form used in this sentence, when it differs from the word
  fw?: string; // why the form differs (tense, person, plural…)
}

/** Words with almost the same meaning, and when to use each. */
export interface DiffGroup {
  id: string;
  words: number[];
  title: string;
  rule: string;
  items: { id: number; use: string; es: string; he: string; hl: string }[];
}

export interface Word {
  id: number; // stable id = frequency rank in the source list
  n: number; // position in the learning order (1 = first word to learn)
  es: string;
  pos: string;
  gender?: "m" | "f" | "mf";
  fem?: string;
  he: string;
  note?: string;
  emoji: string;
  ex: Example[];
  cov: number; // share of everyday spoken Spanish this word covers, in percent
}

export type LessonBlock =
  | { type: "text"; he: string }
  | { type: "tip"; he: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "examples"; items: { es: string; he: string }[] };

export type QuizItem =
  | { type: "choice"; q: string; es?: string; options: string[]; answer: number; explain: string }
  | { type: "build"; he: string; tokens: string[]; answer: string; extra?: string[] };

export interface LessonSlide {
  title: string;
  text: string;
  table?: { head: string[]; rows: string[][] };
  examples?: { es: string; he: string }[];
  tip?: string;
}

export interface Lesson {
  id: string;
  order: number;
  emoji: string;
  title: string;
  summary: string;
  minutes: number;
  new_words: { es: string; he: string }[];
  slides: LessonSlide[];
  quiz: QuizItem[];
  /** ids of words from the 1,000 that appear in the lesson */
  words: number[];
  /** lower-case Spanish token → word id, for tap-to-translate */
  lex: Record<string, number>;
}

export interface Profile {
  id: string;
  display_name: string;
  gender: Gender;
  accent: "latam" | "spain";
  tutor_voice: Gender;
  daily_new: number;
  sound_on: boolean;
  show_in_board: boolean;
  onboarded: boolean;
  xp: number;
  voice_daily_minutes: number;
  is_admin: boolean;
}

export interface Card {
  word_id: number;
  state: number; // 0 learning, 1 review, 2 relearning
  step: number;
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string;
  last_review: string | null;
  introduced_at: string;
}

export interface ActivityDay {
  day: string;
  xp: number;
  reviews: number;
  new_words: number;
  lessons: number;
  talk_seconds: number;
  listen_minutes: number;
}

export interface LessonDone {
  lesson_id: string;
  best_score: number;
  completed_at: string;
}
