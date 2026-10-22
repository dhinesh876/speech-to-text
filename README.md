# Bol — Real-time Hindi + English Speech-to-Text

Speak in Hindi, English, or a mix of both. The app transcribes it in near real-time and saves each transcription to a database. A dashboard lets you search, edit, and delete saved transcriptions.

- **Live app:** https://speech-to-text-f8lu.onrender.com
- **Repo:** https://github.com/dhinesh876/speech-to-text

The app runs on Render's free tier, so the first load can take up to a minute to wake up.

**Stack:** Node.js, Express, WebSocket (`ws`), MongoDB (Mongoose), Gemini API (`@google/genai`), vanilla JS frontend (no build step).

## Features

- Real-time transcription of mixed Hindi and English (Hinglish). Hindi comes out in Devanagari, English in Latin script.
- Transcription history saved in MongoDB.
- Full CRUD: create (record or add a typed note), read (list with pagination), update (edit text and title), delete.
- Search by text or title.
- The live text box clears after each recording is saved.

## How it works

```
Browser mic → AudioWorklet (16 kHz PCM16) → WebSocket → Node server → Gemini
                                                   ↑                      │
                                    live text ←────┴──── transcript ──────┘
On Stop → text saved to MongoDB via REST → history list refreshes
```

Audio is sent to Gemini in short chunks (every 4 seconds by default) with a prompt tuned for Hinglish. Failed chunks retry automatically, and the audio is kept if Gemini is overloaded.

The Gemini API key stays on the server. The browser never sees it.

There is also a second mode, `TRANSCRIBE_MODE=live`, which uses Gemini Live's built-in transcription.

## Run locally

Requirements: Node 18+, MongoDB (local or Atlas), a free Gemini API key from https://aistudio.google.com/apikey.

```bash
git clone https://github.com/dhinesh876/speech-to-text.git
cd speech-to-text
npm install
```

Create the env file:

```bash
# Mac/Linux
cp .env.example .env
# Windows
copy .env.example .env
```

Edit `.env`:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/speech_to_text` or your Atlas URI |
| `TRANSCRIBE_MODE` | `chunk` (default) or `live` |
| `GEMINI_TRANSCRIBE_MODEL` | `gemini-3.8-flash` (used in chunk mode) |
| `GEMINI_FALLBACK_MODELS` | Optional, comma-separated backup models |
| `CHUNK_MS` | Chunk length in ms, default `4000` |
| `GEMINI_LIVE_MODEL` | Only for `live` mode |

Start the app:

```bash
npm start
```

Open http://localhost:3000, click **Start speaking**, allow the mic, speak, then click **Stop**.

Check http://localhost:3000/api/health. It should return `{"ok":true,"db":true}`.

## REST API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/transcriptions?page=1&limit=10&q=text` | List, search, paginate |
| GET | `/api/transcriptions/:id` | Get one |
| POST | `/api/transcriptions` | Create `{ title?, text, durationSec?, source? }` |
| PUT | `/api/transcriptions/:id` | Update `{ title?, text? }` |
| DELETE | `/api/transcriptions/:id` | Delete |
| WS | `/ws/live` | Audio in, transcript out |

## Deploy (Render + MongoDB Atlas)

1. **Atlas:** create a free M0 cluster, add a database user, allow `0.0.0.0/0` under Network Access, and copy the connection string with the database name `speech_to_text`.
2. **Render:** New, Web Service, connect this repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variables: `MONGODB_URI`, `GEMINI_API_KEY`, `TRANSCRIBE_MODE=chunk`, `GEMINI_TRANSCRIBE_MODEL=gemini-3.8-flash`, `CHUNK_MS=4000`
3. Open the Render URL. It is served over HTTPS, so the microphone works. WebSockets are supported.

Vercel and Netlify do not support long-lived WebSocket servers. Use Render, Railway, or Fly.io.

## Troubleshooting

| Problem | Fix |
|---|---|
| `MongooseServerSelectionError` | MongoDB is not running, or the Atlas URI or IP allowlist is wrong. |
| "GEMINI_API_KEY is not set" | Add it to `.env` (or Render env vars) and restart. |
| 404 "model no longer available" | Set `GEMINI_TRANSCRIBE_MODEL` to a current model name. |
| 503 "high demand" | Temporary on Google's side. The app retries automatically. |
| Mic blocked | Allow microphone access in the browser. Use `localhost` or HTTPS. |

## Notes

- Mic access needs HTTPS or `localhost`.
- Code-mixed speech quality depends on the Gemini model. Speak clearly, one speaker at a time.
- The live endpoint is open. Add auth or rate limiting before sharing the URL widely, to protect your Gemini quota.