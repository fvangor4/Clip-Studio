# OBS Clip Captioner — Design

**Date:** 2026-07-02
**Goal:** A locally hosted, free, containerized web app that batch-converts short OBS gameplay clips into 1080x1920 vertical Shorts with auto-generated, styled, word-accurate burned-in captions.

## Context & Requirements

- Source clips live in `C:\Users\Thuun\Dropbox\Content Creation Folder\OBS recordings`, mostly under 1 minute.
- Two source layouts:
  - **3840x1080**: webcam = left 1920x1080 half, gameplay = right 1920x1080 half.
  - **1920x1080**: gameplay with webcam baked in as an overlay region.
- Output: 1080x1920 vertical, webcam crop stacked on top of gameplay crop (matching existing exports in `C:\Users\Thuun\Dropbox\Content Exports`).
- Captions centered near the webcam/gameplay seam, word-accurate. Two modes:
  1. Word-for-word (one word at a time)
  2. ~5-word lines with the currently spoken word highlighted (karaoke)
- Multiple selectable visual styles; easy to add more over time.
- Quick transcript review/edit step before rendering (fix mishears).
- Adjustable crop framing per clip.
- Batch workflow (container spun up on demand); watch-folder possible later.
- Hardware: decent NVIDIA GPU available. Everything free/open-source.

## Architecture (Hybrid)

Two containers via `docker-compose up`:

1. **`whisper-api`** (Python/FastAPI)
   - `faster-whisper` (large-v3 / distil-large-v3) with CUDA (`--gpus all`, Docker Desktop/WSL2).
   - Endpoint: video/audio in → word-level timestamped JSON out.
   - Accepts an initial-prompt custom vocabulary (game terms, names) to reduce mishears.

2. **`studio`** (Node)
   - React + Vite frontend at `http://localhost:3000`.
   - Job/batch API + queue; state in SQLite (no external DB).
   - FFmpeg: probing, crop/stack compositing, NVENC encode.
   - Remotion: renders the caption layer only.

**Rationale:** FFmpeg does the heavy video work (fast, GPU-encoded); Remotion only draws animated text over an already-composited base video — its fast path. Caption styles are React components shared between the browser preview and the final render, giving true WYSIWYG and making new trending styles an afternoon's work instead of fighting ASS subtitle limitations.

### Data flow per clip

```
clip.mp4 → probe (3840x1080 vs 1920x1080)
        → whisper-api → words + timestamps (JSON)
        → [user: review transcript, adjust crops, pick style]
        → FFmpeg: crop webcam + crop gameplay → stack → 1080x1920 base.mp4 (NVENC)
        → Remotion: caption composition rendered over base.mp4
        → output/clipname.mp4
```

Recordings folder bind-mounted read-only; outputs to a user-chosen mounted `output/` folder.

## UI Flow

1. **Batch screen** — browse mounted recordings, multi-select, "Transcribe". Per-clip progress; already-processed clips marked.
2. **Review screen** (per clip):
   - Video preview with real Remotion caption components overlaid (WYSIWYG).
   - Editable transcript: click a word to fix; timings preserved.
   - Framing: drag gameplay crop horizontally; adjust webcam crop. For 1920x1080 clips, webcam-region preset saved and reused (editable per clip).
   - Style picker: style + mode (word-for-word / 5-word highlight) + caption vertical position (default: at the seam).
3. **Render queue** — "Render all reviewed" → sequential renders with progress; outputs listed.

Per-clip settings persist in SQLite; re-renders skip re-transcription.

## Caption Styles (launch set)

- **Bold Pop** — heavy white sans (Montserrat ExtraBold), black outline, pop-in scale. Word-for-word.
- **Karaoke Highlight** — ~5 words/line, spoken word switches to highlight color with subtle scale.
- **Pill Highlight** — 5-word line, spoken word gets a rounded colored background pill.
- Color/font-size settings per style. New style = new React component + registry entry.

## Error Handling

- No/quiet audio → flagged "no speech found", excluded from render until confirmed.
- Mishears → review UI + custom-vocab initial prompt.
- Odd resolutions → warn, fall back to single adjustable 9:16 crop.
- GPU unavailable → CPU fallback in whisper-api with warning banner.

## Testing

- Unit tests for caption-timing logic (word→line chunking, highlight windows).
- End-to-end smoke script: one short sample clip through transcribe → composite → render.
- Visual validation via UI against real sample clips.

## Decisions Log

- Hybrid (FFmpeg compositing + Remotion captions) chosen over pure ASS/FFmpeg for long-term style flexibility, and over pure Remotion for render speed.
- Batch on-demand, no watch folder (future option).
- Both source layouts produce the same stacked vertical look.
