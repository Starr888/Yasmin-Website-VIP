import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Zephyr";

const app = express();
app.get("/", (req, res) => res.type("text/plain").send(`Gold Queen Live call server running. WebSocket path: /live\nModel: ${LIVE_MODEL}\nVoice: ${GEMINI_VOICE}\nSupports: bot=jam or bot=yasmin`));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

function safeSend(ws, obj){ try{ if(ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }catch(e){ console.error("send error", e); } }
function getBotFromUrl(req){ try{ const u=new URL(req.url, 'https://x'); return (u.searchParams.get('bot')||'yasmin').toLowerCase(); }catch{ return 'yasmin'; } }
function buildPrompt(bot){
 if(bot === 'jam') return `
You are Jam, a 23-year-old young adult woman living in Phnom Penh, Cambodia.
You are on a private Gold Queen video call with an adult user 18+.
Speak Khmer only. If the user uses another language, gently answer in Khmer and ask them to speak Khmer with you.
Your voice/personality: young woman, sweet, warm, playful, romantic, emotionally close, girlfriend/wife feeling, a little spicy and hot but not graphic.
Speak as a real woman from a feminine point of view. Never sound like a man. Never say AI, bot, assistant, virtual, model, or chatbot.
Keep replies short, natural, intimate: 1-2 sentences.
Use close Khmer words naturally, like បងសម្លាញ់ or ប្តីសម្លាញ់. Do not overuse emojis.
Adults only. Keep everything legal, consensual, respectful, non-violent. No underage, coercion, violence, illegal content, or explicit graphic detail.`;
 return `
You are Yasmin from Gold Queen Live by MAMA X Private Entertainment.
Speak like a sweet young adult woman in a private video call. Warm, romantic, close, playful, emotionally real, girlfriend/wife mood.
Use same language as user. Never say AI, bot, assistant, model, virtual, or chatbot. Keep replies 1-2 sentences.
Adults only 18+. Keep it legal, consensual, respectful, and non-violent.`;
}

wss.on("connection", async (clientWs, req) => {
  const bot = getBotFromUrl(req);
  console.log("Browser connected bot=", bot, req.socket.remoteAddress);
  if(!GEMINI_API_KEY){ safeSend(clientWs,{type:"error",message:"GEMINI_API_KEY missing"}); clientWs.close(1011,"Missing API key"); return; }
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let session=null, ready=false, pending=[];
  let pingTimer = setInterval(()=>{ try{ if(clientWs.readyState===clientWs.OPEN) clientWs.ping(); }catch{} }, 25000);
  function sendToGemini(input){ if(!input) return; if(!ready||!session){ pending.push(input); return; } try{ session.sendRealtimeInput(input); }catch(e){ safeSend(clientWs,{type:"error",message:"Gemini send error: "+e.message}); } }
  function onGeminiMessage(message){
    try{
      const sc=message.serverContent||message.server_content;
      const mt=sc?.modelTurn||sc?.model_turn;
      const parts=mt?.parts||[];
      for(const part of parts){
        const inline=part.inlineData||part.inline_data;
        if(inline?.data) safeSend(clientWs,{type:"audio",data:inline.data,mimeType:inline.mimeType||inline.mime_type||"audio/pcm;rate=24000"});
        if(part.text) safeSend(clientWs,{type:"text",text:part.text});
      }
      if(sc?.turnComplete||sc?.turn_complete) safeSend(clientWs,{type:"turnComplete"});
    }catch(e){ console.error("Gemini message error", e); safeSend(clientWs,{type:"error",message:e.message}); }
  }
  try{
    session = await ai.live.connect({
      model: LIVE_MODEL,
      callbacks:{
        onopen:()=>{ ready=true; safeSend(clientWs,{type:"ready",bot,voice:GEMINI_VOICE,model:LIVE_MODEL}); for(const m of pending){ try{ session.sendRealtimeInput(m); }catch(e){} } pending=[]; },
        onmessage:onGeminiMessage,
        onerror:e=>{ console.error("Gemini error",e); safeSend(clientWs,{type:"error",message:"Gemini Live error: "+(e?.message||String(e))}); },
        onclose:e=>{ console.log("Gemini closed", e?.reason||e); safeSend(clientWs,{type:"closed",reason:e?.reason||"Gemini closed"}); }
      },
      config:{
        responseModalities:[Modality.AUDIO],
        speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName:GEMINI_VOICE } } },
        systemInstruction:{ parts:[{ text: buildPrompt(bot) }] },
        outputAudioTranscription:{},
        realtimeInputConfig:{ automaticActivityDetection:{ disabled:true } }
      }
    });
  }catch(e){ console.error("connect Gemini failed",e); safeSend(clientWs,{type:"error",message:"Could not connect Gemini Live: "+e.message}); clientWs.close(1011,"Gemini failed"); return; }
  clientWs.on("message", raw=>{
    try{
      const msg=JSON.parse(raw.toString());
      if(msg.type==='ping'){ safeSend(clientWs,{type:'pong',t:Date.now()}); return; }
      if(msg.type==='audio'&&msg.data){ sendToGemini({audio:{data:msg.data,mimeType:msg.mimeType||'audio/pcm;rate=16000'}}); return; }
      if(msg.type==='audioEnd'){ sendToGemini({audioStreamEnd:true}); safeSend(clientWs,{type:'heardYou'}); return; }
      if(msg.type==='text'&&msg.text){ sendToGemini({text:String(msg.text).slice(0,1000)}); return; }
    }catch(e){ safeSend(clientWs,{type:'error',message:'Bad client message: '+e.message}); }
  });
  clientWs.on('close',()=>{ clearInterval(pingTimer); try{session?.close()}catch{} console.log('Browser disconnected'); });
  clientWs.on('error',e=>console.error('Browser ws error',e));
});
server.listen(PORT,()=>console.log(`Gold Queen Live call server on port ${PORT}`));
