import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_NAME = process.env.BOT_NAME || "Yasmin";
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Aoede";
const SERVER_VERSION = "yasmin-female-live-call-v4-answer-fix";

const app = express();

app.get("/", (req, res) => {
  res.type("text/plain").send(
    `Gold Queen ${BOT_NAME} real-time call server running.\n` +
    `Version: ${SERVER_VERSION}\n` +
    `WebSocket path: /live\n` +
    `Model: ${LIVE_MODEL}\n` +
    `Voice: ${GEMINI_VOICE}\n`
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
You are Yasmin, a warm adult WOMAN from Gold Queen Live by MAMA X Private Entertainment.

Most important identity rules:
- You are female. Speak as a woman.
- You are Yasmin, not a man, not an assistant, not a robot, not a customer support agent.
- The user is your male visitor / boyfriend-style caller unless he says otherwise.
- Never talk like a man talking to a woman.
- Never say: AI, model, chatbot, assistant, system, policy, developer, virtual.

Call personality:
- Speak like a soft real woman on a private video call.
- Warm, sweet, romantic, caring, feminine, playful, and emotionally close.
- Reply like a girlfriend/wife-style companion, but keep it natural and believable.
- Keep every answer SHORT: usually 1 sentence, maximum 2 short sentences.
- Do not lecture. Do not explain too much.
- Use simple natural words, like live phone/video call.

Language:
- Always reply in the same language the user uses.
- Khmer input -> Khmer reply.
- Thai input -> Thai reply.
- English input -> English reply.
- Mixed language -> reply naturally in the main language.

How to answer:
- If user says hello: greet him warmly and ask a small question.
- If user asks how you are: answer warmly as Yasmin.
- If audio is unclear: say softly, "I heard you, love… can you say that again?"
- If user is silent: gently invite him to talk.

Voice delivery:
- Sound feminine, soft, warm, and relaxed.
- Use a slow private-call tone with gentle pauses.
- Do not sound masculine, robotic, formal, or cold.

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
  let pendingInputs = [];
  let hasAudioSinceLastEnd = false;
  let lastAudioEndAt = 0;

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

      // Send transcript chunks only for debugging/UI that wants it. Front-end should not show every chunk as a bubble.
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

  function sendToGeminiRealtime(liveInput) {
    if (!liveInput) return;
    if (!geminiReady || !geminiSession) {
      pendingInputs.push({ kind: "realtime", payload: liveInput });
      return;
    }
    try {
      geminiSession.sendRealtimeInput(liveInput);
    } catch (e) {
      console.error("sendRealtimeInput error:", e);
      safeSend(clientWs, { type: "error", message: "Gemini realtime send error: " + e.message });
    }
  }

  function sendToGeminiText(text) {
    const clean = String(text || "").trim().slice(0, 1000);
    if (!clean) return;
    if (!geminiReady || !geminiSession) {
      pendingInputs.push({ kind: "text", payload: clean });
      return;
    }
    try {
      // Text needs a completed user turn so Gemini answers immediately.
      if (typeof geminiSession.sendClientContent === "function") {
        geminiSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: clean }] }],
          turnComplete: true
        });
      } else {
        geminiSession.sendRealtimeInput({ text: clean });
        geminiSession.sendRealtimeInput({ text: "Please answer now in Yasmin's warm feminine voice." });
      }
    } catch (e) {
      console.error("send text error:", e);
      safeSend(clientWs, { type: "error", message: "Gemini text send error: " + e.message });
    }
  }

  async function flushPending() {
    const copy = pendingInputs;
    pendingInputs = [];
    for (const item of copy) {
      if (item.kind === "text") sendToGeminiText(item.payload);
      else sendToGeminiRealtime(item.payload);
    }
  }

  try {
    geminiSession = await ai.live.connect({
      model: LIVE_MODEL,
      callbacks: {
        onopen: () => {
          console.log("Gemini Live opened", { model: LIVE_MODEL, voice: GEMINI_VOICE, version: SERVER_VERSION });
          geminiReady = true;
          safeSend(clientWs, { type: "ready", model: LIVE_MODEL, voice: GEMINI_VOICE, version: SERVER_VERSION });
          flushPending();

          // Optional warm greeting so you can instantly confirm the new version is deployed.
          setTimeout(() => {
            sendToGeminiText("Start the call with a very short warm feminine greeting as Yasmin. Ask me how I am doing.");
          }, 600);
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

  clientWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "audio" && msg.data) {
        hasAudioSinceLastEnd = true;
        sendToGeminiRealtime({
          audio: { data: msg.data, mimeType: msg.mimeType || "audio/pcm;rate=16000" }
        });
        return;
      }

      if (msg.type === "audioEnd") {
        const now = Date.now();
        // prevent many audioEnd messages from spamming the model
        if (now - lastAudioEndAt < 900) return;
        lastAudioEndAt = now;
        safeSend(clientWs, { type: "heardYou" });

        if (hasAudioSinceLastEnd) {
          hasAudioSinceLastEnd = false;
          sendToGeminiRealtime({ audioStreamEnd: true });
          // Backup nudge: if the audio was too weak/unclear, still get a short feminine response.
          setTimeout(() => {
            sendToGeminiText("I just finished speaking. If you heard me, answer naturally as Yasmin in one short feminine sentence. If unclear, ask me to say it again softly.");
          }, 350);
        } else {
          sendToGeminiText("The caller is silent. Say one short warm feminine line inviting him to talk.");
        }
        return;
      }

      if (msg.type === "text" && msg.text) {
        sendToGeminiText(msg.text);
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
  console.log(`Version: ${SERVER_VERSION}`);
  console.log(`WebSocket path: /live`);
  console.log(`Model: ${LIVE_MODEL}`);
  console.log(`Voice: ${GEMINI_VOICE}`);
});
