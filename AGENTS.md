# Agent instructions for Clip Studio

Two-container app that turns OBS gameplay clips into 1080x1920 vertical Shorts with
word-accurate burned-in captions. `whisper-api/` = Python/FastAPI transcription (CUDA).
`studio/` = Node/Fastify API + React UI + FFmpeg compositing + Remotion caption rendering.
Design and decision log: `docs/plans/2026-07-02-obs-clip-captioner-design.md`.

## Commands

All Node work happens in `studio/`:

```
npm test              # vitest unit suite — must pass before any commit
npx tsc --noEmit      # typecheck — must pass before any commit
npm run build:web     # Vite build of the React UI
npx remotion compositions remotion/index.ts   # verifies Remotion bundling still works
```

Python: `cd whisper-api && python -m pytest tests`.

Full end-to-end check (builds containers, transcribes + renders a real clip):
`pwsh scripts/smoke.ps1` (or `-SkipBuild`). Run it after changes to compositing,
rendering, or the Dockerfiles.

## Architecture invariants — do not break these

- **WYSIWYG**: the browser preview and the final render must stay pixel-equivalent.
  The preview mirrors the FFmpeg stack math; caption styles are the SAME React
  components in both paths (`studio/remotion/styles/*` are imported by the web UI).
  Style components take optional `frame`/`fps` props (browser) falling back to
  Remotion hooks (render) — keep both paths working.
- **Mirrored constants**: `studio/web/src/review/previewMath.ts` and
  `studio/web/src/review/settings.ts` intentionally mirror
  `studio/server/composite.ts` (topPaneHeight) and `studio/server/jobs.ts`
  (defaultSettings/detectLayout). If you change one side, change the other and
  update the mirror tests that pin them together.
- **`webcamCrop: null` is a sentinel** meaning "gameplay only / single-pane
  composite" — distinct from absent (which gets layout defaults). Preserve null
  through parse/normalize/save round-trips.
- **Serial queues**: transcription and rendering each run on a strictly serial
  in-process queue (one GPU). Don't introduce parallelism in those workers.
- **Composite cache** is keyed on crop rects only (style/transcript changes must
  NOT invalidate `base.mp4`). Keep `settingsHash` usage that way.

## Conventions

- TDD for pure logic (chunking, crop math, hashing, sorting): failing test first.
- FFmpeg is always invoked via `runFFmpeg(args: string[])` — never shell strings.
- SQLite schema changes need an idempotent migration in `createDb`
  (PRAGMA table_info guard) — existing user volumes must keep working.
- Conventional commits (`feat:`, `fix:`, `chore:`, scope optional).
- New caption styles = component in `studio/remotion/styles/` + registry entry.
  Nothing else should need to change.

## Gotchas

- Remotion's OffthreadVideo cannot read `file://` paths — renders serve the base
  video over an ephemeral localhost HTTP server (see `render.ts serveFile`).
- OBS sources carry multiple audio tracks; output maps only `0:a:0` (the mix).
- `docker-compose.yml` reads `RECORDINGS_PATH` from `.env` (see `.env.example`);
  never hardcode user paths in tracked files.
- Windows PowerShell 5 vs pwsh 7: scripts must survive both (see the
  Invoke-RestMethod array-flattening workaround in `scripts/smoke.ps1`).
