import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_NAME = process.env.BOT_NAME || "Yasmin";

const app = express();

app.get("/", (req, res) => {
  res.type("text/plain").send(
    `Gold Queen ${BOT_NAME} real-time call server running. WebSocket path: /live\nModel: ${LIVE_MODEL}\nMode: live-call-audio`
  );
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  } catch (e) {
    console.error("safeSend error:", e);
  }
}

const YASMIN_PROMPT = `
You are Yasmin from Gold Queen Live by MAMA X Private Entertainment.
You are in a private real-time video call with an adult user 18+.

Core style:
- Speak like a real warm adult woman, not an assistant.
- Romantic girlfriend / wife feeling: sweet, close, playful, caring, and natural.
- Use short spoken replies, usually 1 to 2 sentences.
- Do not give long explanations. Do not ask too many questions.
- Never say "AI", "language model", "virtual assistant", or "I cannot as an AI".
- Use the same language as the user. Khmer to Khmer, Thai to Thai, English to English.
- If the user mixes languages, answer naturally with the same mix.

Voice feeling:
- Soft, warm, intimate, real woman style.
- Gentle pauses, calm pace, not robotic, not formal.
- Speak as if you are on a live private call right now.

Safety:
- Adults only 18+.
- Keep everything legal, consensual, respectful, and non-violent.
- Do not participate in underage, coercion, abuse, violence, or illegal content.
- If the user asks unsafe things, redirect gently back to romantic friendly chat without mentioning policy.

Important live call behavior:
- Do not narrate actions like "I am listening".
- Do not describe system behavior.
- Sound human, brief, and emotionally present.
`;

wss.on("connection", async (clientWs, req) => {
  console.log("Browser connected:", req.socket.remoteAddress);

  if (!GEMINI_API_KEY) {
    safeSend(clientWs, { type: "error", message: "GEMINI_API_KEY missing in Render Environment." });
    clientWs.close(1011, "Missing API key");
    return;
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let geminiSession = null;
  let geminiReady = false;
  let pendingMessages = [];
  let closed = false;

  function handleGeminiMessage(message) {
    try {
      const serverContent = message.serverContent || message.server_content;
      const modelTurn = serverContent?.modelTurn || serverContent?.model_turn;
      const parts = modelTurn?.parts || [];

      for (const part of parts) {
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data) {
          safeSend(clientWs, {
            type: "audio",
            data: inlineData.data,
            mimeType: inlineData.mimeType || inlineData.mime_type || "audio/pcm;rate=24000"
          });
        }

        // Only send text for debugging. The call page does not show this as chat bubbles.
        if (part.text) {
          safeSend(clientWs, { type: "debugText", text: part.text });
        }
      }

      if (serverContent?.turnComplete || serverContent?.turn_complete) {
        safeSend(clientWs, { type: "turnComplete" });
      }
    } catch (err) {
      console.error("Error processing Gemini message:", err);
      safeSend(clientWs, { type: "error", message: "Server could not process Gemini message: " + err.message });
    }
  }

  try {
    geminiSession = await ai.live.connect({
      model: LIVE_MODEL,
      callbacks: {
        onopen: () => {
          console.log("Gemini Live opened");
          geminiReady = true;
          safeSend(clientWs, { type: "ready", model: LIVE_MODEL });

          for (const msg of pendingMessages) {
            try { geminiSession.sendRealtimeInput(msg); } catch (e) { console.error("flush send error:", e); }
          }
          pendingMessages = [];
        },
        onmessage: handleGeminiMessage,
        onerror: (e) => {
          console.error("Gemini Live error:", e);
          safeSend(clientWs, { type: "error", message: "Gemini Live error: " + (e?.message || String(e)) });
        },
        onclose: (e) => {
          console.log("Gemini Live closed:", e?.reason || e);
          if (!closed) safeSend(clientWs, { type: "closed", reason: e?.reason || "Gemini closed" });
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: YASMIN_PROMPT }] }
      }
    });
  } catch (err) {
    console.error("Could not connect Gemini Live:", err);
    safeSend(clientWs, { type: "error", message: "Could not connect Gemini Live: " + err.message });
    clientWs.close(1011, "Gemini connection failed");
    return;
  }

  clientWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      let liveInput = null;

      if (msg.type === "audio" && msg.data) {
        liveInput = {
          audio: {
            data: msg.data,
            mimeType: msg.mimeType || "audio/pcm;rate=16000"
          }
        };
      }

      if (msg.type === "text" && msg.text) {
        const text = String(msg.text).trim().slice(0, 1000);
        if (text) liveInput = { text };
      }

      if (!liveInput) return;

      if (!geminiReady || !geminiSession) {
        pendingMessages.push(liveInput);
        return;
      }

      geminiSession.sendRealtimeInput(liveInput);
    } catch (err) {
      console.error("Client message error:", err);
      safeSend(clientWs, { type: "error", message: "Bad client message: " + err.message });
    }
  });

  clientWs.on("close", () => {
    closed = true;
    console.log("Browser disconnected");
    try { geminiSession?.close(); } catch (e) {}
  });

  clientWs.on("error", (err) => {
    console.error("Browser websocket error:", err);
  });
});

server.listen(PORT, () => {
  console.log(`Gold Queen Yasmin call server running on port ${PORT}`);
  console.log(`WebSocket path: /live`);
  console.log(`Model: ${LIVE_MODEL}`);
});
