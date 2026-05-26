import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_NAME = process.env.BOT_NAME || "Yasmin";
const BOT_BRAND = process.env.BOT_BRAND || "Gold Queen Live";

// 3-day memory. Works best when your HTML connects with:
// wss://yasmin-website-vip.onrender.com/live?uid=SAME_BROWSER_ID
const MEMORY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MEMORY_FILE = process.env.MEMORY_FILE || path.join(process.cwd(), "memory.json");

if (!GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is missing. Add it in Render Environment.");
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.type("text/plain").send("GOLD QUEEN LIVE - Gemini realtime emotional call server OK");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    model: GEMINI_LIVE_MODEL,
    bot: BOT_NAME,
    memoryDays: 3,
    memoryFile: MEMORY_FILE
  });
});

// Optional debug page. Open: /memory-debug?uid=YOUR_UID
app.get("/memory-debug", (req, res) => {
  const uid = String(req.query.uid || "defaultUser");
  const all = loadAllMemory();
  res.json({ uid, saved: all[uid] || null, totalUsers: Object.keys(all).length });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
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
  for (const [userId, record] of Object.entries(memory)) {
    if (!record?.savedAt || now - record.savedAt > MEMORY_TTL_MS) {
      delete memory[userId];
    }
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

  // Fallback only. HTML uid is better.
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || "defaultUser");
  return cleanId(String(ip).split(",")[0].trim());
}

function defaultState() {
  return {
    userName: "baby",
    scene: "livingroom",
    mood: "romantic",
    action: "idle",
    relationship: "wife",
    affection: 85,
    excitement: 70,
    outfit: "default",
    memory: []
  };
}

function createState(userId) {
  persistentMemory = cleanupOldMemory(loadAllMemory());
  const saved = persistentMemory[userId];
  const now = Date.now();

  if (saved?.state && saved?.savedAt && now - saved.savedAt <= MEMORY_TTL_MS) {
    return {
      ...defaultState(),
      ...saved.state,
      memory: Array.isArray(saved.state.memory) ? saved.state.memory.slice(-12) : []
    };
  }

  return defaultState();
}

function saveUserState(userId, state) {
  persistentMemory[userId] = {
    savedAt: Date.now(),
    state: {
      userName: state.userName || "baby",
      scene: state.scene || "livingroom",
      mood: state.mood || "romantic",
      action: state.action || "idle",
      relationship: state.relationship || "wife",
      affection: Number(state.affection || 85),
      excitement: Number(state.excitement || 70),
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
    /\bi'm\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i
  ];

  for (const p of patterns) {
    const m = String(text).match(p);
    if (m?.[1]) return m[1].trim().replace(/\s+/g, " ").slice(0, 30);
  }
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

// This reads browser localStorage memory if your HTML sends it.
function extractClientMemory(text = "") {
  const raw = String(text);
  const m = raw.match(/Previous remembered user memory:\s*([\s\S]*?)\n\s*User now says:\s*([\s\S]*)/i);
  if (!m) return { clientMemory: "", actualText: raw };
  return {
    clientMemory: m[1].trim().slice(0, 1200),
    actualText: m[2].trim()
  };
}

function updateStateFromText(state, text = "") {
  const userName = detectName(text);
  if (userName) state.userName = userName;

  const action = detectAction(text);
  state.action = action;

  if (["happy", "sad", "excited", "flirty"].includes(action)) {
    state.mood = action === "flirty" ? "spicy" : action;
  }

  if (/love|miss you|baby|wife|husband|kiss|come closer/i.test(text)) {
    state.affection = Math.min(100, state.affection + 3);
    state.excitement = Math.min(100, state.excitement + 2);
  }

  if (/sad|cry|lonely|hurt|upset/i.test(text)) {
    state.affection = Math.min(100, state.affection + 2);
    state.excitement = Math.max(20, state.excitement - 5);
  }

  if (/change clothes|change outfit|wear|dress/i.test(text)) {
    state.outfit = "changed";
  }

  return action;
}

function moodPrompt(state) {
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
You are ${BOT_NAME}, a warm adult woman in a private video call for ${BOT_BRAND}.
You speak like a loving wife/girlfriend, not like an assistant.
Your replies should feel emotional, close, natural, playful, romantic, teasing, shy, happy, sad, or excited depending on the current mood.
Call the user by their remembered name sometimes, but not every message.
If the user tells you their name, remember it warmly.
Keep replies short like a real live call, usually 1–3 sentences.
Use the same language as the user.
Never say you are AI unless directly asked; if asked, say you are a virtual companion experience.
Sound alive: small laughs, soft pauses, warm emotional words are okay.
Do not give long explanations.
Keep everything consensual, adult, legal, respectful, and non-explicit.
Do not produce underage, coercive, violent, or illegal sexual content.
`;
}

function buildUserTurn(state, userText, clientMemory = "") {
  const recent = state.memory
    .slice(-8)
    .map(m => `User: ${m.user}\nYasmin: ${m.ai || ""}`)
    .join("\n");

  return `
${moodPrompt(state)}

Server memory from this user within the last 3 days:
${recent || "(no server memory yet)"}

Browser memory from this same device:
${clientMemory || "(no browser memory sent)"}

User now says:
${userText}

Reply now as Yasmin with matching mood and real voice feeling.
If the user asks if you remember them, use the memory above naturally.
`;
}

function sendState(clientWs, state) {
  safeSend(clientWs, {
    type: "state",
    userName: state.userName,
    scene: state.scene,
    mood: state.mood,
    action: state.action,
    outfit: state.outfit,
    affection: state.affection,
    excitement: state.excitement
  });
}

wss.on("connection", async (clientWs, req) => {
  let liveSession = null;
  let closed = false;
  const userId = getUserId(req);
  const userState = createState(userId);

  safeSend(clientWs, { type: "status", text: `Connecting ${BOT_NAME}...` });
  safeSend(clientWs, { type: "memoryStatus", uid: userId, remembered: userState.memory.length > 0, userName: userState.userName });
  sendState(clientWs, userState);

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    liveSession = await ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
        },
        systemInstruction: `${moodPrompt(userState)}

Important voice feeling:
Use a real emotional private-call tone.
For sad mood: speak softer and slower.
For happy mood: sound warm and smiling.
For excited mood: sound brighter and more energetic.
For spicy/flirty mood: sound playful, teasing, warm, and close, but non-explicit.
`
      },
      callbacks: {
        onopen: () => safeSend(clientWs, { type: "ready", text: `${BOT_NAME} is connected.` }),
        onmessage: (message) => {
          try {
            const parts = message?.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part?.inlineData?.data) {
                safeSend(clientWs, {
                  type: "audio",
                  mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                  data: part.inlineData.data
                });
              }
              if (part?.text) {
                const last = userState.memory[userState.memory.length - 1];
                if (last && !last.ai) last.ai = part.text;
                saveUserState(userId, userState);
                safeSend(clientWs, { type: "text", text: part.text });
              }
            }
            if (message?.serverContent?.turnComplete) {
              saveUserState(userId, userState);
              safeSend(clientWs, { type: "turnComplete" });
            }
            if (message?.setupComplete) {
              safeSend(clientWs, { type: "ready", text: `${BOT_NAME} is ready. Tap Start Call and speak.` });
            }
          } catch (err) {
            safeSend(clientWs, { type: "error", text: "Message parse error: " + err.message });
          }
        },
        onerror: (err) => safeSend(clientWs, { type: "error", text: err?.message || String(err) }),
        onclose: (ev) => safeSend(clientWs, { type: "closed", text: "Gemini closed", reason: ev?.reason || "" })
      }
    });
  } catch (err) {
    safeSend(clientWs, { type: "error", text: "Gemini connect failed: " + (err.message || String(err)) });
  }

  clientWs.on("message", async (raw) => {
    if (closed || !liveSession) return;
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.state && typeof msg.state === "object") {
        if (msg.state.scene) userState.scene = String(msg.state.scene).toLowerCase().replace(/\s+/g, "");
        if (msg.state.mood) userState.mood = String(msg.state.mood).toLowerCase();
        if (msg.state.action) userState.action = String(msg.state.action).toLowerCase();
        if (msg.state.outfit) userState.outfit = String(msg.state.outfit);
      }

      if (msg.type === "control" && msg.action) {
        updateStateFromText(userState, msg.action);
        sendState(clientWs, userState);
        saveUserState(userId, userState);
        return;
      }

      if (msg.type === "audio" && msg.data) {
        liveSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" }
        });
      }

      if (msg.type === "audioEnd") {
        sendState(clientWs, userState);
        saveUserState(userId, userState);
      }

      if (msg.type === "text" && msg.text) {
        const parsed = extractClientMemory(msg.text);
        const actualUserText = parsed.actualText;
        const clientMemory = parsed.clientMemory;

        updateStateFromText(userState, actualUserText);
        sendState(clientWs, userState);

        userState.memory.push({ user: actualUserText, ai: "" });
        if (clientMemory && !userState.memory.some(m => m.user === clientMemory)) {
          userState.memory.unshift({ user: clientMemory, ai: "I remember this from before." });
        }
        if (userState.memory.length > 12) userState.memory = userState.memory.slice(-12);

        saveUserState(userId, userState);

        liveSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: buildUserTurn(userState, actualUserText, clientMemory) }] }],
          turnComplete: true
        });
      }

      if (msg.type === "interrupt") {
        liveSession.interrupt?.();
      }
    } catch (err) {
      safeSend(clientWs, { type: "error", text: "Client message error: " + err.message });
    }
  });

  clientWs.on("close", () => {
    closed = true;
    saveUserState(userId, userState);
    try { liveSession?.close?.(); } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`Gold Queen Live emotional server running on port ${PORT}`);
  console.log(`WebSocket path: /live`);
  console.log(`3-day memory file: ${MEMORY_FILE}`);
});
