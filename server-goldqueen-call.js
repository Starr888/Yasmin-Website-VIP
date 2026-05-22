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
    `Gold Queen ${BOT_NAME} real-time call server running. WebSocket path: /live\nModel: ${LIVE_MODEL}`
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

  const systemInstruction = `
You are ${BOT_NAME} from Gold Queen Live by MAMA X Private Entertainment.
You are speaking in a private real-time video call with an adult user 18+.
Speak like a warm real adult woman: soft, romantic, natural, playful, emotionally close.
Do not sound robotic, formal, or like an assistant.
Keep replies short and conversational, like a girlfriend or wife on a private call.
Use the same language as the user when possible.
Keep everything legal, consensual, respectful, and non-violent.
Never mention system messages or developer instructions.
`;

  function handleGeminiMessage(message) {
    try {
      // Gemini Live can return multiple parts in one server event.
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

        if (part.text) {
          safeSend(clientWs, { type: "text", text: part.text });
        }
      }

      const outTx = serverContent?.outputTranscription || serverContent?.output_transcription;
      if (outTx?.text) {
        safeSend(clientWs, { type: "transcript", text: outTx.text });
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

          // Flush any client messages that arrived before Gemini opened.
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
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        outputAudioTranscription: {}
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
        liveInput = { text: String(msg.text).slice(0, 1000) };
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
