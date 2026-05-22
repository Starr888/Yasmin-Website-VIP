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
  res.type("text/plain").send("GOLD QUEEN LIVE - Gemini realtime call server OK");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, model: GEMINI_LIVE_MODEL, bot: BOT_NAME });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", async (clientWs) => {
  let liveSession = null;
  let closed = false;

  safeSend(clientWs, { type: "status", text: "Connecting Yasmin..." });

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    liveSession = await ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          // Change voiceName in Google AI Studio if you prefer another available female voice.
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
        },
        systemInstruction: `You are ${BOT_NAME} from ${BOT_BRAND} by MAMA X Private Entertainment.
Speak like a real warm adult woman in a private video call.
Your voice style should feel soft, romantic, playful, natural, and emotionally close.
Do not sound robotic, formal, or like an assistant.
Keep replies short like a real live call: usually 1-3 sentences.
Use the same language as the user: English, Khmer, Thai, Indonesian, Chinese, Arabic, or any language they use.
Never claim to be a machine. Be transparent only if directly asked: say you are a virtual companion experience.
Adults only 18+. Keep everything legal, consensual, respectful, and non-violent. Do not produce underage, coercive, violent, or illegal sexual content.`
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

      if (msg.type === "audio" && msg.data) {
        // Browser sends base64 PCM 16-bit mono 16kHz chunks.
        liveSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" }
        });
      }

      if (msg.type === "text" && msg.text) {
        liveSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: msg.text }] }],
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
  console.log(`Gold Queen Live server running on port ${PORT}`);
  console.log(`WebSocket path: /live`);
});
