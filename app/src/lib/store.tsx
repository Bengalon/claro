import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { loadContent } from "./content";
import { isKnown } from "./srs";
import { setSoundEnabled } from "./sound";
import { addDays, localDay, startOfLocalDay } from "./util";
import type { ActivityDay, Card, Lesson, LessonDone, Profile, Word } from "./types";

export type ActivityDelta = Partial<Omit<ActivityDay, "day">>;

interface StoreValue {
  user: User | null;
  authReady: boolean;
  ready: boolean;
  loadError: string | null;
  profile: Profile | null;
  words: Word[];
  wordsById: Map<number, Word>;
  lessons: Lesson[];
  cards: Map<number, Card>;
  lessonsDone: Map<string, LessonDone>;
  days: ActivityDay[];
  today: ActivityDay;
  knownCount: number;
  coverage: number;
  streak: number;
  newToday: number;
  saveError: boolean;
  updateProfile: (patch: Partial<Profile>) => Promise<boolean>;
  saveCards: (cards: Card[]) => void;
  logReview: (wordId: number, rating: number) => void;
  addActivity: (delta: ActivityDelta) => void;
  completeLesson: (id: string, score: number) => Promise<void>;
  logListen: (minutes: number, source: string) => Promise<boolean>;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

// Local design preview only (never in production builds): /?demo or /?demo=new
const DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");
const DEMO_FRESH = DEMO && new URLSearchParams(window.location.search).get("demo") === "new";

async function demoData() {
  const content = await loadContent();
  const now = Date.now();
  const profile: Profile = {
    id: "demo",
    display_name: "רועי",
    gender: "m",
    accent: new URLSearchParams(location.search).get("accent") === "spain" ? "spain" : "latam",
    tutor_voice: "f",
    daily_new: 10,
    sound_on: true,
    show_in_board: true,
    onboarded: !DEMO_FRESH,
    xp: 1840,
    voice_daily_minutes: 20,
    is_admin: true,
  };
  const cards: Card[] = DEMO_FRESH
    ? []
    : content.words.slice(0, 130).map((w, i) => ({
        word_id: w.id,
        state: i < 110 ? 1 : 0,
        step: 0,
        ease: 2.5,
        interval_days: i < 110 ? 3 : 0,
        reps: 3,
        lapses: 0,
        due_at: new Date(now + (i % 7 === 0 ? -3600_000 : 86_400_000 * 2)).toISOString(),
        last_review: new Date(now - 86_400_000).toISOString(),
        introduced_at: new Date(now - 86_400_000 * 5).toISOString(),
      }));
  const days: ActivityDay[] = DEMO_FRESH
    ? []
    : [-4, -3, -2, -1].map((d) => ({ ...emptyDay(addDays(localDay(), d)), xp: 60 + d * 3, reviews: 20 }));
  const lessonsDone = DEMO_FRESH
    ? []
    : content.lessons.slice(0, 3).map((l, i) => ({ lesson_id: l.id, best_score: [100, 80, 60][i], completed_at: new Date().toISOString() }));
  return { content, profile, cards, days, lessonsDone };
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside provider");
  return v;
}

const emptyDay = (day: string): ActivityDay => ({
  day,
  xp: 0,
  reviews: 0,
  new_words: 0,
  lessons: 0,
  talk_seconds: 0,
  listen_minutes: 0,
});

async function fetchAllCards(): Promise<Card[]> {
  const out: Card[] = [];
  const page = 1000;
  for (let from = 0; from < 20000; from += page) {
    const { data, error } = await supabase
      .from("card_progress")
      .select("word_id,state,step,ease,interval_days,reps,lapses,due_at,last_review,introduced_at")
      .order("word_id")
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data as Card[]));
    if (!data || data.length < page) break;
  }
  return out;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [cards, setCards] = useState<Map<number, Card>>(new Map());
  const [lessonsDone, setLessonsDone] = useState<Map<string, LessonDone>>(new Map());
  const [days, setDays] = useState<ActivityDay[]>([]);
  const [saveError, setSaveError] = useState(false);

  // pending writes, retried until they succeed
  const pendingCards = useRef<Map<number, Card>>(new Map());
  const pendingReviews = useRef<{ word_id: number; rating: number; reviewed_at: string }[]>([]);
  const dirtyDay = useRef<ActivityDay | null>(null);
  const xpDelta = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const flushing = useRef(false);
  const profileRef = useRef<Profile | null>(null);
  profileRef.current = profile;
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;

  // ---------- auth ----------
  useEffect(() => {
    if (DEMO) {
      setUser({ id: "demo", email: "demo@claro.app" } as User);
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser((prev) => (prev?.id === session?.user?.id ? prev : session?.user ?? null));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- load ----------
  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    if (DEMO) {
      const d = await demoData();
      setWords(d.content.words);
      setLessons(d.content.lessons);
      setProfile(d.profile);
      setCards(new Map(d.cards.map((c) => [c.word_id, c])));
      setDays(d.days);
      setLessonsDone(new Map(d.lessonsDone.map((l) => [l.lesson_id, l])));
      setReady(true);
      return;
    }
    try {
      const since = addDays(localDay(), -120);
      const [content, prof, cardRows, les, act] = await Promise.all([
        loadContent(),
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        fetchAllCards(),
        supabase.from("lesson_progress").select("lesson_id,best_score,completed_at"),
        supabase.from("activity_days").select("*").gte("day", since).order("day"),
      ]);
      if (prof.error) throw prof.error;
      if (les.error) throw les.error;
      if (act.error) throw act.error;
      setWords(content.words);
      setLessons(content.lessons);
      setProfile(prof.data as Profile);
      setSoundEnabled((prof.data as Profile).sound_on);
      setCards(new Map(cardRows.map((c) => [c.word_id, c])));
      setLessonsDone(new Map((les.data as LessonDone[]).map((l) => [l.lesson_id, l])));
      setDays((act.data as (ActivityDay & { user_id?: string })[]).map(({ user_id: _u, ...d }) => d));
      setReady(true);
    } catch (e) {
      console.error(e);
      setLoadError("לא הצלחנו לטעון את הנתונים. בדקו את החיבור לאינטרנט ונסו שוב.");
    }
  }, [user]);

  useEffect(() => {
    if (user) void load();
    else {
      setReady(false);
      setProfile(null);
      setCards(new Map());
      setDays([]);
      setLessonsDone(new Map());
    }
  }, [user, load]);

  // ---------- writes ----------
  const flush = useCallback(async () => {
    if (flushing.current || DEMO) return;
    flushing.current = true;
    let failed = false;
    try {
      if (pendingCards.current.size) {
        const batch = [...pendingCards.current.values()];
        pendingCards.current.clear();
        const uid = userIdRef.current;
        const rows = batch.map((c) => ({ ...c, user_id: uid }));
        const { error } = await supabase.from("card_progress").upsert(rows, { onConflict: "user_id,word_id" });
        if (error) {
          failed = true;
          for (const c of batch) if (!pendingCards.current.has(c.word_id)) pendingCards.current.set(c.word_id, c);
        }
      }
      if (pendingReviews.current.length) {
        const batch = pendingReviews.current.splice(0);
        const { error } = await supabase.from("review_log").insert(batch);
        if (error) {
          failed = true;
          pendingReviews.current.unshift(...batch);
        }
      }
      if (dirtyDay.current) {
        const day = dirtyDay.current;
        dirtyDay.current = null;
        const { error } = await supabase
          .from("activity_days")
          .upsert({ ...day, user_id: userIdRef.current }, { onConflict: "user_id,day" });
        if (error) {
          failed = true;
          if (!dirtyDay.current) dirtyDay.current = day;
        }
      }
      if (xpDelta.current && profileRef.current) {
        const xp = profileRef.current.xp;
        const { error } = await supabase.from("profiles").update({ xp }).eq("id", profileRef.current.id);
        if (error) failed = true;
        else xpDelta.current = 0;
      }
    } finally {
      flushing.current = false;
      setSaveError(failed);
      if (failed) scheduleFlush(5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleFlush = useCallback(
    (ms = 1200) => {
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => void flush(), ms);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onOnline = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  const saveCards = useCallback(
    (list: Card[]) => {
      setCards((prev) => {
        const next = new Map(prev);
        for (const c of list) next.set(c.word_id, c);
        return next;
      });
      for (const c of list) pendingCards.current.set(c.word_id, c);
      scheduleFlush(600);
    },
    [scheduleFlush],
  );

  const logReview = useCallback(
    (wordId: number, rating: number) => {
      pendingReviews.current.push({ word_id: wordId, rating, reviewed_at: new Date().toISOString() });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const addActivity = useCallback(
    (delta: ActivityDelta) => {
      const today = localDay();
      setDays((prev) => {
        const idx = prev.findIndex((d) => d.day === today);
        const base = idx >= 0 ? prev[idx] : emptyDay(today);
        const next: ActivityDay = { ...base };
        (Object.keys(delta) as (keyof ActivityDelta)[]).forEach((k) => {
          next[k] = (next[k] ?? 0) + (delta[k] ?? 0);
        });
        dirtyDay.current = next;
        const copy = prev.slice();
        if (idx >= 0) copy[idx] = next;
        else copy.push(next);
        return copy;
      });
      if (delta.xp) {
        xpDelta.current += delta.xp;
        setProfile((p) => (p ? { ...p, xp: p.xp + (delta.xp ?? 0) } : p));
      }
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    const p = profileRef.current;
    if (!p) return false;
    const { id: _id, is_admin: _a, voice_daily_minutes: _v, ...allowed } = patch;
    setProfile({ ...p, ...allowed });
    if ("sound_on" in allowed) setSoundEnabled(!!allowed.sound_on);
    if (DEMO) return true;
    const { error } = await supabase.from("profiles").update(allowed).eq("id", p.id);
    if (error) {
      setProfile(p);
      return false;
    }
    return true;
  }, []);

  const completeLesson = useCallback(
    async (id: string, score: number) => {
      const prev = lessonsDone.get(id);
      const best = Math.max(prev?.best_score ?? 0, score);
      const row = { lesson_id: id, best_score: best, completed_at: new Date().toISOString() };
      setLessonsDone((m) => new Map(m).set(id, row));
      if (DEMO) return;
      await supabase
        .from("lesson_progress")
        .upsert({ ...row, user_id: userIdRef.current }, { onConflict: "user_id,lesson_id" });
    },
    [lessonsDone],
  );

  const logListen = useCallback(
    async (minutes: number, source: string) => {
      if (DEMO) {
        addActivity({ listen_minutes: minutes, xp: minutes });
        return true;
      }
      const { error } = await supabase.from("input_log").insert({ minutes, source });
      if (error) return false;
      addActivity({ listen_minutes: minutes, xp: minutes });
      return true;
    },
    [addActivity],
  );

  const signOut = useCallback(async () => {
    await flush();
    await supabase.auth.signOut();
    setUser(null);
  }, [flush]);

  // ---------- derived ----------
  const wordsById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words]);
  const todayKey = localDay();
  const today = useMemo(() => days.find((d) => d.day === todayKey) ?? emptyDay(todayKey), [days, todayKey]);

  const { knownCount, coverage } = useMemo(() => {
    let k = 0;
    let cov = 0;
    for (const c of cards.values()) {
      if (isKnown(c)) {
        k++;
        cov += wordsById.get(c.word_id)?.cov ?? 0;
      }
    }
    return { knownCount: k, coverage: cov };
  }, [cards, wordsById]);

  const newToday = useMemo(() => {
    const start = startOfLocalDay().getTime();
    let n = 0;
    for (const c of cards.values()) if (new Date(c.introduced_at).getTime() >= start) n++;
    return n;
  }, [cards]);

  const streak = useMemo(() => {
    const active = new Set(days.filter((d) => d.xp > 0).map((d) => d.day));
    let day = localDay();
    if (!active.has(day)) day = addDays(day, -1);
    let s = 0;
    while (active.has(day)) {
      s++;
      day = addDays(day, -1);
    }
    return s;
  }, [days]);

  const value: StoreValue = {
    user,
    authReady,
    ready,
    loadError,
    profile,
    words,
    wordsById,
    lessons,
    cards,
    lessonsDone,
    days,
    today,
    knownCount,
    coverage,
    streak,
    newToday,
    saveError,
    updateProfile,
    saveCards,
    logReview,
    addActivity,
    completeLesson,
    logListen,
    reload: load,
    signOut,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
