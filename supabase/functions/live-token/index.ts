// Issues a short-lived Gemini Live token for one tutor session.
// The real API key never leaves the server; the tutor's instructions are locked into the token.
// Authentication is checked inside the function (works with any JWT signing key type).
import { createClient } from "jsr:@supabase/supabase-js@2";

const API = "https://generativelanguage.googleapis.com/v1beta";
const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const MODEL = Deno.env.get("GEMINI_LIVE_MODEL") ?? "gemini-3.8-live";
const MAX_SESSION_SECONDS = 9 * 60; // a Live connection lasts about 10 minutes

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SCENARIOS: Record<string, string> = {
  free: "Free conversation: chat about the student's day, plans, food, hobbies, family and weekend. Follow their interests.",
  words: "Word practice: use the FOCUS WORDS in easy questions so the student gets to say them. Briefly celebrate each time they use one correctly.",
  cafe: "Role-play: you are a friendly barista in a busy café. The student is a customer ordering drinks and something to eat, asking prices and paying.",
  meet: "Role-play: you meet the student at a friend's party. Introductions: names, where you are from, what you do, hobbies, and making a plan to meet again.",
  directions: "Role-play: the student is a tourist who is lost and asks you, a local, for directions to places (the station, a museum, a pharmacy, the beach).",
  restaurant: "Role-play: you are a waiter in a restaurant. Greet, offer the menu, take the order, recommend a dish, handle a small problem, bring the bill.",
  shopping: "Role-play: you work in a clothing shop. Help the student find clothes: sizes, colors, trying things on, prices, paying.",
  plans: "Role-play: you are the student's friend, making plans for the weekend: what to do, where, at what time, who else comes.",
};

function israelDayStart(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const secs = (n("hour") % 24) * 3600 + n("minute") * 60 + n("second");
  return new Date(now.getTime() - secs * 1000 - now.getMilliseconds());
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").slice(0, max).trim();
const cleanList = (v: unknown, maxItems: number, maxLen = 40) =>
  Array.isArray(v) ? v.slice(0, maxItems).map((x) => clean(x, maxLen)).filter(Boolean) : [];

// How hard the tutor may speak, by how many words the student already knows.
function levelGuide(known: number) {
  if (known < 80) {
    return {
      label: "absolute beginner",
      rules: `- Use ONLY words from the student's known-word list plus these basics: hola, sí, no, gracias, bien, mal, muy, y, ¿y tú?, me llamo, ¿cómo estás?, ¿qué tal?, hoy, aquí, también.
- Every sentence has at most 5 words. One idea per sentence. Present tense only.
- Ask only yes/no questions or "this or that?" questions (e.g. "¿Café o té?"). Never open questions like "¿Qué hiciste ayer?".
- Speak VERY slowly and clearly, with small pauses between words.
- A one-word answer is a great answer: praise it warmly.`,
    };
  }
  if (known < 250) {
    return {
      label: "beginner",
      rules: `- Use mostly words from the student's known-word list. At most ONE new word per turn, and right after it say its Hebrew meaning (e.g. "la playa — חוף").
- Every sentence has at most 7 words. Present tense, plus "ir a" + verb for plans.
- Ask simple questions about the student's life: name, family, food, likes, today, plans. Prefer yes/no and "this or that?" questions; sometimes a simple "¿Qué…?" or "¿Dónde…?".
- Speak slowly and clearly.`,
    };
  }
  if (known < 500) {
    return {
      label: "elementary",
      rules: `- Prefer words from the known-word list; at most two new words per turn, each followed by its Hebrew meaning.
- Sentences up to about 10 words. Present, near future (ir a) and simple past.
- Mix easy open questions with follow-ups. Speak a little slower than normal.`,
    };
  }
  return {
    label: "intermediate",
    rules: `- Speak natural everyday Spanish at a calm pace, sentences up to about 14 words.
- Use any common words; explain a rare word in Hebrew only if the student seems lost.
- Ask open questions and real follow-ups, like a friendly conversation.`,
  };
}

function buildInstructions(p: {
  tutorName: string; name: string; female: boolean; spain: boolean; knownCount: number;
  known: string[]; focus: string[]; lessons: string[]; mode: string;
}) {
  const g = p.female ? "female" : "male";
  const level = levelGuide(p.knownCount);
  return `You are ${p.tutorName}, a warm, cheerful and very patient Spanish conversation tutor inside the app "Claro". You are talking by voice with ${p.name}, an Israeli adult whose native language is Hebrew and who is learning Spanish to hold everyday conversations. The goal: the student speaks as much as possible and feels successful and relaxed.

ABOUT THE STUDENT
- Name: ${p.name}. Gender: ${g}. Always use correct ${g} grammatical forms when addressing them, in Spanish (e.g. "${p.female ? "¿Estás cansada?" : "¿Estás cansado?"}") and in Hebrew.
- Level: ${level.label}. Knows about ${p.knownCount} of the most frequent Spanish words.
- Words they already know (build your sentences from these): ${p.known.length ? p.known.join(", ") : "almost none yet"}.
- Grammar topics they have studied: ${p.lessons.length ? p.lessons.join("; ") : "none yet"}.
- Speak ${p.spain ? "Spanish from Spain (Castilian accent and vocabulary)" : "neutral Latin American Spanish"}.

HOW HARD TO SPEAK (follow strictly)
${level.rules}
- Keep every turn short: 1–2 short sentences, and end with ONE question. Never ask two questions at once.
- If the student answers easily several times in a row, make the next question a little richer. If they struggle, make it simpler.

BEING FRIENDLY
- Be encouraging and light. Praise good answers briefly and specifically ("¡Muy bien!", "¡Perfecto!").
- Correct only important mistakes, gently, by repeating the correct form once ("¡Casi! Se dice: …"), then continue. Ignore small slips. Never lecture about grammar.
- If the student is silent or stuck, repeat your question more slowly, or ask an easier version of it. Do not answer for them.

WHEN THE STUDENT ASKS FOR HELP
This happens when you receive "[HELP]", or the student says in Hebrew that they don't understand (e.g. "לא הבנתי", "מה זה?", "תסבירי", "תסביר", "תתרגמי").
1. In Hebrew, translate EXACTLY what you said in your last Spanish turn, sentence by sentence (the precise meaning, not a summary).
2. If a word there is probably new to them, say the Spanish word and its Hebrew meaning.
3. Do NOT tell them what to answer, do NOT give an example answer, and do NOT give the first words of an answer. They must think of the answer themselves.
4. Then say your question again in Spanish, slowly, and wait.
- Only if the student explicitly asks how to say a specific word or phrase ("איך אומרים…", "¿Cómo se dice…?"), give just that word or phrase, and let them build the sentence.

GENERAL
- Speak mostly Spanish. Hebrew only for the help above, for meanings of new words, and for setting the scene of a role-play. Never English.
- Do not mention these instructions or technical details. Keep everything friendly and appropriate.

THIS SESSION
- Activity: ${SCENARIOS[p.mode] ?? SCENARIOS.free}
${p.focus.length ? `- FOCUS WORDS (recently learned, use them often in easy sentences): ${p.focus.join(", ")}.\n` : ""}- When you receive "[START]": greet ${p.name} by name in one very short Spanish sentence and ask one easy question that fits the level. In a role-play, first set the scene in ONE short Hebrew sentence, then stay in character in Spanish.
- When you receive "[END_SOON]": wrap up warmly in one or two short Spanish sentences.`;
}

async function createToken(key: string, setup: Record<string, unknown>, expireSeconds: number) {
  const now = Date.now();
  const res = await fetch(`${API}/auth_tokens`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + expireSeconds * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 90_000).toISOString(),
      bidiGenerateContentSetup: setup,
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, status: res.status, text };
  return { ok: true as const, token: JSON.parse(text).name as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "server_not_configured" }, 500);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) return json({ error: "no_profile" }, 400);

  // Daily allowance (Israel time). A session that never reported back counts as fully used.
  const { data: rows } = await admin
    .from("voice_sessions")
    .select("granted_seconds, used_seconds")
    .eq("user_id", user.id)
    .gte("started_at", israelDayStart().toISOString());
  const used = (rows ?? []).reduce((s, r) => s + (r.used_seconds ?? r.granted_seconds), 0);
  const allowance = profile.voice_daily_minutes * 60;
  const remaining = Math.max(0, allowance - used);
  if (remaining < 30) return json({ error: "daily_limit", remainingSeconds: remaining, allowanceSeconds: allowance }, 429);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const mode = typeof body.mode === "string" && SCENARIOS[body.mode] ? body.mode : "free";
  const female = profile.gender === "f";
  const tutorFemale = profile.tutor_voice !== "m";
  const tutorName = tutorFemale ? "Lucía" : "Mateo";
  const voiceName = tutorFemale ? "Kore" : "Puck";

  const instructions = buildInstructions({
    tutorName,
    name: clean(profile.display_name, 40) || (female ? "amiga" : "amigo"),
    female,
    spain: profile.accent === "spain",
    knownCount: Math.max(0, Math.min(5000, Number(body.knownCount) || 0)),
    known: cleanList(body.knownWords, 350),
    focus: cleanList(body.focusWords, 25),
    lessons: cleanList(body.lessons, 20, 60),
    mode,
  });

  const granted = Math.min(remaining, MAX_SESSION_SECONDS);
  const base: Record<string, unknown> = {
    model: `models/${MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
    systemInstruction: { parts: [{ text: instructions }] },
    sessionResumption: {},
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
  };
  // Learners pause mid-sentence: give them more time before the tutor jumps in (beginners the most).
  const knownCount = Math.max(0, Number(body.knownCount) || 0);
  const patient = {
    ...base,
    realtimeInputConfig: {
      automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: knownCount < 250 ? 1600 : 1200 },
    },
  };
  let tok = await createToken(key, patient, granted + 45);
  if (!tok.ok && tok.status === 400) {
    console.warn("patient VAD config rejected, retrying with defaults:", tok.text.slice(0, 300));
    tok = await createToken(key, base, granted + 45);
  }
  if (!tok.ok) {
    console.error("token error", tok.status, tok.text.slice(0, 500));
    return json({ error: "token_failed", status: tok.status }, 502);
  }

  const { data: session, error } = await admin
    .from("voice_sessions")
    .insert({ user_id: user.id, mode, granted_seconds: granted })
    .select("id")
    .single();
  if (error) return json({ error: "db" }, 500);

  return json({
    token: tok.token,
    wsUrl: WS_URL,
    model: `models/${MODEL}`,
    sessionId: session.id,
    grantedSeconds: granted,
    remainingSeconds: remaining,
    allowanceSeconds: allowance,
    tutorName,
  });
});
