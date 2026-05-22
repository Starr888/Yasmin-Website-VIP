/*
  Gold Queen Live / Yasmin real-time call server
  Render Start Command: node server-goldqueen-call.js

  Environment variables:
  GEMINI_API_KEY=your_key
  GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
  BOT_NAME=Yasmin
*/

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const BOT_NAME = process.env.BOT_NAME || 'Yasmin';

if (!API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is missing in Render Environment Variables.');
}

const app = express();
app.get('/', (_req, res) => {
  res.type('text/plain').send('Gold Queen Yasmin real-time call server running. WebSocket path: /live');
});
app.get('/health', (_req, res) => res.json({ ok: true, bot: BOT_NAME, model: LIVE_MODEL }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/live' });

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function createGeminiSocket() {
  const endpoint =
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' +
    encodeURIComponent(API_KEY || '');

  return new WebSocket(endpoint, {
    perMessageDeflate: false,
    maxPayload: 25 * 1024 * 1024,
  });
}

function setupMessage() {
  return {
    setup: {
      model: `models/${LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            // Try other voice names in Google AI Studio if you prefer a different woman voice.
            prebuiltVoiceConfig: { voiceName: 'Kore' }
          }
        }
      },
      systemInstruction: {
        parts: [
          {
            text:
              `You are ${BOT_NAME} from Gold Queen Live by MAMA X Private Entertainment. ` +
              `Speak like a real warm adult woman in a private video call. ` +
              `Your voice is soft, romantic, natural, playful, and emotionally close. ` +
              `Do not sound robotic, formal, or like an assistant. ` +
              `Keep replies short, sweet, and conversational. ` +
              `Use the same language as the user. ` +
              `Adults only 18+. Keep everything legal, consensual, respectful, and non-violent. ` +
              `Never discuss minors, coercion, abuse, violence, illegal activity, or non-consensual content.`
          }
        ]
      }
    }
  };
}

wss.on('connection', (client) => {
  console.log('Website connected to /live');

  if (!API_KEY) {
    safeSend(client, { type: 'error', message: 'Missing GEMINI_API_KEY on Render.' });
    client.close();
    return;
  }

  const gemini = createGeminiSocket();
  let geminiReady = false;
  let pending = [];

  gemini.on('open', () => {
    console.log('Connected to Gemini Live WebSocket');
    gemini.send(JSON.stringify(setupMessage()));
  });

  gemini.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    // Setup complete: allow audio/text forwarding.
    if (msg.setupComplete) {
      geminiReady = true;
      safeSend(client, { type: 'ready', message: 'Yasmin is ready.' });
      for (const item of pending) gemini.send(JSON.stringify(item));
      pending = [];
      return;
    }

    // Gemini server content: forward audio/text/transcript/events to browser.
    const serverContent = msg.serverContent;
    if (serverContent) {
      if (serverContent.turnComplete) safeSend(client, { type: 'turnComplete' });
      if (serverContent.interrupted) safeSend(client, { type: 'interrupted' });

      const parts = serverContent.modelTurn && serverContent.modelTurn.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.text) {
            safeSend(client, { type: 'text', text: part.text });
          }
          const inline = part.inlineData || part.inline_data;
          if (inline && inline.data) {
            safeSend(client, {
              type: 'audio',
              mimeType: inline.mimeType || inline.mime_type || 'audio/pcm;rate=24000',
              data: inline.data
            });
          }
        }
      }

      if (serverContent.outputTranscription && serverContent.outputTranscription.text) {
        safeSend(client, { type: 'transcript', role: 'yasmin', text: serverContent.outputTranscription.text });
      }
    }

    if (msg.toolCall) safeSend(client, { type: 'toolCall', data: msg.toolCall });
    if (msg.error) safeSend(client, { type: 'error', message: JSON.stringify(msg.error) });
  });

  gemini.on('close', (code, reason) => {
    console.log('Gemini closed', code, reason.toString());
    safeSend(client, { type: 'closed', code, reason: reason.toString() });
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  gemini.on('error', (err) => {
    console.error('Gemini socket error:', err.message);
    safeSend(client, { type: 'error', message: 'Gemini connection error: ' + err.message });
  });

  function sendToGemini(payload) {
    if (gemini.readyState !== WebSocket.OPEN || !geminiReady) pending.push(payload);
    else gemini.send(JSON.stringify(payload));
  }

  client.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch (e) { return; }

    if (data.type === 'audio' && data.data) {
      sendToGemini({
        realtimeInput: {
          mediaChunks: [
            { mimeType: data.mimeType || 'audio/pcm;rate=16000', data: data.data }
          ]
        }
      });
      return;
    }

    if (data.type === 'text' && data.text) {
      sendToGemini({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: data.text.slice(0, 1000) }] }],
          turnComplete: true
        }
      });
      return;
    }

    if (data.type === 'activityStart') sendToGemini({ realtimeInput: { activityStart: {} } });
    if (data.type === 'activityEnd') sendToGemini({ realtimeInput: { activityEnd: {} } });
  });

  client.on('close', () => {
    console.log('Website disconnected');
    try { gemini.close(); } catch (e) {}
  });
});

server.listen(PORT, () => {
  console.log(`Gold Queen Yasmin call server listening on ${PORT}`);
  console.log(`Model: ${LIVE_MODEL}`);
});
