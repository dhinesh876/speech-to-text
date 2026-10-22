# Bol — Real-time Hindi + English Speech-to-Text

Live multilingual transcription with a saved-history dashboard (full CRUD).

**Stack:** Node.js, Express, WebSocket (`ws`), MongoDB (Mongoose), Gemini Live API (`@google/genai`), vanilla JS frontend (no build step).

## How it works

```
Browser mic → AudioWorklet (16 kHz PCM16) → WebSocket → Node server → Gemini Live
                                                    ↑                       │
                                    live text  ←────┴── input transcription ┘
On Stop → text saved to MongoDB via REST → history list refreshes
```

The Gemini API key stays on the server. The browser never sees it.

## Setup (local)

Requirements: Node 18+, MongoDB (local or Atlas), a free Gemini API key.

```bash
git clone <your-repo-url> && cd speech-to-text
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Edit `.env`:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Free key from https://aistudio.google.com/apikey |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/speech_to_text` or your Atlas URI |
| `GEMINI_LIVE_MODEL` | Live model id (default `gemini-3.1-flash-live-preview`). If connect fails with "model not found", pick a current Live model from AI Studio. |

Start MongoDB locally if needed (`mongod`, or `docker run -d -p 27017:27017 mongo:7`), then:

```bash
npm start        # or: npm run dev
```

Open http://localhost:3000, click **Start speaking**, allow the mic, speak. Click **Stop** to save.

## REST API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/transcriptions?page=1&limit=10&q=text` | List, search, paginate |
| GET | `/api/transcriptions/:id` | Get one |
| POST | `/api/transcriptions` | Create `{ title?, text, durationSec?, source? }` |
| PUT | `/api/transcriptions/:id` | Update `{ title?, text? }` |
| DELETE | `/api/transcriptions/:id` | Delete |
| WS | `/ws/live` | Live audio in, transcript out |

## Deploy (Render + MongoDB Atlas, free)

1. **Atlas:** create a free M0 cluster, add a database user, allow `0.0.0.0/0` under Network Access, copy the connection string.
2. **GitHub:** push this repo.
3. **Render:** New → Web Service → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment: `MONGODB_URI`, `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL`
4. Open the Render URL (HTTPS, so the mic works). WebSockets are supported out of the box.

Vercel and Netlify do not support long-lived WebSocket servers. Use Render, Railway, or Fly.io.

## Push to GitHub

```bash
git init
git add .
git commit -m "Real-time Hindi+English speech-to-text with MongoDB dashboard"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## Notes

- Mic access needs HTTPS or `localhost`.
- Transcription quality for code-mixed speech (Hinglish) depends on the Gemini model. Speak clearly, one speaker.
- The live endpoint is open. Before sharing the URL widely, add auth or rate limiting to protect your Gemini quota.
