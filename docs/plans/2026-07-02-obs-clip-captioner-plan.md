# OBS Clip Captioner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Locally hosted two-container app that batch-converts OBS clips into 1080x1920 vertical Shorts with reviewed, styled, word-accurate burned-in captions.

**Architecture:** `whisper-api` (Python/FastAPI + faster-whisper, CUDA) does transcription with word timestamps. `studio` (Node/Fastify + React/Vite + Remotion + FFmpeg) serves the UI, manages jobs in SQLite, composites the vertical base video with FFmpeg/NVENC, and renders the caption layer with Remotion. See `docs/plans/2026-07-02-obs-clip-captioner-design.md`.

**Tech Stack:** Python 3.11, FastAPI, faster-whisper; Node 20, Fastify, better-sqlite3, React 18, Vite, Remotion 4, fluent-free FFmpeg via child_process; Docker Compose with NVIDIA GPU passthrough; Vitest + pytest.

**Conventions:**
- Repo root: `e:\Content\Content editor\clip-studio`
- Commit after every green test. Conventional commits (`feat:`, `test:`, `chore:`).
- All FFmpeg invocations via a single `runFFmpeg(args: string[])` helper — never string-concatenated shell commands.
- Media paths inside containers: `/media/recordings` (ro), `/media/output`, `/data` (SQLite + work files).

---

## Phase 1 — Scaffolding

### Task 1: Repo layout + docker-compose skeleton

**Files:**
- Create: `docker-compose.yml`, `.gitignore`, `README.md`
- Create: `whisper-api/` and `studio/` directories

**Step 1: Write `docker-compose.yml`**

```yaml
services:
  whisper-api:
    build: ./whisper-api
    ports: ["8090:8090"]
    volumes:
      - whisper-models:/models
      - "C:/Users/Thuun/Dropbox/Content Creation Folder/OBS recordings:/media/recordings:ro"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
  studio:
    build: ./studio
    ports: ["3000:3000"]
    environment:
      - WHISPER_API_URL=http://whisper-api:8090
    volumes:
      - "C:/Users/Thuun/Dropbox/Content Creation Folder/OBS recordings:/media/recordings:ro"
      - ./output:/media/output
      - studio-data:/data
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
volumes:
  whisper-models:
  studio-data:
```

**Step 2: `.gitignore`**: `node_modules/`, `output/`, `*.pyc`, `__pycache__/`, `dist/`, `.venv/`, `/data/`

**Step 3: Commit** `chore: scaffold repo with docker-compose skeleton`

---

## Phase 2 — whisper-api

### Task 2: FastAPI transcription service (test-first on the response shaper)

**Files:**
- Create: `whisper-api/app/main.py`, `whisper-api/app/transcribe.py`, `whisper-api/requirements.txt`, `whisper-api/Dockerfile`
- Test: `whisper-api/tests/test_transcribe.py`

**Step 1: Failing test for the segment→words flattener** (pure function; the model itself is not unit-tested)

```python
# tests/test_transcribe.py
from app.transcribe import flatten_words

class FakeWord:
    def __init__(self, word, start, end, probability):
        self.word, self.start, self.end, self.probability = word, start, end, probability

class FakeSegment:
    def __init__(self, words): self.words = words

def test_flatten_words_strips_and_orders():
    segs = [FakeSegment([FakeWord(" Hello", 0.0, 0.4, 0.99), FakeWord(" world", 0.4, 0.8, 0.98)])]
    out = flatten_words(segs)
    assert out == [
        {"text": "Hello", "start": 0.0, "end": 0.4, "confidence": 0.99},
        {"text": "world", "start": 0.4, "end": 0.8, "confidence": 0.98},
    ]

def test_flatten_words_skips_empty_tokens():
    segs = [FakeSegment([FakeWord("  ", 0.0, 0.1, 0.5)])]
    assert flatten_words(segs) == []
```

**Step 2: Run** `cd whisper-api && python -m pytest tests -v` → FAIL (module missing)

**Step 3: Implement `app/transcribe.py`**

```python
def flatten_words(segments):
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            words.append({"text": text, "start": round(w.start, 3),
                          "end": round(w.end, 3), "confidence": round(w.probability, 3)})
    return words
```

**Step 4: Run tests** → PASS. **Step 5: Commit** `feat(whisper): word flattener`

**Step 6: Implement `app/main.py`** — FastAPI app:
- `GET /health` → `{"status": "ok", "device": "cuda"|"cpu"}`
- `POST /transcribe` body `{"path": "/media/recordings/clip.mp4", "initial_prompt": "..."}` → runs `WhisperModel("distil-large-v3", device="cuda", compute_type="float16")` (lazy singleton; fall back to `device="cpu", compute_type="int8"` on load failure and expose that in `/health`), `model.transcribe(path, word_timestamps=True, initial_prompt=...)`, returns `{"words": flatten_words(segments), "language": info.language, "duration": info.duration}`. Return 404 if path missing; 422 if no words found (`{"error": "no_speech"}`).

**Step 7: `Dockerfile`** — base `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04`, install python3.11 + pip, `pip install -r requirements.txt` (`fastapi`, `uvicorn`, `faster-whisper`), `HF_HOME=/models` so weights persist in the volume, CMD uvicorn on 8090.

**Step 8: Build & smoke test**

```
docker compose build whisper-api && docker compose up -d whisper-api
curl http://localhost:8090/health
curl -X POST http://localhost:8090/transcribe -H "Content-Type: application/json" -d '{"path": "/media/recordings/2v1 as Rambo.mp4"}'
```
Expected: JSON with words array with plausible timestamps. **Commit** `feat(whisper): transcription endpoint + Dockerfile`

---

## Phase 3 — studio backend core

### Task 3: Fastify skeleton + SQLite schema

**Files:**
- Create: `studio/package.json`, `studio/server/index.ts`, `studio/server/db.ts`
- Test: `studio/server/db.test.ts`

**Step 1:** `npm create` studio workspace: `fastify`, `better-sqlite3`, `zod`, dev: `typescript`, `tsx`, `vitest`, `@types/*`.

**Step 2: Failing test — schema + clip upsert**

```ts
// db.test.ts
import { createDb } from "./db";
test("upsertClip is idempotent by path", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080, duration: 42.5 });
  db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080, duration: 42.5 });
  expect(db.listClips()).toHaveLength(1);
  expect(db.listClips()[0].status).toBe("new");
});
```

**Step 3:** Run `npx vitest run server/db.test.ts` → FAIL.

**Step 4: Implement `db.ts`** — tables:

```sql
clips(id INTEGER PK, path TEXT UNIQUE, width INT, height INT, duration REAL,
      status TEXT DEFAULT 'new',  -- new|transcribing|review|no_speech|ready|rendering|done|error
      error TEXT,
      transcript_json TEXT,        -- [{text,start,end,confidence}]
      settings_json TEXT)          -- {styleId, mode, captionY, webcamCrop:{x,y,w,h}, gameplayCrop:{x,y,w,h}}
presets(id INTEGER PK, name TEXT UNIQUE, json TEXT)  -- e.g. saved 1080p webcam region
```

Expose `upsertClip`, `listClips`, `getClip`, `updateClip(id, fields)`.

**Step 5:** Tests pass. **Commit** `feat(studio): sqlite layer`

### Task 4: Clip scanning + probe

**Files:**
- Create: `studio/server/ffmpeg.ts` (runFFmpeg/runFFprobe helpers), `studio/server/scan.ts`
- Test: `studio/server/scan.test.ts`

**Step 1: Failing test — probe parser** (pure: parse ffprobe JSON → {width,height,duration}); layout detection: `detectLayout(w,h)` → `"dual" (3840x1080) | "single" (1920x1080) | "other"`.

```ts
test("detectLayout", () => {
  expect(detectLayout(3840, 1080)).toBe("dual");
  expect(detectLayout(1920, 1080)).toBe("single");
  expect(detectLayout(2560, 1440)).toBe("other");
});
```

**Step 2–4:** Implement; `scanRecordings(dir)` walks `/media/recordings` for `.mp4/.mkv/.mov`, probes new files, upserts clips. **Commit** `feat(studio): clip scan + probe`

### Task 5: API routes — clips + transcription jobs

**Files:**
- Create: `studio/server/routes.ts`, `studio/server/jobs.ts`
- Test: `studio/server/jobs.test.ts` (queue logic with a fake worker)

Routes:
- `GET /api/clips` (with status), `POST /api/scan`
- `POST /api/clips/:id/transcribe` and `POST /api/transcribe-batch {ids}` → enqueue
- `PATCH /api/clips/:id` — update transcript_json / settings_json / status
- `GET /api/clips/:id/file` — stream source video (range requests) for the preview player

Jobs: simple in-process serial queue (one GPU — serialize). Worker calls `WHISPER_API_URL/transcribe`; on success set `status='review'` + transcript; on 422 `no_speech`; on error `status='error'`.

**Test-first** the queue: enqueue 3 with a fake async worker, assert serial execution and status transitions. **Commit** `feat(studio): api + transcription queue`

---

## Phase 4 — Caption timing logic (pure, fully TDD)

### Task 6: Word→line chunking + highlight windows

**Files:**
- Create: `studio/shared/captions.ts` (shared by server, Remotion, and UI)
- Test: `studio/shared/captions.test.ts`

**Step 1: Failing tests**

```ts
import { chunkWords, activeWordIndex } from "./captions";
const w = (text: string, start: number, end: number) => ({ text, start, end, confidence: 1 });

test("chunks into lines of max 5 words", () => {
  const words = "one two three four five six seven".split(" ").map((t, i) => w(t, i, i + 1));
  const lines = chunkWords(words, { maxWords: 5 });
  expect(lines.map(l => l.words.length)).toEqual([5, 2]);
  expect(lines[0].start).toBe(0);
  expect(lines[0].end).toBe(5);
});

test("breaks line early on gap > 1.2s (sentence pause)", () => {
  const words = [w("hey", 0, 0.3), w("wow", 2.0, 2.4), w("ok", 2.4, 2.8)];
  const lines = chunkWords(words, { maxWords: 5 });
  expect(lines.map(l => l.words.map(x => x.text))).toEqual([["hey"], ["wow", "ok"]]);
});

test("line end extends to next line start (no caption flicker)", () => {
  const words = [w("a", 0, 0.5), ...Array.from({length: 5}, (_, i) => w("x", 1 + i, 1.2 + i))];
  const lines = chunkWords(words, { maxWords: 5 });
  expect(lines[0].end).toBe(lines[1].start);
});

test("activeWordIndex returns spoken word at time t", () => {
  const line = { start: 0, end: 3, words: [w("a", 0, 1), w("b", 1, 2), w("c", 2, 3)] };
  expect(activeWordIndex(line, 1.5)).toBe(1);
  expect(activeWordIndex(line, 0)).toBe(0);
  expect(activeWordIndex(line, 2.99)).toBe(2);
});
```

**Step 2:** FAIL. **Step 3:** Implement `chunkWords(words, {maxWords, gapBreak = 1.2})` and `activeWordIndex`. Word-for-word mode is just `maxWords: 1`. **Step 4:** PASS. **Step 5: Commit** `feat: caption chunking logic`

---

## Phase 5 — FFmpeg compositing

### Task 7: Filter-graph builder (TDD) + composite runner

**Files:**
- Create: `studio/server/composite.ts`
- Test: `studio/server/composite.test.ts`

**Step 1: Failing tests on the pure filter-string builder**

```ts
import { buildStackFilter } from "./composite";
test("dual layout: crops both halves and stacks to 1080x1920", () => {
  const f = buildStackFilter({
    webcamCrop: { x: 420, y: 0, w: 1080, h: 700 },
    gameplayCrop: { x: 2340, y: 0, w: 686, h: 1080 },  // any 9:16-ish region; scaled to fill
  });
  expect(f).toContain("crop=1080:700:420:0");
  expect(f).toContain("crop=686:1080:2340:0");
  expect(f).toContain("scale=1080:1220");   // gameplay fills 1920-700
  expect(f).toContain("vstack");
});
```

**Step 2–4:** Implement. Filter shape:

```
[0:v]crop=W:H:X:Y,scale=1080:<topH>[cam];
[0:v]crop=W:H:X:Y,scale=1080:<1920-topH>[game];
[cam][game]vstack=inputs=2[out]
```

`topH` derives from webcam crop aspect at width 1080 (rounded to even). Encoder args: `-c:v h264_nvenc -preset p5 -cq 21 -c:a aac -b:a 192k`. Runner: `compositeClip(clip) → /data/work/<id>/base.mp4`.

**Step 5: Smoke** (needs a real clip mounted): run against `2v1 as Rambo.mp4` with default crops, eyeball output. **Commit** `feat(studio): ffmpeg vertical compositing`

Default crops when a clip enters review:
- dual: webcam = center 1080-wide band of left half; gameplay = center 608x1080 (9:16 of 1080p) of right half.
- single: webcam = saved preset region (or prompt user to draw it first time); gameplay = center of full frame.

---

## Phase 6 — Remotion captions

### Task 8: Remotion project + style registry

**Files:**
- Create: `studio/remotion/Root.tsx`, `studio/remotion/CaptionVideo.tsx`, `studio/remotion/styles/{BoldPop,KaraokeHighlight,PillHighlight}.tsx`, `studio/remotion/styles/registry.ts`

**Steps:**
1. Add `remotion`, `@remotion/cli`, `@remotion/renderer`. Composition `CaptionVideo`: 1080x1920, 30fps, props `{ baseVideoSrc, lines, styleId, mode, captionY }`. It renders `<OffthreadVideo src={baseVideoSrc}/>` plus the style component for the line active at `useCurrentFrame()/fps` (using `activeWordIndex` from `shared/captions.ts`).
2. Style components (each ~50 lines):
   - **BoldPop**: current word only, Montserrat ExtraBold 90px white, 8px black stroke (paint-order trick or text-shadow stack), `spring` scale-in.
   - **KaraokeHighlight**: whole line in white, active word in `highlightColor` (default `#FFE600`) with scale 1.12.
   - **PillHighlight**: whole line white; active word wrapped in rounded rect (`background: highlightColor; border-radius: 16px; padding: 4px 14px`, dark text).
   - Fonts bundled locally (`@remotion/google-fonts/Montserrat` at build time — no runtime fetch).
3. `registry.ts`: `{ id, name, component, defaults: { highlightColor, fontSize }, supportsModes: [...] }`.
4. Verify in Remotion Studio: `npx remotion studio` with a fixture `lines` JSON + sample base video. Eyeball all three styles.
5. **Commit** `feat(remotion): caption composition + 3 styles`

### Task 9: Render pipeline endpoint

**Files:**
- Create: `studio/server/render.ts`; modify `routes.ts`, `jobs.ts`

**Steps:**
1. `renderClip(clip)`: composite base (Task 7, skip if cached & settings unchanged) → `renderMedia()` from `@remotion/renderer` with the composition, `crf 18`, output `/media/output/<clipname>.mp4` (audio comes through from base video).
2. Routes: `POST /api/clips/:id/render`, `POST /api/render-batch`, progress via `GET /api/jobs` polling (`onProgress` → job table in memory).
3. Test-first the cache-key function (`settingsHash(clip)`), then wire.
4. E2E smoke: render one real clip, play the output, verify captions sync + audio present.
5. **Commit** `feat(studio): render pipeline`

---

## Phase 7 — Frontend

### Task 10: Vite + React shell, batch screen

**Files:** `studio/web/` (Vite app, proxied to Fastify in dev; served statically in the container)

Batch screen: table of clips (name, duration, resolution badge, status chip), checkbox multi-select, buttons: **Scan folder**, **Transcribe selected**, **Render all reviewed**. Poll `/api/clips` every 2s while jobs active. Commit per component; visual check in browser.

### Task 11: Review screen

**Components:**
- `<PreviewPlayer>`: `@remotion/player` playing the composition with **live props** — source preview uses CSS-cropped `<video>` panes (mirroring the FFmpeg crops) so no composite is needed for preview; captions overlaid by the same style components. WYSIWYG.
- `<TranscriptEditor>`: words as chips on a timeline list; click → inline edit text (timings kept); low-confidence words (<0.5) tinted amber; delete word supported.
- `<CropControl>`: draggable crop rectangles over a source-frame thumbnail (one for webcam, one for gameplay); horizontal drag; for `single` layout, "Save as preset" for the webcam region.
- `<StylePicker>`: style cards with mini live preview, mode toggle (word-for-word / 5-word highlight), highlight color, caption Y slider (default at seam).
- Save button → `PATCH /api/clips/:id` sets `status='ready'`; Prev/Next clip navigation through the batch.

TDD the props-mapping helpers (clip settings → player props); visual-check the rest. Commit per component.

### Task 12: Containerize studio + full compose up

**Files:** `studio/Dockerfile` (multi-stage: build web + server, runtime with node + ffmpeg + chrome deps for Remotion), modify `docker-compose.yml`.

Smoke: `docker compose up --build` → open `http://localhost:3000` → scan → transcribe → review → render one clip end-to-end. **Commit** `feat: containerize studio`

---

## Phase 8 — Hardening

### Task 13: Edge cases + smoke script

- No-speech flow: UI badge + "transcribe anyway"/exclude.
- `other` resolution → single adjustable crop fallback (design §Error Handling).
- CPU-fallback warning banner (read whisper `/health` device).
- Custom vocabulary: settings page textarea → sent as `initial_prompt`.
- `scripts/smoke.ps1`: compose up → POST scan → transcribe shortest clip → set defaults → render → assert output file exists and ffprobe says 1080x1920.
- **Commit** `feat: edge cases + e2e smoke script`

### Task 14: README

Setup (Docker Desktop + WSL2 GPU), usage walkthrough, how to add a caption style (component + registry entry). **Commit** `docs: README`
