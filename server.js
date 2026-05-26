import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_NAME = process.env.BOT_NAME || "Yasmin";
const BOT_BRAND = process.env.BOT_BRAND || "Gold Queen Live";

if (!GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is missing. Add it in Render Environment.");
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.type("text/plain").send("GOLD QUEEN LIVE - Gemini realtime emotional call server OK");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, model: GEMINI_LIVE_MODEL, bot: BOT_NAME });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function createState() {
  return {
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

function updateStateFromText(state, text = "") {
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
Keep replies short like a real live call, usually 1–3 sentences.
Use the same language as the user.
Never say you are AI unless directly asked; if asked, say you are a virtual companion experience.
Sound alive: small laughs, soft pauses, warm emotional words are okay.
Do not give long explanations.
Keep everything consensual, adult, legal, respectful, and non-explicit.
Do not produce underage, coercive, violent, or illegal sexual content.
`;
}

function buildUserTurn(state, userText) {
  const recent = state.memory
    .slice(-6)
    .map(m => `User: ${m.user}\nYasmin: ${m.ai || ""}`)
    .join("\n");

  return `
${moodPrompt(state)}

Recent memory:
${recent || "(no previous memory yet)"}

User says: ${userText}

Reply now as Yasmin with matching mood and real voice feeling.
`;
}

wss.on("connection", async (clientWs) => {
  let liveSession = null;
  let closed = false;
  const userState = createState();

  safeSend(clientWs, { type: "status", text: "Connecting Yasmin..." });
  safeSend(clientWs, {
    type: "state",
    scene: userState.scene,
    mood: userState.mood,
    action: userState.action,
    outfit: userState.outfit
  });

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
        onopen: () => safeSend(clientWs, { type: "ready", text: "Yasmin is connected." }),
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
                safeSend(clientWs, { type: "text", text: part.text });
              }
            }
            if (message?.serverContent?.turnComplete) {
              safeSend(clientWs, { type: "turnComplete" });
            }
            if (message?.setupComplete) {
              safeSend(clientWs, { type: "ready", text: "Yasmin is ready. Tap Start Call and speak." });
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
        safeSend(clientWs, {
          type: "state",
          scene: userState.scene,
          mood: userState.mood,
          action: userState.action,
          outfit: userState.outfit
        });
        return;
      }

      if (msg.type === "audio" && msg.data) {
        liveSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" }
        });
      }

      if (msg.type === "audioEnd") {
        safeSend(clientWs, {
          type: "state",
          scene: userState.scene,
          mood: userState.mood,
          action: userState.action || "talk",
          outfit: userState.outfit
        });
      }

      if (msg.type === "text" && msg.text) {
        const userText = msg.text.trim();
        updateStateFromText(userState, userText);

        safeSend(clientWs, {
          type: "state",
          scene: userState.scene,
          mood: userState.mood,
          action: userState.action,
          outfit: userState.outfit
        });

        userState.memory.push({ user: userText, ai: "" });
        if (userState.memory.length > 12) userState.memory.shift();

        liveSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: buildUserTurn(userState, userText) }] }],
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
    try { liveSession?.close?.(); } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`Gold Queen Live emotional server running on port ${PORT}`);
  console.log(`WebSocket path: /live`);
});
