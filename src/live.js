import { GoogleGenAI, Modality } from '@google/genai';

// TRANSCRIBE_MODE=chunk (default): audio sent every CHUNK_MS to a Gemini model with a Hinglish prompt.
// TRANSCRIBE_MODE=live: Gemini Live built-in input transcription.
const MODE = process.env.TRANSCRIBE_MODE || 'chunk';
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const CHUNK_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.8-flash';
const CHUNK_MS = Number(process.env.CHUNK_MS) || 4000;
const TAIL_MS = 1500;

const CHUNK_PROMPT =
  'Transcribe this audio exactly as spoken. The speaker mixes Hindi and English (Hinglish). ' +
  'Write Hindi words in Devanagari script and English words in Latin script. ' +
  'Output only the transcript, no commentary or translation. If there is no speech, output nothing.';

const LIVE_PROMPT =
  'You are a silent speech transcriber. The speaker may mix Hindi and English in one sentence. ' +
  'Never reply or speak. Do not answer questions in the audio.';

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const makeSend = (ws) => (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
const parse = (data) => {
  try { return JSON.parse(data.toString()); } catch { return null; }
};

async function transcribeWithRetry(ai, pcm) {
  const models = [
    CHUNK_MODEL,
    ...(process.env.GEMINI_FALLBACK_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
  ];
  let lastErr;
  for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: 'audio/wav', data: wav(pcm).toString('base64') } },
                { text: CHUNK_PROMPT },
              ],
            },
          ],
        });
        return (r.text || '').trim();
      } catch (e) {
        lastErr = e;
        if (![429, 500, 503].includes(e.status)) break; // not temporary, try next model
        await new Promise((res) => setTimeout(res, 800 * attempt));
      }
    }
  }
  throw lastErr;
}

// ---------- chunk mode ----------
function chunkConnection(ws) {
  const send = makeSend(ws);
  let ai = null;
  let bufs = [];
  let chain = Promise.resolve();
  let timer = null;

  const flush = () => {
    const pcm = Buffer.concat(bufs);
    bufs = [];
    if (pcm.length < 16000) return; // under 0.5 s, skip
    chain = chain.then(async () => {
      try {
        const t = await transcribeWithRetry(ai, pcm);
        if (t) send({ type: 'transcript', text: ' ' + t });
      } catch (e) {
        console.error('Transcribe failed after retries:', e.status || e.message);
        // keep the audio so the next chunk retries it (max about 60 s)
        if (pcm.length < 32000 * 60) bufs.unshift(pcm);
      }
    });
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      bufs.push(Buffer.from(data));
      return;
    }
    const msg = parse(data);
    if (!msg) return;
    if (msg.type === 'start') {
      if (!process.env.GEMINI_API_KEY) {
        return send({ type: 'error', message: 'GEMINI_API_KEY is not set on the server' });
      }
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      timer = setInterval(flush, CHUNK_MS);
      send({ type: 'ready' });
    }
    if (msg.type === 'stop') {
      clearInterval(timer);
      flush();
      chain.then(() => send({ type: 'final' }));
    }
  });
  ws.on('close', () => clearInterval(timer));
}

// ---------- live mode ----------
function liveConnection(ws) {
  const send = makeSend(ws);
  let session = null;
  let stopping = false;
  const closeSession = () => {
    try { session?.close(); } catch { /* closed */ }
    session = null;
  };

  async function start() {
    if (!process.env.GEMINI_API_KEY) {
      return send({ type: 'error', message: 'GEMINI_API_KEY is not set on the server' });
    }
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          systemInstruction: LIVE_PROMPT,
        },
        callbacks: {
          onopen: () => send({ type: 'ready' }),
          onmessage: (m) => {
            const t = m.serverContent?.inputTranscription?.text;
            if (t) send({ type: 'transcript', text: t });
          },
          onerror: (e) => send({ type: 'error', message: e?.message || 'Gemini error' }),
          onclose: () => { if (!stopping) send({ type: 'error', message: 'Gemini session closed' }); },
        },
      });
    } catch (err) {
      console.error('Gemini connect failed:', err);
      send({ type: 'error', message: err?.message || 'Could not connect to Gemini Live' });
    }
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!session || stopping) return;
      session.sendRealtimeInput({
        audio: { data: Buffer.from(data).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
      });
      return;
    }
    const msg = parse(data);
    if (!msg) return;
    if (msg.type === 'start') start();
    if (msg.type === 'stop') {
      stopping = true;
      try { session?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* ignore */ }
      setTimeout(() => { send({ type: 'final' }); closeSession(); }, TAIL_MS);
    }
  });
  ws.on('close', () => { stopping = true; closeSession(); });
}

export const handleLiveConnection = MODE === 'live' ? liveConnection : chunkConnection;