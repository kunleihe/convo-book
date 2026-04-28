# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend
```bash
# Start dev server (auto-reload, runs on :8000)
cd backend && ./start_server.sh

# The script sources app/.env.{ENVIRONMENT} if present, falls back to app/.env
# load_dotenv uses override=False — system env vars take precedence over .env
# If OPENAI_API_KEY is set in the system env, it will override the .env value.
# Workaround for local dev:
set -a && source backend/app/.env && set +a
cd backend && /path/to/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Run tests
cd backend && python -m pytest tests/
# or a single test file:
python -m pytest tests/test_books_s3_urls.py -v
```

### Frontend
```bash
cd frontend
npm run dev        # Dev server on :5173
npm run build      # Production build
npm run lint       # ESLint
npm run build:staging     # Staging build
npm run build:production  # Production build
```

### Python environment
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

## Architecture

### Overview
Full-stack children's reading app. Children read story pages and answer questions via voice. The backend relays audio to OpenAI for transcription and uses an HTTP chat API for AI tutoring responses (2-round dialogue model).

### Backend (`backend/app/`)

**Framework**: FastAPI + uvicorn. Entry point: `main.py`.

**Routes** (all registered in `main.py`):
| Router | Prefix | Purpose |
|--------|--------|---------|
| `health_check` | `/health` | Liveness check |
| `realtime` | — | WebSocket relay to OpenAI Realtime API (`/realtime`, `/transcription`) |
| `books` | `/api` | Serve book data with presigned S3 URLs |
| `auth` | `/api/auth` | JWT login; user credentials fetched from S3 `config/users.json` |
| `prompts` | `/api` | Legacy prompt fetching (unused by new chat flow) |
| `conversations` | `/api` | Store conversation turns as JSON in S3 |
| `uploads` | `/api` | Generate presigned S3 upload URLs for page recordings |
| `chat` | `/api` | `POST /api/chat` — 2-round AI tutoring via gpt-4.1-mini |
| `tts` | `/api` | `POST /api/tts` — streaming MP3 via gpt-4o-mini-tts |

**Key data files**:
- `backend/data/books/{book_id}.yaml` — single-file book format (see below)
- `backend/data/model-settings-en.yaml` — LLM model/temperature and round1/round2 prompt templates
- `backend/data/prompts.yaml` — legacy prompt templates (used by `prompts.py`)

**Book YAML format** (`data/books/`):
```yaml
metadata:
  id: speed-racer
  title: Speed Racer
  uri_prefix: books/speed-racer/   # S3 key prefix
  cover_uri: images/cover.png
pages:
  - page_number: 1
    image_uri: images/page-01.png
    narration_uri: audios/narration/page-01.wav
    text: |  # rendered as storyText in frontend
      ...
    questions:
      - id: q1
        text: "..."
        audio_uri: audios/questions/page-01-q1.mp3
        custom_prompt: "Expected answer..."  # optional; omit for open-ended
```
`books.py` concatenates `uri_prefix + relative_uri` to form the S3 key, then calls `s3_client.generate_download_url()` to get presigned URLs. Field names are remapped to camelCase for the frontend (`text` → `storyText`, `custom_prompt` → `customPrompt`, etc.).

**Chat endpoint** (`routes/chat.py`):
- Loads `model-settings-en.yaml` with `lru_cache`
- Template substitution uses `str.replace()` (NOT `.format()`) because placeholders use `${}` syntax
- `round_number >= 2` forces `is_final = True`
- Calls OpenAI with `response_format={"type": "json_object"}` — the prompts must contain the word "JSON"

**Config** (`app/config.py`):
- `load_dotenv(override=False)` — system environment variables always win over `.env`
- JWT secret auto-generated for `ENVIRONMENT=development`
- Required vars for staging/production: `API_KEY`, `AWS_*`, `S3_BUCKET_NAME`, `JWT_SECRET_KEY`

### Frontend (`frontend/src/`)

**Framework**: React 18 + Vite. Router entry: `App.jsx`. All routes are auth-protected via `ProtectedRoute`.

**Main routes**:
- `/` → `BookLibrary` — grid of available books
- `/book/:bookId/page/:pageNumber` → `BookReader` — reading experience
- `/device-check` → device compatibility check

**Key hooks**:

| Hook | Purpose |
|------|---------|
| `useAuth` | JWT auth state (localStorage: `authToken`, `username`) |
| `useHTTPChat` | 2-round tutoring via `POST /api/chat` + `POST /api/tts`; manages `conversationHistory`, `roundNumber`, `questionComplete` |
| `useTranscriptionWebSocket` | WebSocket to `/transcription`; VAD-enabled; accumulates per-segment `completed` events; exposes `getFinalTranscript()` / `clearAccumulatedTranscript()` |
| `usePageVoiceChat` | Legacy hook using `/realtime` WebSocket (Realtime API relay) — still present but superseded by `useHTTPChat` |

**`BookReader` → `InteractivePanel` data flow**:
1. `BookReader` opens chat panel when user clicks Next on a page with questions
2. Passes `question`, `pageText`, `bookId`, `pageNumber`, `sharedStream`, `onQuestionComplete`
3. `InteractivePanel` initializes `useHTTPChat` + connects `useTranscriptionWebSocket`
4. User presses `VoiceButton` → audio chunks sent to transcription WS → delta events update ghost bubble
5. On recording stop: `getFinalTranscript()` → `httpChat.submitTranscript(text)` → `/api/chat` → `/api/tts`
6. When `httpChat.questionComplete` becomes `true`: calls `onQuestionComplete()` → `BookReader` unlocks Next button

**`VoiceButton` callbacks**:
- `onAudioChunk(pcm16)` — streaming to transcription WS
- `onRecordingStart()` — clears ghost bubble
- `onRecordingComplete({isSilent})` — triggers transcript submission
- `onAudioRecorded(pcm16)` — full buffer (legacy, unused in new flow)

**TTS playback** (`useHTTPChat._playTTS`):
- Primary: `MediaSource API` streaming
- Fallback: `ArrayBuffer` → `AudioContext.decodeAudioData()`

**Auth**: `api.js` wraps `fetch` with `Authorization: Bearer {token}`. WebSocket auth passes token as query param `?token=`.

### WebSocket endpoints (`routes/realtime.py`)

Both `/realtime` and `/transcription` are reverse-proxy WebSockets to OpenAI's Realtime API. The backend:
1. Validates JWT from query param
2. Opens a server-side WS to OpenAI with the API key
3. Relays messages bidirectionally

`TRANSCRIPTION_CONFIG` in `config.py` controls the transcription session (VAD enabled, `server_vad` with 500ms silence detection).

### S3 layout
```
books/speed-racer/
  images/cover.png, images/page-NN.png
  audios/narration/page-NN.wav
  audios/questions/page-NN-qM.mp3
config/users.json
user-data/{username}/{book_id}/page-{N}/conversations/{timestamp}-{sender}-{uuid}.json
user-data/{username}/{book_id}/page-{N}/{stage}/reading.webm
```

## Environment variables

**Backend** (`backend/app/.env`):
```
ENVIRONMENT=development
OPENAI_API_KEY=...
OPENAI_REALTIME_URL=wss://api.openai.com/v1/realtime?model=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=...
S3_BUCKET_NAME=...
JWT_SECRET_KEY=...   # optional in development (auto-generated)
```

**Frontend** (`frontend/.env` or `frontend/.env.development`):
```
VITE_API_URL=http://localhost:8000
```
