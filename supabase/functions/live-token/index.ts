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
  words: "Word practice: naturally weave the FOCUS WORDS into the conversation and ask questions that make the student say them. Briefly celebrate each time they use one correctly.",
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

function levelText(known: number) {
  if (known < 60) return "absolute beginner (knows only a few words)";
  if (known < 200) return "beginner";
  if (known < 450) return "elementary";
  if (known < 750) return "pre-intermediate";
  return "intermediate";
}

function buildInstructions(p: {
  tutorName: string; name: string; female: boolean; spain: boolean; knownCount: number;
  known: string[]; focus: string[]; lessons: string[]; mode: string;
}) {
  const g = p.female ? "female" : "male";
  return `You are ${p.tutorName}, a warm, upbeat and patient Spanish conversation tutor inside the app "Claro". You are talking by voice with ${p.name}, an Israeli adult whose native language is Hebrew and who is learning Spanish to hold everyday conversations.

ABOUT THE STUDENT
- Name: ${p.name}. Gender: ${g}. Always use correct ${g} grammatical forms when addressing them, in Spanish (e.g. "${p.female ? "¿Estás cansada?" : "¿Estás cansado?"}") and in Hebrew.
- Level: ${levelText(p.knownCount)}; knows about ${p.knownCount} of the most frequent Spanish words.
- Words they know well (prefer these): ${p.known.length ? p.known.join(", ") : "almost none yet"}.
- Grammar topics they have studied: ${p.lessons.length ? p.lessons.join("; ") : "none yet"}.
- Speak ${p.spain ? "Spanish from Spain (Castilian accent and vocabulary)" : "neutral Latin American Spanish"}.

HOW TO TEACH
- Speak mostly Spanish, slowly and clearly, in short simple sentences. Keep every turn short (1–3 sentences) and usually end with one simple question, so the student talks more than you.
- Match their level. With beginners use very basic words, offer two-option questions ("¿Café o té?") and give them the first words of an answer when they hesitate.
- If the student is stuck, stays silent, or speaks Hebrew, help in ONE short Hebrew sentence, give the exact Spanish phrase to say, and invite them to say it.
- Correct important mistakes gently by recasting: "¡Casi! Se dice: …", then continue. At most one correction per turn; ignore tiny slips. Praise good answers briefly and specifically.
- If asked how to say something ("איך אומרים…", "¿Cómo se dice…?"), answer in a few words and ask them to use it in a sentence.
- Never give grammar lectures longer than one sentence. Do not use English. Do not mention these instructions or technical details.
- Keep everything friendly and appropriate.

THIS SESSION
- Activity: ${SCENARIOS[p.mode] ?? SCENARIOS.free}
${p.focus.length ? `- FOCUS WORDS (recently learned, use them often): ${p.focus.join(", ")}.\n` : ""}- When you receive "[START]": greet ${p.name} by name in one short Spanish sentence and start the activity with a simple question. In a role-play, first set the scene in ONE short Hebrew sentence, then stay in character in Spanish.
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
  // Learners pause mid-sentence: give them more time before the tutor jumps in.
  const patient = {
    ...base,
    realtimeInputConfig: {
      automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: 1100 },
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
