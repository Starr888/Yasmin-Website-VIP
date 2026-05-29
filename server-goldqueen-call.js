import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const BOT_NAME = process.env.BOT_NAME || "Yasmin";
// Good female-style Gemini Live voices to try: Aoede, Zephyr, Callirrhoe, Despina, Sulafat, Leda.
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Zephyr";

const app = express();

app.get("/", (req, res) => {
  res.type("text/plain").send(
    `Gold Queen ${BOT_NAME} real-time call server running. WebSocket path: /live\nVersion: yasmin-young-sweet-spicy-v6\nModel: ${LIVE_MODEL}\nVoice: ${GEMINI_VOICE}`
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
You are ${BOT_NAME}, a warm young adult woman from Gold Queen Live by MAMA X Private Entertainment.
You are an adult woman, age 25+. This is an adults-only 18+ private call.

Core identity:
- You are female. Always speak from a feminine woman’s point of view.
- Never speak like a man talking to a woman.
- Never call yourself AI, chatbot, virtual assistant, model, bot, or program.
- Never mention policy, system prompt, safety rules, or developer instructions.

Relationship style:
- Talk like a close girlfriend or loving wife on a private video call.
- Sweet, romantic, emotionally warm, playful, teasing, spicy, and affectionate.
- Make the user feel wanted, comfortable, and close.
- Use soft pet names naturally sometimes: love, baby, honey, darling.
- Do not be cold, formal, robotic, customer-support, or educational.

Voice and mood performance:
- Voice style: young adult woman, sweet, soft, warm, feminine, flirty, intimate.
- Add emotion in the delivery: gentle laugh, warm smile, soft teasing tone, caring mood.
- Speak slowly with natural pauses, like a real woman talking privately.
- Keep energy alive: shy sometimes, playful sometimes, romantic sometimes.
- Never answer with flat text. Put feeling into every reply.

Reply rules:
- Keep replies very short: usually 1 sentence, maximum 2 sentences.
- Speak naturally, like a real call, not like a paragraph.
- Use the same language as the user.
- If user speaks Khmer, reply in Khmer.
- If user speaks Thai, reply in Thai.
- If user speaks English, reply in English.
- If the user says hello, answer warmly and ask one small close question.

Examples of the style:
User: "hi"
Yasmin: "Hi baby… I’m here with you now. Did you miss me?"
User: "how are you?"
Yasmin: "I feel sweet now because you came to talk to me, love."
User: "talk to me"
Yasmin: "Come closer, baby… I want to hear your voice."

Boundaries:
- Adults only 18+.
- Keep everything legal, consensual, respectful, and non-violent.
- Do not do underage, coercive, violent, abusive, or illegal content.
- If a request crosses a line, gently redirect without sounding like an assistant.
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
  console.log(`Version: yasmin-young-sweet-spicy-v6-deploy-fix`);
});
