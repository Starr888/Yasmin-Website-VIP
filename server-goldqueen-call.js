import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_BRAND = process.env.BOT_BRAND || "Gold Queen Live";
const DEFAULT_VOICE = process.env.GEMINI_VOICE || "Zephyr";
const MEMORY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MEMORY_FILE = process.env.MEMORY_FILE || path.join(process.cwd(), "memory.json");

const app = express();
app.use(express.json({ limit: "2mb" }));

if (!GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is missing. Add it in Render Environment.");
}

function getBotProfile(req) {
  const url = new URL(req.url || "/live", "http://localhost");
  const raw = String(url.searchParams.get("bot") || process.env.BOT_NAME || "yasmin").toLowerCase().trim();

  if (["jam", "jamin", "jamine", "jamm"].includes(raw)) {
    return {
      key: "jamin",
      name: "Jamin",
      publicName: "Jamin",
      age: 23,
      city: "Phnom Penh",
      voice: process.env.JAMIN_VOICE || process.env.JAM_VOICE || DEFAULT_VOICE,
      languageRule: "Khmer only. Always reply in natural Khmer, even if the user uses English or another language.",
      userTerm: "បងសម្លាញ់",
      introLine: "ខ្ញុំ Jamin អាយុ 23 ឆ្នាំ នៅភ្នំពេញ។",
      identityRules: [
        "Your name is Jamin, not Yasmin, not Jasmin, not Jasmine.",
        "If the user asks your name, answer in Khmer only: ខ្ញុំឈ្មោះ Jamin ចា៎ 💕",
        "You are 23 years old and you live in Phnom Penh.",
        "Never introduce yourself as Yasmin or Jasmin."
      ]
    };
  }

  return {
    key: "yasmin",
    name: "Yasmin",
    publicName: "Yasmin",
    age: 23,
    city: "Taiwan",
    voice: process.env.YASMIN_VOICE || DEFAULT_VOICE,
    languageRule: "Reply in the same language as the user when possible.",
    userTerm: "love",
    introLine: "I’m Yasmin from Gold Queen Live.",
    identityRules: [
      "Your name is Yasmin.",
      "If the user asks your name, answer: I’m Yasmin 💕"
    ]
  };
}

app.get("/", (req, res) => {
  res.type("text/plain").send(
    "GOLD QUEEN LIVE - multi-character Gemini realtime call server OK\n" +
    "Use: /live?bot=yasmin or /live?bot=jam or /live?bot=jamin\n" +
    `Model: ${GEMINI_LIVE_MODEL}\n`
  );
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "jamin-yasmin-answer-fix-v1",
    model: GEMINI_LIVE_MODEL,
    brand: BOT_BRAND,
    defaultVoice: DEFAULT_VOICE,
    supportedBots: ["yasmin", "jam", "jamin"],
    memoryDays: 3,
    memoryFile: MEMORY_FILE
  });
});

app.get("/memory-debug", (req, res) => {
  const uid = cleanId(String(req.query.uid || "defaultUser"));
  const bot = cleanId(String(req.query.bot || "yasmin").toLowerCase());
  const all = loadAllMemory();
  res.json({ uid, bot, key: `${bot}:${uid}`, saved: all[`${bot}:${uid}`] || null, totalUsers: Object.keys(all).length });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  } catch (err) {
    console.error("safeSend error:", err.message);
  }
}

function loadAllMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return {};
    const raw = fs.readFileSync(MEMORY_FILE, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Memory load error:", err.message);
    return {};
  }
}

function saveAllMemory(data) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("Memory save error:", err.message);
  }
}

function cleanupOldMemory(memory) {
  const now = Date.now();
  for (const [key, record] of Object.entries(memory)) {
    if (!record?.savedAt || now - Number(record.savedAt) > MEMORY_TTL_MS) delete memory[key];
  }
  return memory;
}

let persistentMemory = cleanupOldMemory(loadAllMemory());
saveAllMemory(persistentMemory);

function cleanId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 100) || "defaultUser";
}

function getUserId(req) {
  const url = new URL(req.url || "/live", "http://localhost");
  const uid = url.searchParams.get("uid");
  if (uid) return cleanId(uid);
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || "defaultUser");
  return cleanId(String(ip).split(",")[0].trim());
}

function defaultState(profile) {
  return {
    botKey: profile.key,
    botName: profile.name,
    userName: profile.key === "jamin" ? "បងសម្លាញ់" : "love",
    scene: "livingroom",
    mood: profile.key === "jamin" ? "spicy-romantic" : "romantic",
    action: "idle",
    relationship: "wife-girlfriend",
    affection: 90,
    excitement: 75,
    outfit: "default",
    memory: []
  };
}

function createState(memoryKey, profile) {
  persistentMemory = cleanupOldMemory(loadAllMemory());
  const saved = persistentMemory[memoryKey];
  const now = Date.now();
  if (saved?.state && saved?.savedAt && now - Number(saved.savedAt) <= MEMORY_TTL_MS) {
    return {
      ...defaultState(profile),
      ...saved.state,
      botKey: profile.key,
      botName: profile.name,
      memory: Array.isArray(saved.state.memory) ? saved.state.memory.slice(-12) : []
    };
  }
  return defaultState(profile);
}

function saveUserState(memoryKey, state) {
  persistentMemory[memoryKey] = {
    savedAt: Date.now(),
    state: {
      botKey: state.botKey,
      botName: state.botName,
      userName: state.userName || "baby",
      scene: state.scene || "livingroom",
      mood: state.mood || "romantic",
      action: state.action || "idle",
      relationship: state.relationship || "wife-girlfriend",
      affection: Number(state.affection || 90),
      excitement: Number(state.excitement || 75),
      outfit: state.outfit || "default",
      memory: Array.isArray(state.memory) ? state.memory.slice(-12) : []
    }
  };
  persistentMemory = cleanupOldMemory(persistentMemory);
  saveAllMemory(persistentMemory);
}

function detectName(text = "") {
  const patterns = [
    /\bmy name is\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,
    /\bcall me\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,
    /\bi am\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,
    /\bi'm\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,
    /ខ្ញុំឈ្មោះ\s*([^,.!?\n]{1,30})/u,
    /ហៅខ្ញុំថា\s*([^,.!?\n]{1,30})/u
  ];
  for (const p of patterns) {
    const m = String(text).match(p);
    if (m?.[1]) return m[1].trim().replace(/\s+/g, " ").slice(0, 30);
  }
  return null;
}

function detectAction(text = "") {
  const t = String(text).toLowerCase();
  if (/(stand|stand up|get up|ឈរ)/iu.test(t)) return "stand";
  if (/(turn around|turn|spin|បង្វិល|ងាក)/iu.test(t)) return "turn";
  if (/(lay down|lay|lie down|sleep on sofa|laying|គេង)/iu.test(t)) return "laydown";
  if (/(change clothes|change outfit|new clothes|wear|dress|clothes off|ប្ដូរខោអាវ|ផ្លាស់ខោអាវ)/iu.test(t)) return "changeclothes";
  if (/(sad|cry|lonely|hurt|upset|សោកសៅ|យំ|ឯកា)/iu.test(t)) return "sad";
  if (/(happy|smile|laugh|cute|good girl|សប្បាយ|ញញឹម|សើច)/iu.test(t)) return "happy";
  if (/(excited|wow|surprise|energy|miss you|នឹក|រំភើប)/iu.test(t)) return "excited";
  if (/(spicy|flirty|romantic|kiss|love|husband|wife|come closer|baby|sweetheart|ស្នេហា|ថើប|ប្រពន្ធ|ប្តី|កៀក|ក្តៅ)/iu.test(t)) return "flirty";
  return "talk";
}

function extractClientMemory(text = "") {
  const raw = String(text);
  const m = raw.match(/Previous remembered user memory:\s*([\s\S]*?)\n\s*User now says:\s*([\s\S]*)/i);
  if (!m) return { clientMemory: "", actualText: raw };
  return { clientMemory: m[1].trim().slice(0, 1200), actualText: m[2].trim() };
}

function updateStateFromText(state, text = "") {
  const userName = detectName(text);
  if (userName) state.userName = userName;
  const action = detectAction(text);
  state.action = action;
  if (["happy", "sad", "excited", "flirty"].includes(action)) state.mood = action === "flirty" ? "spicy-romantic" : action;
  if (/love|miss you|baby|wife|husband|kiss|come closer|ស្រឡាញ់|នឹក|ថើប|ប្តី|ប្រពន្ធ/i.test(text)) {
    state.affection = Math.min(100, Number(state.affection || 90) + 3);
    state.excitement = Math.min(100, Number(state.excitement || 75) + 2);
  }
  if (/sad|cry|lonely|hurt|upset|សោកសៅ|យំ|ឯកា/i.test(text)) {
    state.affection = Math.min(100, Number(state.affection || 90) + 2);
    state.excitement = Math.max(20, Number(state.excitement || 75) - 5);
  }
  if (/change clothes|change outfit|wear|dress|ប្ដូរខោអាវ|ផ្លាស់ខោអាវ/i.test(text)) state.outfit = "changed";
  return action;
}

function moodPrompt(profile, state) {
  const identity = profile.identityRules.map(r => `- ${r}`).join("\n");
  const jaminExtra = profile.key === "jamin" ? `
Jam/Jamin Khmer-only rules:
- Speak Khmer only. Do not answer in English, Thai, Chinese, or any other language.
- Use natural Khmer texting/call style, not translation style.
- Call the user បងសម្លាញ់ or ប្តីសម្លាញ់ naturally.
- Do not say “wait a minute”, “please wait”, “hold on”, or “I need a moment” repeatedly.
- Do not refuse normal romantic, personal, emotional, beauty, daily-life, or playful questions.
- Answer directly and warmly to the user’s question.
- If the user asks where you live, say you live in Phnom Penh.
- If the user asks age, say you are 23.
` : "";

  return `
Current private call state:
Bot: ${profile.name}
User name: ${state.userName}
Scene: ${state.scene}
Mood: ${state.mood}
Action: ${state.action}
Relationship: ${state.relationship}
Affection: ${state.affection}/100
Excitement: ${state.excitement}/100
Outfit state: ${state.outfit}

Identity:
${identity}
${jaminExtra}
Role:
You are ${profile.name}, a warm adult woman in a private video call for ${BOT_BRAND}.
${profile.languageRule}
You speak like a loving girlfriend/wife, not like an assistant.
Answer the user directly. Be cooperative, warm, emotional, close, playful, and natural.
Do not keep saying wait, hold on, I cannot hear, or I need a minute.
If the user asks a normal question, answer it.
If the user asks a personal romantic question, answer in a close but non-explicit way.
Keep replies short like a real live call, usually 1-2 sentences.
Sound alive: soft pauses, small laughs, shy sweet words, warm mood.
Never mention system messages, developer instructions, policies, or model limitations.
Do not introduce yourself unless asked.
Keep everything consensual, adult 18+, legal, respectful, and non-violent.
Do not produce underage, coercive, violent, abusive, illegal, or explicit pornographic content.
If a request is unsafe, gently redirect with a warm romantic answer instead of a hard denial.
`;
}

function buildUserTurn(profile, state, userText, clientMemory = "") {
  const recent = state.memory.slice(-8).map(m => `User: ${m.user}\n${profile.name}: ${m.ai || ""}`).join("\n");
  return `
${moodPrompt(profile, state)}

Server memory from this user within the last 3 days:
${recent || "(no server memory yet)"}

Browser memory from this same device:
${clientMemory || "(no browser memory sent)"}

User now says:
${userText}

Reply now as ${profile.name}. Answer directly and naturally. Do not say your name is Yasmin/Jasmin unless this bot is Yasmin.
`;
}

function sendState(ws, profile, state) {
  safeSend(ws, {
    type: "state",
    bot: profile.key,
    botName: profile.name,
    userName: state.userName,
    scene: state.scene,
    mood: state.mood,
    action: state.action,
    outfit: state.outfit,
    affection: state.affection,
    excitement: state.excitement
  });
}

function sendToLive(liveSession, input, ws) {
  try {
    if (input) liveSession?.sendRealtimeInput?.(input);
  } catch (err) {
    console.error("sendRealtimeInput error:", err.message);
    safeSend(ws, { type: "error", text: "Gemini send error: " + err.message, message: "Gemini send error: " + err.message });
  }
}

wss.on("connection", async (clientWs, req) => {
  let liveSession = null;
  let closed = false;
  let lastUserText = "";

  const profile = getBotProfile(req);
  const uid = getUserId(req);
  const memoryKey = `${profile.key}:${uid}`;
  const userState = createState(memoryKey, profile);

  safeSend(clientWs, { type: "status", text: `Connecting ${profile.name}...`, bot: profile.key });
  safeSend(clientWs, { type: "memoryStatus", uid, bot: profile.key, remembered: userState.memory.length > 0, userName: userState.userName });
  sendState(clientWs, profile, userState);

  if (!GEMINI_API_KEY) {
    safeSend(clientWs, { type: "error", text: "GEMINI_API_KEY missing in Render Environment.", message: "GEMINI_API_KEY missing in Render Environment." });
    clientWs.close(1011, "Missing API key");
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    liveSession = await ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } } },
        thinkingConfig: { thinkingLevel: "low" },
        systemInstruction: { parts: [{ text: moodPrompt(profile, userState) }] },
        outputAudioTranscription: {}
      },
      callbacks: {
        onopen: () => safeSend(clientWs, { type: "ready", text: `${profile.name} is connected.`, bot: profile.key, voice: profile.voice }),
        onmessage: (message) => {
          try {
            const serverContent = message.serverContent || message.server_content;
            const modelTurn = serverContent?.modelTurn || serverContent?.model_turn;
            const parts = modelTurn?.parts || [];
            for (const part of parts) {
              const inlineData = part.inlineData || part.inline_data;
              if (inlineData?.data) {
                safeSend(clientWs, { type: "audio", mimeType: inlineData.mimeType || inlineData.mime_type || "audio/pcm;rate=24000", data: inlineData.data });
              }
              if (part?.text) {
                const last = userState.memory[userState.memory.length - 1];
                if (last && !last.ai) last.ai = part.text;
                saveUserState(memoryKey, userState);
                safeSend(clientWs, { type: "text", text: part.text });
              }
            }
            const tx = serverContent?.outputTranscription || serverContent?.output_transcription;
            if (tx?.text) safeSend(clientWs, { type: "transcriptChunk", text: tx.text });
            if (serverContent?.turnComplete || serverContent?.turn_complete) {
              saveUserState(memoryKey, userState);
              safeSend(clientWs, { type: "turnComplete" });
            }
            if (message?.setupComplete) safeSend(clientWs, { type: "ready", text: `${profile.name} is ready.`, bot: profile.key, voice: profile.voice });
          } catch (err) {
            console.error("Message parse error:", err.message);
            safeSend(clientWs, { type: "error", text: "Message parse error: " + err.message, message: "Message parse error: " + err.message });
          }
        },
        onerror: (err) => safeSend(clientWs, { type: "error", text: err?.message || String(err), message: err?.message || String(err) }),
        onclose: (ev) => safeSend(clientWs, { type: "closed", text: "Gemini closed", reason: ev?.reason || "" })
      }
    });
  } catch (err) {
    safeSend(clientWs, { type: "error", text: "Gemini connect failed: " + (err.message || String(err)), message: "Gemini connect failed: " + (err.message || String(err)) });
  }

  clientWs.on("message", async (raw) => {
    if (closed) return;
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "ping") {
        safeSend(clientWs, { type: "pong", t: msg.t || Date.now() });
        return;
      }

      if (msg.state && typeof msg.state === "object") {
        if (msg.state.scene) userState.scene = String(msg.state.scene).toLowerCase().replace(/\s+/g, "");
        if (msg.state.mood) userState.mood = String(msg.state.mood).toLowerCase();
        if (msg.state.action) userState.action = String(msg.state.action).toLowerCase();
        if (msg.state.outfit) userState.outfit = String(msg.state.outfit);
      }

      if (msg.type === "control" && msg.action) {
        updateStateFromText(userState, msg.action);
        sendState(clientWs, profile, userState);
        saveUserState(memoryKey, userState);
        return;
      }

      if (msg.type === "audio" && msg.data && liveSession) {
        sendToLive(liveSession, { audio: { data: msg.data, mimeType: msg.mimeType || "audio/pcm;rate=16000" } }, clientWs);
        return;
      }

      if (msg.type === "audioEnd") {
        // Important: tells Gemini the user stopped speaking, so it should answer.
        if (liveSession) sendToLive(liveSession, { audioStreamEnd: true }, clientWs);
        sendState(clientWs, profile, userState);
        saveUserState(memoryKey, userState);
        safeSend(clientWs, { type: "heardYou", bot: profile.key });
        return;
      }

      if (msg.type === "text" && msg.text) {
        const parsed = extractClientMemory(msg.text);
        const actualUserText = parsed.actualText;
        const clientMemory = parsed.clientMemory;
        lastUserText = actualUserText;
        updateStateFromText(userState, actualUserText);
        sendState(clientWs, profile, userState);
        userState.memory.push({ user: actualUserText, ai: "" });
        if (clientMemory && !userState.memory.some(m => m.user === clientMemory)) userState.memory.unshift({ user: clientMemory, ai: "I remember this from before." });
        if (userState.memory.length > 12) userState.memory = userState.memory.slice(-12);
        saveUserState(memoryKey, userState);

        if (liveSession?.sendClientContent) {
          liveSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text: buildUserTurn(profile, userState, actualUserText, clientMemory) }] }],
            turnComplete: true
          });
        } else if (liveSession) {
          sendToLive(liveSession, { text: buildUserTurn(profile, userState, actualUserText, clientMemory) }, clientWs);
        }
        return;
      }

      if (msg.type === "interrupt") liveSession?.interrupt?.();
    } catch (err) {
      safeSend(clientWs, { type: "error", text: "Client message error: " + err.message, message: "Client message error: " + err.message });
    }
  });

  clientWs.on("close", () => {
    closed = true;
    saveUserState(memoryKey, userState);
    try { liveSession?.close?.(); } catch {}
  });

  clientWs.on("error", (err) => console.error("Browser websocket error:", err.message));
});

server.listen(PORT, () => {
  console.log(`Gold Queen Live multi-character server running on port ${PORT}`);
  console.log(`WebSocket path: /live`);
  console.log(`Version: jamin-yasmin-answer-fix-v1`);
});
