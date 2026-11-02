import type { DiffGroup, Lesson, Word } from "./types";

let cache: Promise<{ words: Word[]; lessons: Lesson[] }> | null = null;

/** "What's the difference?" groups for each word id (filled when content loads). */
export const groupsByWord = new Map<number, DiffGroup[]>();

/** Loads the word list, lessons and difference groups once (split into their own download). */
export function loadContent() {
  if (!cache) {
    cache = Promise.all([import("../data/words.json"), import("../data/lessons.json"), import("../data/groups.json")]).then(([w, l, g]) => {
      groupsByWord.clear();
      for (const grp of g.default as unknown as DiffGroup[]) {
        for (const id of grp.words) groupsByWord.set(id, [...(groupsByWord.get(id) ?? []), grp]);
      }
      return {
        words: (w.default as unknown as Word[]).slice().sort((a, b) => a.n - b.n),
        lessons: (l.default as unknown as Lesson[]).slice().sort((a, b) => a.order - b.order),
      };
    });
  }
  return cache;
}
