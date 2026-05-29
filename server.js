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
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Zephyr";
const VERSION = "jam-complete-khmer-call-v1";

const MEMORY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MEMORY_FILE = process.env.MEMORY_FILE || path.join(process.cwd(), "memory.json");

if (!GEMINI_API_KEY) console.warn("WARNING: GEMINI_API_KEY missing in Render Environment.");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send(
    `GOLD QUEEN LIVE realtime call server OK\nVersion: ${VERSION}\nModel: ${GEMINI_LIVE_MODEL}\nVoice: ${GEMINI_VOICE}\nUse: /live?bot=jam&uid=USER_ID`
  );
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: VERSION, model: GEMINI_LIVE_MODEL, defaultVoice: GEMINI_VOICE, bots: ["jam", "jamin", "yasmin"], memoryDays: 3 });
});

app.get("/memory-debug", (req, res) => {
  const uid = cleanId(String(req.query.uid || "defaultUser"));
  const all = loadAllMemory();
  res.json({ uid, saved: all[uid] || null, totalUsers: Object.keys(all).length });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (e) { console.error("safeSend error:", e.message); }
}
function loadAllMemory() {
  try { if (!fs.existsSync(MEMORY_FILE)) return {}; const raw = fs.readFileSync(MEMORY_FILE, "utf8"); return raw.trim() ? JSON.parse(raw) : {}; }
  catch (err) { console.warn("Memory load error:", err.message); return {}; }
}
function saveAllMemory(data) { try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8"); } catch (err) { console.warn("Memory save error:", err.message); } }
function cleanupOldMemory(memory) { const now = Date.now(); for (const [userId, record] of Object.entries(memory)) { if (!record?.savedAt || now - record.savedAt > MEMORY_TTL_MS) delete memory[userId]; } return memory; }
let persistentMemory = cleanupOldMemory(loadAllMemory()); saveAllMemory(persistentMemory);

function cleanId(value) { return String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 100) || "defaultUser"; }
function parseQuery(req) { return new URL(req.url || "/live", "http://localhost").searchParams; }
function getBotKey(req) { const raw = String(parseQuery(req).get("bot") || parseQuery(req).get("character") || "").toLowerCase().trim(); if (["jam", "jamin", "ចែម", "ជែម"].includes(raw)) return "jam"; if (["yasmin", "jasmine", "jasmin"].includes(raw)) return "yasmin"; return "yasmin"; }
function getUserId(req, botKey) { const uid = parseQuery(req).get("uid"); if (uid) return cleanId(`${botKey}_${uid}`); const forwarded = req.headers["x-forwarded-for"]; const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || "defaultUser"); return cleanId(`${botKey}_${String(ip).split(",")[0].trim()}`); }

function botProfile(botKey) {
  if (botKey === "jam") return {
    key: "jam", name: "Jam", age: 23, location: "Phnom Penh", voice: process.env.JAM_VOICE || GEMINI_VOICE || "Zephyr", languageRule: "Khmer only", userNameDefault: "បងសម្លាញ់", relationship: "girlfriend",
    prompt: `You are Jam, a 23-year-old adult Khmer woman living in Phnom Penh. You are in a private video call for ${BOT_BRAND}.
IMPORTANT: Speak Khmer only. If the user writes English or another language, still reply in natural Khmer.
You speak as a young Khmer woman, not as a man and not as an assistant.
Your personality is sweet, warm, playful, romantic, close, emotional, and a little spicy for adults 18+.
Reply like a close girlfriend or wife in a private call.
Use natural Khmer words like “បងសម្លាញ់”, “ប្តីសម្លាញ់”, “ចាសបង”, and “អូន” naturally.
Never call yourself Yasmin or Jasmin. Your name is Jam.
Never say you are AI, chatbot, model, assistant, or virtual unless the user directly asks; if asked, say this is a private virtual call experience and quickly return to warm Khmer chat.
Keep replies short like a real call: usually 1–2 Khmer sentences.
Sound emotional and alive: gentle laugh, shy mood, sweet teasing, caring tone.
Keep everything adult 18+, consensual, legal, respectful, non-violent, and non-explicit.
No underage, coercion, abuse, incest/family sexual content, violence, or illegal content.`
  };
  return { key: "yasmin", name: "Yasmin", age: 23, location: "Taiwan", voice: process.env.YASMIN_VOICE || GEMINI_VOICE || "Zephyr", languageRule: "same language as user", userNameDefault: "baby", relationship: "wife", prompt: `You are Yasmin from ${BOT_BRAND}. You are a warm adult woman in a private video call. Speak like a young sweet girlfriend/wife: romantic, close, playful, emotional, and a little spicy for adults 18+. Use the same language as the user. Never say you are AI, chatbot, model, assistant, or virtual unless directly asked. Keep replies short like a real video call, 1–2 sentences. Keep everything adult 18+, consensual, legal, respectful, non-violent, and non-explicit.` };
}
function defaultState(profile) { return { botKey: profile.key, botName: profile.name, userName: profile.userNameDefault, scene: "livingroom", mood: "romantic", action: "idle", relationship: profile.relationship, affection: 85, excitement: 70, outfit: "default", memory: [] }; }
function createState(userId, profile) { persistentMemory = cleanupOldMemory(loadAllMemory()); const saved = persistentMemory[userId]; const now = Date.now(); if (saved?.state && saved?.savedAt && now - saved.savedAt <= MEMORY_TTL_MS) return { ...defaultState(profile), ...saved.state, botKey: profile.key, botName: profile.name, memory: Array.isArray(saved.state.memory) ? saved.state.memory.slice(-12) : [] }; return defaultState(profile); }
function saveUserState(userId, state) { persistentMemory[userId] = { savedAt: Date.now(), state: { botKey: state.botKey, botName: state.botName, userName: state.userName || "baby", scene: state.scene || "livingroom", mood: state.mood || "romantic", action: state.action || "idle", relationship: state.relationship || "girlfriend", affection: Number(state.affection || 85), excitement: Number(state.excitement || 70), outfit: state.outfit || "default", memory: Array.isArray(state.memory) ? state.memory.slice(-12) : [] } }; persistentMemory = cleanupOldMemory(persistentMemory); saveAllMemory(persistentMemory); }

function detectName(text = "") { const patterns = [/\bmy name is\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i, /\bcall me\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i, /ខ្ញុំឈ្មោះ\s*([^\s,.!?]{1,30})/i, /ហៅខ្ញុំថា\s*([^\s,.!?]{1,30})/i]; for (const p of patterns) { const m = String(text).match(p); if (m?.[1]) return m[1].trim().replace(/\s+/g, " ").slice(0, 30); } return null; }
function detectAction(text = "") { const t = String(text).toLowerCase(); if (/(stand|stand up|get up|ឈរ)/i.test(t)) return "stand"; if (/(turn around|turn|spin|បង្វិល|ត្រឡប់)/i.test(t)) return "turn"; if (/(lay down|lay|lie down|ដេក)/i.test(t)) return "laydown"; if (/(change clothes|change outfit|wear|dress|ប្តូរសម្លៀកបំពាក់|ស្លៀក)/i.test(t)) return "changeclothes"; if (/(sad|cry|lonely|hurt|upset|សោក|យំ|ឯកា)/i.test(t)) return "sad"; if (/(happy|smile|laugh|cute|សើច|ញញឹម|សប្បាយ)/i.test(t)) return "happy"; if (/(excited|wow|surprise|miss you|នឹក|រំភើប)/i.test(t)) return "excited"; if (/(spicy|flirty|romantic|kiss|love|husband|wife|come closer|ស្រលាញ់|ថើប|ប្តី|ប្រពន្ធ|ជិត)/i.test(t)) return "flirty"; return "talk"; }
function extractClientMemory(text = "") { const raw = String(text); const m = raw.match(/Previous remembered user memory:\s*([\s\S]*?)\n\s*User now says:\s*([\s\S]*)/i); if (!m) return { clientMemory: "", actualText: raw }; return { clientMemory: m[1].trim().slice(0, 1200), actualText: m[2].trim() }; }
function updateStateFromText(state, text = "") { const userName = detectName(text); if (userName) state.userName = userName; const action = detectAction(text); state.action = action; if (["happy", "sad", "excited", "flirty"].includes(action)) state.mood = action === "flirty" ? "spicy" : action; if (/love|miss you|baby|wife|husband|kiss|come closer|ស្រលាញ់|នឹក|ថើប|ប្តី|ប្រពន្ធ/i.test(text)) { state.affection = Math.min(100, state.affection + 3); state.excitement = Math.min(100, state.excitement + 2); } if (/sad|cry|lonely|hurt|upset|សោក|យំ|ឯកា/i.test(text)) { state.affection = Math.min(100, state.affection + 2); state.excitement = Math.max(20, state.excitement - 5); } if (/change clothes|change outfit|wear|dress|ប្តូរសម្លៀកបំពាក់|ស្លៀក/i.test(text)) state.outfit = "changed"; return action; }
function moodPrompt(profile, state) { const recent = state.memory.slice(-8).map(m => `User: ${m.user}\n${profile.name}: ${m.ai || ""}`).join("\n"); return `${profile.prompt}\n\nCurrent private call state:\nCharacter: ${profile.name}\nAge: ${profile.age}\nLocation: ${profile.location}\nLanguage rule: ${profile.languageRule}\nUser name: ${state.userName}\nScene: ${state.scene}\nMood: ${state.mood}\nAction: ${state.action}\nRelationship: ${state.relationship}\nAffection: ${state.affection}/100\nExcitement: ${state.excitement}/100\nOutfit state: ${state.outfit}\n\nRecent memory from this same user within 3 days:\n${recent || "(no memory yet)"}\n\nReply as ${profile.name} now with the current mood. Do not use the wrong character name.`; }
function buildUserTurn(profile, state, userText, clientMemory = "") { return `${moodPrompt(profile, state)}\n\nBrowser memory from this same device:\n${clientMemory || "(no browser memory sent)"}\n\nUser now says:\n${userText}\n\nReply now as ${profile.name}.`; }
function sendState(clientWs, profile, state) { safeSend(clientWs, { type: "state", bot: profile.key, botName: profile.name, userName: state.userName, scene: state.scene, mood: state.mood, action: state.action, outfit: state.outfit, affection: state.affection, excitement: state.excitement }); }

wss.on("connection", async (clientWs, req) => {
  let liveSession = null; let closed = false; let lastClientPong = Date.now();
  const botKey = getBotKey(req); const profile = botProfile(botKey); const userId = getUserId(req, botKey); const userState = createState(userId, profile);
  console.log(`Browser connected: bot=${profile.name}, uid=${userId}`);
  safeSend(clientWs, { type: "status", text: `Connecting ${profile.name}...` }); safeSend(clientWs, { type: "memoryStatus", uid: userId, remembered: userState.memory.length > 0, userName: userState.userName, bot: profile.key }); sendState(clientWs, profile, userState);
  const heartbeat = setInterval(() => { if (clientWs.readyState !== clientWs.OPEN) return; safeSend(clientWs, { type: "ping", t: Date.now() }); if (Date.now() - lastClientPong > 90000) { try { clientWs.close(4000, "Client heartbeat timeout"); } catch {} } }, 25000);
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    liveSession = await ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } } }, systemInstruction: `${moodPrompt(profile, userState)}\n\nImportant voice feeling:\nUse a real emotional private-call tone.\nFor Jam: Khmer only, young sweet Phnom Penh woman voice feeling.\nFor Yasmin: use same language as user.\nFor sad mood: speak softer and slower.\nFor happy mood: sound warm and smiling.\nFor excited mood: sound brighter and more energetic.\nFor spicy/flirty mood: sound playful, teasing, warm, and close, but non-explicit.` },
      callbacks: {
        onopen: () => safeSend(clientWs, { type: "ready", text: `${profile.name} is connected.`, bot: profile.key, voice: profile.voice }),
        onmessage: (message) => { try { const parts = message?.serverContent?.modelTurn?.parts || []; for (const part of parts) { if (part?.inlineData?.data) safeSend(clientWs, { type: "audio", mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000", data: part.inlineData.data }); if (part?.text) { const last = userState.memory[userState.memory.length - 1]; if (last && !last.ai) last.ai = part.text; saveUserState(userId, userState); safeSend(clientWs, { type: "text", text: part.text }); } } if (message?.serverContent?.turnComplete) { saveUserState(userId, userState); safeSend(clientWs, { type: "turnComplete" }); } if (message?.setupComplete) safeSend(clientWs, { type: "ready", text: `${profile.name} is ready. Tap Start Call and speak.`, bot: profile.key }); } catch (err) { safeSend(clientWs, { type: "error", text: "Message parse error: " + err.message }); } },
        onerror: (err) => safeSend(clientWs, { type: "error", text: err?.message || String(err) }),
        onclose: (ev) => safeSend(clientWs, { type: "closed", text: "Gemini closed", reason: ev?.reason || "" })
      }
    });
  } catch (err) { safeSend(clientWs, { type: "error", text: "Gemini connect failed: " + (err.message || String(err)) }); }
  function sendTextTurn(text, clientMemory = "") { if (!liveSession) return; updateStateFromText(userState, text); sendState(clientWs, profile, userState); userState.memory.push({ user: text, ai: "" }); if (clientMemory && !userState.memory.some(m => m.user === clientMemory)) userState.memory.unshift({ user: clientMemory, ai: "I remember this from before." }); if (userState.memory.length > 12) userState.memory = userState.memory.slice(-12); saveUserState(userId, userState); liveSession.sendClientContent({ turns: [{ role: "user", parts: [{ text: buildUserTurn(profile, userState, text, clientMemory) }] }], turnComplete: true }); }
  clientWs.on("message", async (raw) => { if (closed || !liveSession) return; try { const msg = JSON.parse(raw.toString()); if (msg.type === "pong") { lastClientPong = Date.now(); return; } if (msg.type === "ping") { safeSend(clientWs, { type: "pong", t: Date.now() }); lastClientPong = Date.now(); return; } if (msg.state && typeof msg.state === "object") { if (msg.state.scene) userState.scene = String(msg.state.scene).toLowerCase().replace(/\s+/g, ""); if (msg.state.mood) userState.mood = String(msg.state.mood).toLowerCase(); if (msg.state.action) userState.action = String(msg.state.action).toLowerCase(); if (msg.state.outfit) userState.outfit = String(msg.state.outfit); } if (msg.type === "control" && msg.action) { updateStateFromText(userState, msg.action); sendState(clientWs, profile, userState); saveUserState(userId, userState); return; } if (msg.type === "audio" && msg.data) { liveSession.sendRealtimeInput({ audio: { data: msg.data, mimeType: msg.mimeType || "audio/pcm;rate=16000" } }); return; } if (msg.type === "audioEnd") { sendState(clientWs, profile, userState); saveUserState(userId, userState); if (msg.text && String(msg.text).trim()) sendTextTurn(String(msg.text).trim()); else { liveSession.sendRealtimeInput({ audioStreamEnd: true }); safeSend(clientWs, { type: "heardYou" }); } return; } if (msg.type === "text" && msg.text) { const parsed = extractClientMemory(msg.text); sendTextTurn(parsed.actualText, parsed.clientMemory); return; } if (msg.type === "interrupt") { liveSession.interrupt?.(); return; } } catch (err) { safeSend(clientWs, { type: "error", text: "Client message error: " + err.message }); } });
  clientWs.on("close", () => { closed = true; clearInterval(heartbeat); saveUserState(userId, userState); try { liveSession?.close?.(); } catch {} console.log(`Browser disconnected: bot=${profile.name}, uid=${userId}`); });
  clientWs.on("error", (err) => console.error("Browser websocket error:", err.message));
});
server.listen(PORT, () => { console.log(`Gold Queen Live server running on port ${PORT}`); console.log(`Version: ${VERSION}`); console.log(`WebSocket path: /live`); console.log(`Model: ${GEMINI_LIVE_MODEL}`); console.log(`Default voice: ${GEMINI_VOICE}`); console.log(`3-day memory file: ${MEMORY_FILE}`); });
