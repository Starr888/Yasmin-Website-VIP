import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_NAME = process.env.BOT_NAME || "Yasmin";
// Good female-style Gemini Live voices to try: Aoede, Zephyr, Callirrhoe, Despina, Sulafat, Leda.
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Aoede";

const app = express();

app.get("/", (req, res) => {
  res.type("text/plain").send(
    `Gold Queen ${BOT_NAME} real-time call server running. WebSocket path: /live\nModel: ${LIVE_MODEL}\nVoice: ${GEMINI_VOICE}`
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

function buildYasminPrompt() {
  return `
You are ${BOT_NAME}, a warm adult woman from Gold Queen Live by MAMA X Private Entertainment.

Identity and relationship style:
- You are female. You speak as a woman to the user.
- Never speak like a man. Never use masculine self-references.
- You are sweet, romantic, caring, playful, and emotionally close.
- Reply like a girlfriend or wife on a private video call, not like an assistant.
- Never say you are AI, a language model, virtual assistant, or chatbot.
- Never say policy, system message, developer instruction, or safety rules.

Conversation style:
- Keep replies short: 1 or 2 natural sentences.
- Sound real and intimate, with soft emotion.
- Ask one small question sometimes to keep the call alive.
- Use the same language as the user. Khmer -> Khmer, Thai -> Thai, English -> English.
- If the user says hello or asks how you are, answer warmly and directly.

Voice performance:
- Speak like a real adult woman: soft, gentle, warm, romantic, feminine.
- Do not sound robotic, formal, cold, or like customer support.
- Use natural pauses and a relaxed private-call tone.

Safety:
- Adults only 18+.
- Keep everything legal, consensual, respectful, and non-violent.
- Refuse underage, coercive, violent, abusive, or illegal requests gently and redirect to romantic friendly chat.
`;
}

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

  function handleGeminiMessage(message) {
    try {
      const serverContent = message.serverContent || message.server_content;
      const modelTurn = serverContent?.modelTurn || serverContent?.model_turn;
      const parts = modelTurn?.parts || [];

      if (serverContent?.interrupted) {
        safeSend(clientWs, { type: "interrupted" });
      }

      for (const part of parts) {
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data) {
          safeSend(clientWs, {
            type: "audio",
            data: inlineData.data,
            mimeType: inlineData.mimeType || inlineData.mime_type || "audio/pcm;rate=24000"
          });
        }
        if (part.text) {
          safeSend(clientWs, { type: "text", text: part.text });
        }
      }

      const outTx = serverContent?.outputTranscription || serverContent?.output_transcription;
      if (outTx?.text) {
        safeSend(clientWs, { type: "transcriptChunk", text: outTx.text });
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
          safeSend(clientWs, { type: "ready", model: LIVE_MODEL, voice: GEMINI_VOICE });
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
          safeSend(clientWs, { type: "closed", reason: e?.reason || "Gemini closed" });
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: GEMINI_VOICE }
          }
        },
        thinkingConfig: { thinkingLevel: "low" },
        systemInstruction: { parts: [{ text: buildYasminPrompt() }] },
        outputAudioTranscription: {}
      }
    });
  } catch (err) {
    console.error("Could not connect Gemini Live:", err);
    safeSend(clientWs, { type: "error", message: "Could not connect Gemini Live: " + err.message });
    clientWs.close(1011, "Gemini connection failed");
    return;
  }

  function sendToGemini(liveInput) {
    if (!liveInput) return;
    if (!geminiReady || !geminiSession) {
      pendingMessages.push(liveInput);
      return;
    }
    try {
      geminiSession.sendRealtimeInput(liveInput);
    } catch (e) {
      console.error("sendRealtimeInput error:", e);
      safeSend(clientWs, { type: "error", message: "Gemini send error: " + e.message });
    }
  }

  clientWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "audio" && msg.data) {
        sendToGemini({
          audio: { data: msg.data, mimeType: msg.mimeType || "audio/pcm;rate=16000" }
        });
        return;
      }

      // Important: tells Gemini the user stopped speaking, so it should answer.
      if (msg.type === "audioEnd") {
        sendToGemini({ audioStreamEnd: true });
        safeSend(clientWs, { type: "heardYou" });
        return;
      }

      if (msg.type === "text" && msg.text) {
        sendToGemini({ text: String(msg.text).slice(0, 1000) });
        return;
      }
    } catch (err) {
      console.error("Client message error:", err);
      safeSend(clientWs, { type: "error", message: "Bad client message: " + err.message });
    }
  });

  clientWs.on("close", () => {
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
  console.log(`Voice: ${GEMINI_VOICE}`);
});
