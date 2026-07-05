# Clip Studio

Locally hosted, containerized tool that turns OBS gameplay clips into 1080x1920 vertical
Shorts with word-accurate, styled, burned-in captions. Everything runs on your machine —
transcription (Whisper on your GPU), compositing (FFmpeg/NVENC), and caption rendering
(Remotion). No accounts, no uploads, no cost.

## What it does

1. **Scan** your OBS recordings folder (mounted read-only).
2. **Transcribe** selected clips with faster-whisper (word-level timestamps, GPU).
3. **Review** each clip in the browser: fix mis-heard words, drag the crop framing,
   pick a caption style — the preview shows exactly what will render.
4. **Render** 1080x1920 verticals into `./output/`, webcam stacked on top of gameplay,
   captions burned in.

Supported source layouts:

| Source | Handling |
|---|---|
| 3840x1080 (dual monitor) | Webcam = left half, gameplay = right half, stacked vertically |
| 1920x1080 | Webcam overlay region (saved as a reusable preset) stacked over a gameplay crop |
| Anything else | Single adjustable 9:16 crop |

Caption modes: **word-for-word** (one word at a time) or **highlight** (~5-word lines with
the spoken word highlighted). Styles: Bold Pop, Karaoke Highlight, Pill Highlight —
color and size adjustable per clip.

## Requirements

- Windows with Docker Desktop (WSL2 backend) and an NVIDIA GPU
  (GPU passthrough enabled — it is by default in current Docker Desktop).
- ~4 GB disk for images + ~1.5 GB for the Whisper model (downloaded once into a volume).

## Setup

1. Copy `.env.example` to `.env` and set `RECORDINGS_PATH` to your OBS recordings
   folder (forward slashes, even on Windows).
2. Start it:

   ```powershell
   docker compose up -d --build
   ```

3. Open **http://localhost:3000**.

First transcription downloads the Whisper model (~1.5 GB, one time). Stop everything with
`docker compose down` — models, database, and work files persist in Docker volumes.

## Usage

1. **Scan folder** — new clips appear in the table.
2. Select clips → **Transcribe selected** (serial queue, one GPU).
3. Click a row → review screen: edit transcript words (amber = low confidence), drag
   webcam/gameplay crops, pick style/mode/color/position, **Save** (or **Save & Next**).
4. Back on the batch screen: **Render all ready**. Outputs land in `./output/`.

Extras:
- **Custom vocabulary** (batch screen → settings): names and game terms Whisper should
  recognize (e.g. "Thuun, Fortnite, POI names").
- Clips flagged **no speech** can be re-run with "Transcribe anyway".
- A banner warns if transcription is falling back to CPU or the whisper service is down.

### Default profiles

Tune one clip on the review screen (crops, style, colors, caption position), then click
**Save as default for &lt;layout&gt; clips**. All future transcriptions of that layout
(dual / single / other) start from those settings instead of the built-in defaults.
Overwrite the profile by re-saving from another clip.

## Adding a caption style

1. Create `studio/remotion/styles/MyStyle.tsx` — a React component receiving
   `{ line, activeIndex, t, highlightColor, fontSize, frame?, fps? }`
   (see `KaraokeHighlight.tsx` for the pattern).
2. Register it in `studio/remotion/styles/registry.ts` with an id, display name,
   defaults, and `supportsModes`.

That's it — the style picker, browser preview, and final render all read the registry.

## Development

```powershell
cd studio
npm install
npm test              # vitest unit suite
npx tsc --noEmit      # typecheck
npm run dev           # API server on :3000 (needs ffmpeg/ffprobe on PATH)
npm run dev:web       # Vite dev server with /api proxy
npm run remotion      # Remotion studio for caption styles
```

whisper-api tests: `cd whisper-api && python -m pytest tests`.

End-to-end check (builds/starts containers, transcribes + renders the shortest clip,
asserts a 1080x1920 output):

```powershell
pwsh scripts/smoke.ps1            # or -SkipBuild if images are current
```

## Architecture

```
whisper-api (Python/FastAPI, CUDA)      studio (Node/Fastify)
  POST /transcribe ── word timestamps ──▶  SQLite state + serial job queues
                                           FFmpeg: crop/stack → 1080x1920 base (NVENC)
                                           Remotion: caption layer over base
                                           React UI (batch + review screens)
```

Design and decision log: `docs/plans/2026-07-02-obs-clip-captioner-design.md`.
