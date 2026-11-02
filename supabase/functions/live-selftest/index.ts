// Temporary diagnostics for the voice tutor setup. Protected by a one-off code.
// Never returns the API key or a usable token.
const CODE = "1688e7a3cc7786d2885dd225586c4750";
const API = "https://generativelanguage.googleapis.com/v1beta";
const WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== CODE) return new Response("not found", { status: 404 });
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return Response.json({ ok: false, step: "secret", error: "GEMINI_API_KEY missing" });

  const model = url.searchParams.get("model") ?? "gemini-3.8-live";
  const voice = url.searchParams.get("voice") ?? "Kore";
  const lockSys = url.searchParams.get("lock") !== "0";
  const sys =
    "You are a Spanish tutor. ALWAYS start every reply with the exact word 'PIÑA'. Keep replies under 12 words.";

  const now = Date.now();
  const setupCfg: Record<string, unknown> = {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    sessionResumption: {},
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
  };
  if (lockSys) setupCfg.systemInstruction = { parts: [{ text: sys }] };
  if (url.searchParams.get("ric") === "1") {
    setupCfg.realtimeInputConfig = {
      automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: 1100 },
    };
  }

  const tokRes = await fetch(`${API}/auth_tokens`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 3 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      ...(lockSys ? { bidiGenerateContentSetup: setupCfg } : {}),
    }),
  });
  const tokText = await tokRes.text();
  if (!tokRes.ok) return Response.json({ ok: false, step: "token", status: tokRes.status, error: tokText.slice(0, 1500) });
  const token = JSON.parse(tokText).name as string;

  const events: string[] = [];
  let transcript = "";
  let audioBytes = 0;
  let mime = "";
  let closeInfo = "";
  const done = new Promise<void>((resolve) => {
    const ws = new WebSocket(`${WS}?access_token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => { events.push("timeout"); try { ws.close(); } catch { /* */ } resolve(); }, 20_000);
    ws.onopen = () => {
      events.push("open");
      const setup = lockSys ? { model: `models/${model}` } : { ...setupCfg, systemInstruction: { parts: [{ text: sys }] } };
      ws.send(JSON.stringify({ setup }));
    };
    ws.onmessage = async (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : await new Response(ev.data).text();
      const msg = JSON.parse(raw);
      const kind = Object.keys(msg).filter((k) => k !== "usageMetadata").join(",");
      if (msg.setupComplete) {
        events.push("setupComplete");
        ws.send(JSON.stringify({ realtimeInput: { text: "Hola, ¿cómo estás?" } }));
      } else if (msg.serverContent) {
        const sc = msg.serverContent;
        for (const p of sc.modelTurn?.parts ?? []) {
          if (p.inlineData?.data) { audioBytes += Math.floor(p.inlineData.data.length * 0.75); mime = p.inlineData.mimeType; }
        }
        if (sc.outputTranscription?.text) transcript += sc.outputTranscription.text;
        if (sc.turnComplete) { events.push("turnComplete"); clearTimeout(timer); ws.close(); resolve(); }
      } else {
        events.push(kind);
      }
    };
    ws.onerror = (e) => { events.push("error:" + ((e as ErrorEvent).message ?? "")); };
    ws.onclose = (e) => { closeInfo = `${e.code} ${e.reason}`; clearTimeout(timer); resolve(); };
  });
  await done;
  return Response.json({ ok: transcript.length > 0, model, voice, lockSys, events, transcript, audioBytes, mime, closeInfo });
});
