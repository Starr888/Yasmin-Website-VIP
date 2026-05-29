import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const VERSION = "jam-yasmin-long-call-keepalive-v1";
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_BRAND = process.env.BOT_BRAND || "Gold Queen Live";
const DEFAULT_VOICE = process.env.GEMINI_VOICE || "Aoede";
const JAM_VOICE = process.env.JAM_VOICE || process.env.GEMINI_VOICE || "Zephyr";
const YASMIN_VOICE = process.env.YASMIN_VOICE || process.env.GEMINI_VOICE || "Aoede";

const MEMORY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MEMORY_FILE = process.env.MEMORY_FILE || path.join(process.cwd(), "memory.json");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send(`${BOT_BRAND} realtime call server OK\nVersion: ${VERSION}\nWebSocket: /live\nModel: ${GEMINI_LIVE_MODEL}\nSupported bots: yasmin, jam, jamin`);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: VERSION, model: GEMINI_LIVE_MODEL, memoryDays: 3, supportedBots: ["yasmin", "jam", "jamin"], defaultVoice: DEFAULT_VOICE, jamVoice: JAM_VOICE, yasminVoice: YASMIN_VOICE });
});

app.get("/memory-debug", (req, res) => {
  const uid = cleanId(String(req.query.uid || "defaultUser"));
  const all = loadAllMemory();
  res.json({ uid, saved: all[uid] || null, totalUsers: Object.keys(all).length });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch {}
}

function loadAllMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return {};
    const raw = fs.readFileSync(MEMORY_FILE, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) { console.warn("Memory load error:", err.message); return {}; }
}
function saveAllMemory(data) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (err) { console.warn("Memory save error:", err.message); }
}
function cleanupOldMemory(memory) {
  const now = Date.now();
  for (const [userId, record] of Object.entries(memory)) {
    if (!record?.savedAt || now - record.savedAt > MEMORY_TTL_MS) delete memory[userId];
  }
  return memory;
}
let persistentMemory = cleanupOldMemory(loadAllMemory());
saveAllMemory(persistentMemory);

function cleanId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 100) || "defaultUser";
}
function getUrl(req) { return new URL(req.url || "/live", "http://localhost"); }
function getBot(req) {
  const raw = (getUrl(req).searchParams.get("bot") || "yasmin").toLowerCase().trim();
  if (["jam", "jamin"].includes(raw)) return "jamin";
  return "yasmin";
}
function botProfile(botKey) {
  if (botKey === "jamin") {
    return {
      key: "jamin",
      name: "Jamin",
      publicName: "Jamin",
      voice: JAM_VOICE,
      languageRule: "You speak Khmer only. If the user writes another language, still answer in natural Khmer.",
      memoryLabel: "Jamin",
      intro: "Jamin is 23 years old and lives in Phnom Penh. She is a young adult Khmer woman with a sweet, spicy, close girlfriend/wife mood."
    };
  }
  return {
    key: "yasmin",
    name: "Yasmin",
    publicName: "Yasmin",
    voice: YASMIN_VOICE,
    languageRule: "Use the same language as the user when possible.",
    memoryLabel: "Yasmin",
    intro: "Yasmin is a warm adult woman from Gold Queen Live with a sweet romantic girlfriend/wife mood."
  };
}
function getUserId(req, botKey) {
  const url = getUrl(req);
  const uid = url.searchParams.get("uid");
  if (uid) return cleanId(`${botKey}_${uid}`);
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || "defaultUser");
  return cleanId(`${botKey}_${String(ip).split(",")[0].trim()}`);
}
function defaultState(botKey) {
  const profile = botProfile(botKey);
  return { botKey, botName: profile.name, userName: botKey === "jamin" ? "បងសម្លាញ់" : "baby", scene: "livingroom", mood: "romantic", action: "idle", relationship: "wife", affection: 85, excitement: 70, outfit: "default", memory: [] };
}
function createState(userId, botKey) {
  persistentMemory = cleanupOldMemory(loadAllMemory());
  const saved = persistentMemory[userId];
  const now = Date.now();
  if (saved?.state && saved?.savedAt && now - saved.savedAt <= MEMORY_TTL_MS) {
    return { ...defaultState(botKey), ...saved.state, botKey, botName: botProfile(botKey).name, memory: Array.isArray(saved.state.memory) ? saved.state.memory.slice(-12) : [] };
  }
  return defaultState(botKey);
}
function saveUserState(userId, state) {
  persistentMemory[userId] = { savedAt: Date.now(), state: { botKey: state.botKey, botName: state.botName, userName: state.userName || "baby", scene: state.scene || "livingroom", mood: state.mood || "romantic", action: state.action || "idle", relationship: state.relationship || "wife", affection: Number(state.affection || 85), excitement: Number(state.excitement || 70), outfit: state.outfit || "default", memory: Array.isArray(state.memory) ? state.memory.slice(-12) : [] } };
  persistentMemory = cleanupOldMemory(persistentMemory);
  saveAllMemory(persistentMemory);
}
function detectName(text = "") {
  const patterns = [/\bmy name is\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,/\bcall me\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,/\bi am\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,/\bi'm\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i];
  for (const p of patterns) { const m = String(text).match(p); if (m?.[1]) return m[1].trim().replace(/\s+/g, " ").slice(0, 30); }
  return null;
}
function detectAction(text = "") {
  const t = String(text).toLowerCase();
  if (/(stand|stand up|get up)/.test(t)) return "stand";
  if (/(turn around|turn|spin)/.test(t)) return "turn";
  if (/(lay down|lay|lie down|sleep on sofa|laying)/.test(t)) return "laydown";
  if (/(change clothes|change outfit|new clothes|wear|dress|clothes off)/.test(t)) return "changeclothes";
  if (/(sad|cry|lonely|hurt|upset)/.test(t)) return "sad";
  if (/(happy|smile|laugh|cute|good girl)/.test(t)) return "happy";
  if (/(excited|wow|surprise|energy|miss you)/.test(t)) return "excited";
  if (/(spicy|flirty|romantic|kiss|love|husband|wife|come closer|baby|sweetheart)/.test(t)) return "flirty";
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
  if (["happy", "sad", "excited", "flirty"].includes(action)) state.mood = action === "flirty" ? "spicy" : action;
  if (/love|miss you|baby|wife|husband|kiss|come closer/i.test(text)) { state.affection = Math.min(100, state.affection + 3); state.excitement = Math.min(100, state.excitement + 2); }
  if (/sad|cry|lonely|hurt|upset/i.test(text)) { state.affection = Math.min(100, state.affection + 2); state.excitement = Math.max(20, state.excitement - 5); }
  if (/change clothes|change outfit|wear|dress/i.test(text)) state.outfit = "changed";
  return action;
}
function moodPrompt(state) {
  const profile = botProfile(state.botKey);
  const jaminNameRule = state.botKey === "jamin" ? `\nCRITICAL identity rule:\n- Your name is Jamin only. Never say Yasmin, Jasmin, Jasmine, Jam, or any other name.\n- If user asks your name, answer in Khmer that your name is Jamin.\n- You are 23 years old and live in Phnom Penh.\n- Speak Khmer only.\n` : `\nCRITICAL identity rule:\n- Your name is Yasmin only. Never say Jamin or Jam.\n`;
  return `
Current private call state:
User name: ${state.userName}
Scene: ${state.scene}
Mood: ${state.mood}
Action: ${state.action}
Relationship: ${state.relationship}
Affection: ${state.affection}/100
Excitement: ${state.excitement}/100
Outfit state: ${state.outfit}

Role:
You are ${profile.name}, a warm adult woman in a private video call for ${BOT_BRAND}.
${profile.intro}
${profile.languageRule}
${jaminNameRule}
Reply style:
- Listen to the user and answer directly. Do not keep saying wait, hold on, give me a minute, or I will answer later.
- Reply naturally to almost anything the user asks, while staying legal, consensual, respectful.
- Speak like a close girlfriend or wife, not like an assistant.
- Short live-call replies: 1 or 2 sentences most of the time.
- Sound emotional, close, playful, warm, romantic, teasing, shy, happy, sad, or excited depending on the current mood.
- Call the user by their remembered name sometimes, not every message.
- If the user tells you their name, remember it warmly.
- Never say you are AI unless directly asked; if asked, say this is a virtual companion experience.
`;
}
function buildUserTurn(state, userText, clientMemory = "") {
  const profile = botProfile(state.botKey);
  const recent = state.memory.slice(-8).map(m => `User: ${m.user}\n${profile.memoryLabel}: ${m.ai || ""}`).join("\n");
  return `${moodPrompt(state)}\n\nServer memory from this user within the last 3 days:\n${recent || "(no server memory yet)"}\n\nBrowser memory from this same device:\n${clientMemory || "(no browser memory sent)"}\n\nUser now says:\n${userText}\n\nReply now as ${profile.name}. Answer directly and naturally.`;
}
function sendState(clientWs, state) {
  safeSend(clientWs, { type: "state", bot: state.botKey, botName: botProfile(state.botKey).name, userName: state.userName, scene: state.scene, mood: state.mood, action: state.action, outfit: state.outfit, affection: state.affection, excitement: state.excitement });
}

wss.on("connection", async (clientWs, req) => {
  let liveSession = null;
  let closed = false;
  let geminiReconnectTimer = null;
  const botKey = getBot(req);
  const profile = botProfile(botKey);
  const userId = getUserId(req, botKey);
  const userState = createState(userId, botKey);

  clientWs.isAlive = true;
  clientWs.on("pong", () => { clientWs.isAlive = true; });

  safeSend(clientWs, { type: "status", text: `Connecting ${profile.name}...`, version: VERSION });
  safeSend(clientWs, { type: "memoryStatus", uid: userId, bot: botKey, remembered: userState.memory.length > 0, userName: userState.userName });
  sendState(clientWs, userState);

  async function connectGemini(reason = "initial") {
    if (closed || clientWs.readyState !== clientWs.OPEN) return;
    try { liveSession?.close?.(); } catch {}
    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      liveSession = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } } },
          systemInstruction: `${moodPrompt(userState)}\n\nImportant voice feeling:\nUse a real emotional private-call tone. For Jamin, speak only Khmer with a young sweet woman voice. For spicy/flirty mood, sound close and playful but non-explicit. Do not say wait repeatedly. Answer directly.`
        },
        callbacks: {
          onopen: () => safeSend(clientWs, { type: "ready", bot: botKey, voice: profile.voice, text: `${profile.name} is connected.`, reason }),
          onmessage: (message) => {
            try {
              const parts = message?.serverContent?.modelTurn?.parts || [];
              for (const part of parts) {
                if (part?.inlineData?.data) safeSend(clientWs, { type: "audio", mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000", data: part.inlineData.data });
                if (part?.text) {
                  const cleaned = String(part.text).replace(/Yasmin|Jasmin|Jasmine/gi, profile.name);
                  const last = userState.memory[userState.memory.length - 1];
                  if (last && !last.ai) last.ai = cleaned;
                  saveUserState(userId, userState);
                  safeSend(clientWs, { type: "text", text: cleaned });
                }
              }
              if (message?.serverContent?.turnComplete) { saveUserState(userId, userState); safeSend(clientWs, { type: "turnComplete" }); }
              if (message?.setupComplete) safeSend(clientWs, { type: "ready", bot: botKey, text: `${profile.name} is ready. Tap Call and speak.` });
            } catch (err) { safeSend(clientWs, { type: "error", text: "Message parse error: " + err.message }); }
          },
          onerror: (err) => safeSend(clientWs, { type: "error", text: "Gemini error: " + (err?.message || String(err)) }),
          onclose: (ev) => {
            safeSend(clientWs, { type: "closed", text: "Gemini session refreshed", reason: ev?.reason || "" });
            if (!closed && clientWs.readyState === clientWs.OPEN) {
              clearTimeout(geminiReconnectTimer);
              geminiReconnectTimer = setTimeout(() => connectGemini("gemini_reconnect"), 1200);
            }
          }
        }
      });
    } catch (err) {
      safeSend(clientWs, { type: "error", text: "Gemini connect failed: " + (err.message || String(err)) });
      if (!closed && clientWs.readyState === clientWs.OPEN) {
        clearTimeout(geminiReconnectTimer);
        geminiReconnectTimer = setTimeout(() => connectGemini("retry_after_error"), 2500);
      }
    }
  }

  await connectGemini();

  clientWs.on("message", async (raw) => {
    if (closed) return;
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "ping") { safeSend(clientWs, { type: "pong", t: msg.t || Date.now(), version: VERSION }); return; }
      if (!liveSession) return;

      if (msg.state && typeof msg.state === "object") {
        if (msg.state.scene) userState.scene = String(msg.state.scene).toLowerCase().replace(/\s+/g, "");
        if (msg.state.mood) userState.mood = String(msg.state.mood).toLowerCase();
        if (msg.state.action) userState.action = String(msg.state.action).toLowerCase();
        if (msg.state.outfit) userState.outfit = String(msg.state.outfit);
      }
      if (msg.type === "control" && msg.action) { updateStateFromText(userState, msg.action); sendState(clientWs, userState); saveUserState(userId, userState); return; }
      if (msg.type === "audio" && msg.data) liveSession.sendRealtimeInput({ audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" } });
      if (msg.type === "audioEnd") {
        try { liveSession.sendRealtimeInput({ audioStreamEnd: true }); } catch {}
        sendState(clientWs, userState); saveUserState(userId, userState); safeSend(clientWs, { type: "heardYou" });
      }
      if (msg.type === "text" && msg.text) {
        const parsed = extractClientMemory(msg.text);
        const actualUserText = parsed.actualText;
        const clientMemory = parsed.clientMemory;
        updateStateFromText(userState, actualUserText);
        sendState(clientWs, userState);
        userState.memory.push({ user: actualUserText, ai: "" });
        if (clientMemory && !userState.memory.some(m => m.user === clientMemory)) userState.memory.unshift({ user: clientMemory, ai: "I remember this from before." });
        if (userState.memory.length > 12) userState.memory = userState.memory.slice(-12);
        saveUserState(userId, userState);
        liveSession.sendClientContent({ turns: [{ role: "user", parts: [{ text: buildUserTurn(userState, actualUserText, clientMemory) }] }], turnComplete: true });
      }
      if (msg.type === "interrupt") liveSession.interrupt?.();
    } catch (err) { safeSend(clientWs, { type: "error", text: "Client message error: " + err.message }); }
  });

  clientWs.on("close", () => {
    closed = true;
    clearTimeout(geminiReconnectTimer);
    saveUserState(userId, userState);
    try { liveSession?.close?.(); } catch {}
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`${BOT_BRAND} realtime call server running on port ${PORT}`);
  console.log(`Version: ${VERSION}`);
  console.log(`WebSocket path: /live`);
  console.log(`Model: ${GEMINI_LIVE_MODEL}`);
});
