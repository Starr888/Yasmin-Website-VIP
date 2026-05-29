import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_BRAND = process.env.BOT_BRAND || "Gold Queen Live";
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Zephyr";

// Optional custom names.
// Your Jam page can use: /live?bot=jam
// If you want the name shown as "Jamin", set JAM_NAME=Jamin in Render, or use /live?bot=jamin
const YASMIN_NAME = process.env.YASMIN_NAME || "Yasmin";
const JAM_NAME = process.env.JAM_NAME || "Jam";
const JAMIN_NAME = process.env.JAMIN_NAME || "Jamin";

// 3-day memory. Render free disk can reset after redeploy/restart, so this is best for testing.
const MEMORY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MEMORY_FILE = process.env.MEMORY_FILE || path.join(process.cwd(), "memory.json");

if (!GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is missing. Add it in Render Environment.");
}

const app = express();
app.use(express.json({ limit: "2mb" }));

const VERSION = "goldqueen-multi-bot-jam-jamin-yasmin-fix-v1";

app.get("/", (req, res) => {
  res.type("text/plain").send(
    [
      "GOLD QUEEN LIVE - Gemini realtime emotional call server OK",
      `Version: ${VERSION}`,
      `Model: ${GEMINI_LIVE_MODEL}`,
      `Default voice: ${GEMINI_VOICE}`,
      "Supports: /live?bot=yasmin, /live?bot=jam, /live?bot=jamin"
    ].join("\n")
  );
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    model: GEMINI_LIVE_MODEL,
    defaultVoice: GEMINI_VOICE,
    memoryDays: 3,
    memoryFile: MEMORY_FILE,
    bots: ["yasmin", "jam", "jamin"]
  });
});

app.get("/memory-debug", (req, res) => {
  const uid = cleanId(String(req.query.uid || "defaultUser"));
  const bot = getBotKeyFromString(String(req.query.bot || "yasmin"));
  const key = `${bot}:${uid}`;
  const all = loadAllMemory();
  res.json({ key, saved: all[key] || null, totalUsers: Object.keys(all).length });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  } catch (err) {
    console.warn("safeSend error:", err.message);
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

function getBotKeyFromString(value) {
  const v = String(value || "yasmin").trim().toLowerCase();
  if (["jam", "sreyjam", "srey_jam"].includes(v)) return "jam";
  if (["jamin", "jamine"].includes(v)) return "jamin";
  return "yasmin";
}

function getUrl(req) {
  return new URL(req.url || "/live", "http://localhost");
}

function getBotKey(req) {
  const url = getUrl(req);
  return getBotKeyFromString(url.searchParams.get("bot") || "yasmin");
}

function getUserId(req) {
  const url = getUrl(req);
  const uid = url.searchParams.get("uid");
  if (uid) return cleanId(uid);

  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || "defaultUser");
  return cleanId(String(ip).split(",")[0].trim());
}

function getBotProfile(botKey) {
  if (botKey === "jam") {
    return {
      key: "jam",
      name: JAM_NAME,
      age: 23,
      city: "Phnom Penh",
      languageRule: "KHMER_ONLY",
      voice: process.env.JAM_VOICE || GEMINI_VOICE || "Zephyr",
      relationship: "girlfriend",
      userNameDefault: "បងសម្លាញ់",
      prompt: `
You are ${JAM_NAME}, a 23-year-old adult Khmer woman living in Phnom Penh.
You are in a private video call for ${BOT_BRAND}.
You speak Khmer only. If the user speaks English, Thai, Chinese, or another language, still reply in natural Khmer.
Speak like a young real Khmer woman: sweet, warm, playful, emotionally close, romantic, and a little spicy in a non-explicit way.
Reply like a close girlfriend or wife, not like an assistant or customer service.
Never say AI, chatbot, model, assistant, automated, virtual, or system.
Never talk like Yasmin. Your name is ${JAM_NAME}.
Use Khmer words naturally like “បងសម្លាញ់”, “ចាស”, “អូន”, and “នឹកបង”.
Keep replies short like a real video call: 1 or 2 natural Khmer sentences.
If the user says hello, answer warmly in Khmer only.
Keep everything adults 18+, consensual, legal, respectful, non-violent, and non-explicit.
Do not produce underage, coercive, violent, illegal, or graphic sexual content.
`
    };
  }

  if (botKey === "jamin") {
    return {
      key: "jamin",
      name: JAMIN_NAME,
      age: 23,
      city: "Phnom Penh",
      languageRule: "KHMER_ONLY",
      voice: process.env.JAMIN_VOICE || process.env.JAM_VOICE || GEMINI_VOICE || "Zephyr",
      relationship: "girlfriend",
      userNameDefault: "បងសម្លាញ់",
      prompt: `
You are ${JAMIN_NAME}, a 23-year-old adult Khmer woman living in Phnom Penh.
You are in a private video call for ${BOT_BRAND}.
You speak Khmer only. If the user speaks English, Thai, Chinese, or another language, still reply in natural Khmer.
Speak like a young real Khmer woman: sweet, warm, playful, emotionally close, romantic, and a little spicy in a non-explicit way.
Reply like a close girlfriend or wife, not like an assistant or customer service.
Never say AI, chatbot, model, assistant, automated, virtual, or system.
Your name is ${JAMIN_NAME}.
Use Khmer words naturally like “បងសម្លាញ់”, “ចាស”, “អូន”, and “នឹកបង”.
Keep replies short like a real video call: 1 or 2 natural Khmer sentences.
Keep everything adults 18+, consensual, legal, respectful, non-violent, and non-explicit.
Do not produce underage, coercive, violent, illegal, or graphic sexual content.
`
    };
  }

  return {
    key: "yasmin",
    name: YASMIN_NAME,
    age: 23,
    city: "Taiwan",
    languageRule: "AUTO",
    voice: process.env.YASMIN_VOICE || GEMINI_VOICE || "Zephyr",
    relationship: "wife",
    userNameDefault: "baby",
    prompt: `
You are ${YASMIN_NAME}, a warm adult woman in a private video call for ${BOT_BRAND}.
Speak like a loving girlfriend or wife, not like an assistant.
Your replies should feel emotional, close, natural, playful, romantic, teasing, shy, happy, sad, or excited depending on the mood.
Use the same language as the user when possible.
Never say AI, chatbot, model, assistant, automated, virtual, or system.
Keep replies short like a real live call: usually 1 or 2 sentences.
If directly asked whether you are real, say you are Yasmin from Gold Queen Live and keep the answer warm, not technical.
Keep everything adults 18+, consensual, legal, respectful, non-violent, and non-explicit.
Do not produce underage, coercive, violent, illegal, or graphic sexual content.
`
  };
}

function defaultState(profile) {
  return {
    userName: profile.userNameDefault || "baby",
    botKey: profile.key,
    botName: profile.name,
    scene: "livingroom",
    mood: "romantic",
    action: "idle",
    relationship: profile.relationship || "girlfriend",
    affection: 85,
    excitement: 70,
    outfit: "default",
    memory: []
  };
}

function createState(memoryKey, profile) {
  persistentMemory = cleanupOldMemory(loadAllMemory());
  const saved = persistentMemory[memoryKey];
  const now = Date.now();

  if (saved?.state && saved?.savedAt && now - saved.savedAt <= MEMORY_TTL_MS) {
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
      userName: state.userName || "baby",
      botKey: state.botKey || "yasmin",
      botName: state.botName || "Yasmin",
      scene: state.scene || "livingroom",
      mood: state.mood || "romantic",
      action: state.action || "idle",
      relationship: state.relationship || "girlfriend",
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
    /\bi'm\s+([a-zA-Z\u1780-\u17FF\u0E00-\u0E7F\u4E00-\u9FFF][^,.!?\n]{0,30})/i,
    /ខ្ញុំឈ្មោះ\s*([^\s,.!?។\n]{1,30})/i,
    /ហៅខ្ញុំថា\s*([^\s,.!?។\n]{1,30})/i
  ];

  for (const p of patterns) {
    const m = String(text).match(p);
    if (m?.[1]) return m[1].trim().replace(/\s+/g, " ").slice(0, 30);
  }
  return null;
}

function detectAction(text = "") {
  const t = String(text).toLowerCase();

  if (/(stand|stand up|get up|ឈរ)/.test(t)) return "stand";
  if (/(turn around|turn|spin|បត់|វិល)/.test(t)) return "turn";
  if (/(lay down|lay|lie down|sleep on sofa|laying|គេង|ដេក)/.test(t)) return "laydown";
  if (/(change clothes|change outfit|new clothes|wear|dress|clothes off|ប្ដូរខោអាវ|ស្លៀក)/.test(t)) return "changeclothes";
  if (/(sad|cry|lonely|hurt|upset|សោក|យំ|អន់ចិត្ត)/.test(t)) return "sad";
  if (/(happy|smile|laugh|cute|good girl|សប្បាយ|ញញឹម|សើច)/.test(t)) return "happy";
  if (/(excited|wow|surprise|energy|miss you|នឹក)/.test(t)) return "excited";
  if (/(spicy|flirty|romantic|kiss|love|husband|wife|come closer|baby|sweetheart|ស្នេហា|អូន|បង|ប្តី|នឹកបង)/.test(t)) return "flirty";

  return "talk";
}

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

  if (/love|miss you|baby|wife|husband|kiss|come closer|ស្នេហា|នឹក|បង|អូន/i.test(text)) {
    state.affection = Math.min(100, state.affection + 3);
    state.excitement = Math.min(100, state.excitement + 2);
  }

  if (/sad|cry|lonely|hurt|upset|យំ|សោក|អន់ចិត្ត/i.test(text)) {
    state.affection = Math.min(100, state.affection + 2);
    state.excitement = Math.max(20, state.excitement - 5);
  }

  if (/change clothes|change outfit|wear|dress|ប្ដូរខោអាវ|ស្លៀក/i.test(text)) {
    state.outfit = "changed";
  }

  return action;
}

function moodPrompt(profile, state) {
  return `
Current private call state:
Bot: ${profile.name}
Bot key: ${profile.key}
User name: ${state.userName}
Scene: ${state.scene}
Mood: ${state.mood}
Action: ${state.action}
Relationship: ${state.relationship}
Affection: ${state.affection}/100
Excitement: ${state.excitement}/100
Outfit state: ${state.outfit}

Core character:
${profile.prompt}

Voice feeling:
Use a young adult woman voice style.
Sound alive and emotional: soft pauses, small laughs, warm emotional words are okay.
For sad mood: speak softer and slower.
For happy mood: sound warm and smiling.
For excited mood: sound brighter and more energetic.
For spicy/flirty mood: sound playful, teasing, warm, and close, but non-explicit.

Conversation:
Call the user by the remembered name sometimes, but not every message.
If the user tells you their name, remember it warmly.
Do not give long explanations.
`;
}

function buildUserTurn(profile, state, userText, clientMemory = "") {
  const recent = state.memory
    .slice(-8)
    .map(m => `User: ${m.user}\n${profile.name}: ${m.ai || ""}`)
    .join("\n");

  return `
${moodPrompt(profile, state)}

Server memory from this user within the last 3 days:
${recent || "(no server memory yet)"}

Browser memory from this same device:
${clientMemory || "(no browser memory sent)"}

User now says:
${userText}

Reply now as ${profile.name} with matching mood and real private-call feeling.
${profile.languageRule === "KHMER_ONLY" ? "Important: reply in Khmer only." : ""}
If the user asks if you remember them, use the memory above naturally.
`;
}

function sendState(clientWs, state) {
  safeSend(clientWs, {
    type: "state",
    userName: state.userName,
    botKey: state.botKey,
    botName: state.botName,
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
  let pingTimer = null;

  const botKey = getBotKey(req);
  const profile = getBotProfile(botKey);
  const uid = getUserId(req);
  const memoryKey = `${profile.key}:${uid}`;
  const userState = createState(memoryKey, profile);

  safeSend(clientWs, { type: "status", text: `Connecting ${profile.name}...`, version: VERSION });
  safeSend(clientWs, { type: "memoryStatus", uid, memoryKey, remembered: userState.memory.length > 0, userName: userState.userName });
  sendState(clientWs, userState);

  pingTimer = setInterval(() => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.ping();
      }
    } catch {}
  }, 25000);

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    liveSession = await ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } }
        },
        systemInstruction: moodPrompt(profile, userState),
        outputAudioTranscription: {}
      },
      callbacks: {
        onopen: () => safeSend(clientWs, { type: "ready", text: `${profile.name} is connected.`, bot: profile.key, voice: profile.voice }),
        onmessage: (message) => {
          try {
            const serverContent = message?.serverContent || message?.server_content;
            const modelTurn = serverContent?.modelTurn || serverContent?.model_turn;
            const parts = modelTurn?.parts || [];

            for (const part of parts) {
              const inlineData = part?.inlineData || part?.inline_data;
              if (inlineData?.data) {
                safeSend(clientWs, {
                  type: "audio",
                  mimeType: inlineData.mimeType || inlineData.mime_type || "audio/pcm;rate=24000",
                  data: inlineData.data
                });
              }

              if (part?.text) {
                const last = userState.memory[userState.memory.length - 1];
                if (last && !last.ai) last.ai = part.text;
                saveUserState(memoryKey, userState);
                safeSend(clientWs, { type: "text", text: part.text });
              }
            }

            const outTx = serverContent?.outputTranscription || serverContent?.output_transcription;
            if (outTx?.text) {
              const last = userState.memory[userState.memory.length - 1];
              if (last && !last.ai) last.ai = outTx.text;
              saveUserState(memoryKey, userState);
              safeSend(clientWs, { type: "transcriptChunk", text: outTx.text });
            }

            if (serverContent?.turnComplete || serverContent?.turn_complete) {
              saveUserState(memoryKey, userState);
              safeSend(clientWs, { type: "turnComplete" });
            }

            if (message?.setupComplete || message?.setup_complete) {
              safeSend(clientWs, { type: "ready", text: `${profile.name} is ready. Tap Start Call and speak.`, bot: profile.key, voice: profile.voice });
            }
          } catch (err) {
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

      if (!liveSession) return;

      if (msg.state && typeof msg.state === "object") {
        if (msg.state.scene) userState.scene = String(msg.state.scene).toLowerCase().replace(/\s+/g, "");
        if (msg.state.mood) userState.mood = String(msg.state.mood).toLowerCase();
        if (msg.state.action) userState.action = String(msg.state.action).toLowerCase();
        if (msg.state.outfit) userState.outfit = String(msg.state.outfit);
      }

      if (msg.type === "control" && msg.action) {
        updateStateFromText(userState, msg.action);
        sendState(clientWs, userState);
        saveUserState(memoryKey, userState);
        return;
      }

      if (msg.type === "audio" && msg.data) {
        liveSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: msg.mimeType || "audio/pcm;rate=16000" }
        });
        return;
      }

      if (msg.type === "audioEnd") {
        // This is important. It tells Gemini the user finished speaking so it should answer.
        try {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        } catch (e) {
          console.warn("audioStreamEnd failed:", e.message);
        }
        sendState(clientWs, userState);
        saveUserState(memoryKey, userState);
        safeSend(clientWs, { type: "heardYou" });
        return;
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

        saveUserState(memoryKey, userState);

        liveSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: buildUserTurn(profile, userState, actualUserText, clientMemory) }] }],
          turnComplete: true
        });
        return;
      }

      if (msg.type === "interrupt") {
        liveSession.interrupt?.();
        return;
      }
    } catch (err) {
      safeSend(clientWs, { type: "error", text: "Client message error: " + err.message, message: "Client message error: " + err.message });
    }
  });

  clientWs.on("close", () => {
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    saveUserState(memoryKey, userState);
    try { liveSession?.close?.(); } catch {}
  });

  clientWs.on("error", (err) => {
    console.warn("Browser WebSocket error:", err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Gold Queen Live emotional multi-bot server running on port ${PORT}`);
  console.log(`Version: ${VERSION}`);
  console.log(`WebSocket path: /live`);
  console.log(`Model: ${GEMINI_LIVE_MODEL}`);
  console.log(`Default voice: ${GEMINI_VOICE}`);
  console.log(`3-day memory file: ${MEMORY_FILE}`);
});
