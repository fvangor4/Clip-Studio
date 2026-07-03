import path from "node:path";
import type { Clip, Db } from "./db.js";
import { detectLayout } from "./scan.js";
import { topPaneHeight } from "./composite.js";

export interface Queue<T> {
  enqueue(job: T): void;
  size(): number;
  onIdle(): Promise<void>;
}

/**
 * Strictly serial in-process job queue (one GPU). Worker rejections are
 * swallowed so a failing job never stalls the queue.
 */
export function createQueue<T>(worker: (job: T) => Promise<void>): Queue<T> {
  const jobs: T[] = [];
  let running = false;
  let idleWaiters: (() => void)[] = [];

  async function drain(): Promise<void> {
    running = true;
    while (jobs.length > 0) {
      const job = jobs.shift()!;
      try {
        await worker(job);
      } catch {
        // never stall the queue on a worker failure
      }
    }
    running = false;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  return {
    enqueue(job: T): void {
      jobs.push(job);
      if (!running) void drain();
    },
    size(): number {
      return jobs.length + (running ? 1 : 0);
    },
    onIdle(): Promise<void> {
      if (!running && jobs.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

export const CONTAINER_RECORDINGS_ROOT = "/media/recordings";

export function recordingsDir(): string {
  return process.env.RECORDINGS_DIR ?? "/media/recordings";
}

/**
 * Map a clip path as stored (host view, possibly Windows) to the whisper
 * container's view of the same file. Both containers mount the recordings
 * dir, so we rebase the path relative to the recordings root onto
 * /media/recordings using posix separators.
 */
export function containerPath(
  clipPath: string,
  root: string = recordingsDir(),
): string {
  const relative = path.relative(root, clipPath).split(path.sep).join("/");
  return path.posix.join(CONTAINER_RECORDINGS_ROOT, relative);
}

export const WHISPER_API_URL =
  process.env.WHISPER_API_URL ?? "http://localhost:8090";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function defaultSettings(db: Db, clip: Clip): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    styleId: "karaokeHighlight",
    mode: "highlight",
    captionY: 960,
  };
  const layout = detectLayout(clip.width ?? 0, clip.height ?? 0);
  if (layout === "dual") {
    const webcamCrop = { x: 420, y: 0, w: 1080, h: 640 } satisfies CropRect;
    settings.webcamCrop = webcamCrop;
    settings.gameplayCrop = { x: 2526, y: 0, w: 608, h: 1080 } satisfies CropRect;
    // Default caption sits at the webcam/gameplay seam: the top pane height
    // for the default webcam crop, nudged up ~40px so the text overlaps it.
    settings.captionY = topPaneHeight(webcamCrop) - 40;
  } else if (layout === "single") {
    settings.gameplayCrop = { x: 656, y: 0, w: 608, h: 1080 } satisfies CropRect;
    let webcamCrop: CropRect = { x: 0, y: 0, w: 480, h: 270 };
    const webcamRegion = db.getPreset("webcamRegion");
    if (webcamRegion) {
      try {
        webcamCrop = JSON.parse(webcamRegion) as CropRect;
      } catch {
        // malformed preset: keep the default rect
      }
    }
    settings.webcamCrop = webcamCrop;
  } else {
    // Unrecognized resolution: single full-height centered 9:16 gameplay
    // crop, no webcam stack. webcamCrop null signals single-pane compositing.
    const srcW = clip.width ?? 1920;
    const srcH = clip.height ?? 1080;
    let w = Math.min(srcW, Math.round((srcH * 9) / 16));
    if (w % 2 !== 0) w -= 1;
    settings.gameplayCrop = {
      x: Math.max(0, Math.round((srcW - w) / 2)),
      y: 0,
      w,
      h: srcH,
    } satisfies CropRect;
    settings.webcamCrop = null;
  }
  return settings;
}

/**
 * Custom vocabulary for whisper's initial prompt. The UI stores the preset
 * via PUT /api/presets/vocab, which JSON-encodes the body — so the stored
 * value is usually a JSON string. Accept both JSON-string and raw-text
 * shapes; empty/whitespace yields undefined.
 */
export function vocabPrompt(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let text = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") text = parsed;
    else if (parsed === null) return undefined;
  } catch {
    // raw text stored directly (e.g. seeded by hand): use as-is
  }
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Transcribe one clip via the whisper-api container. Takes the clip id and
 * re-fetches the row so edits made while the job sat in the queue are not
 * lost. Never throws: all failures are recorded on the clip row as status
 * 'error' (or 'no_speech').
 */
export async function transcribeClip(db: Db, clipId: number): Promise<void> {
  const clip = db.getClip(clipId);
  if (!clip) return; // deleted while queued
  try {
    db.updateClip(clip.id, { status: "transcribing", error: null });

    const res = await fetch(`${WHISPER_API_URL}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: containerPath(clip.path),
        initial_prompt: vocabPrompt(db.getPreset("vocab")),
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { words: TranscriptWord[] };
      const fields: Parameters<Db["updateClip"]>[1] = {
        status: "review",
        transcript_json: JSON.stringify(data.words),
      };
      // Re-check on the freshest row: a PATCH may have landed while the
      // transcription request was in flight.
      const fresh = db.getClip(clip.id) ?? clip;
      if (!fresh.settings_json) {
        fields.settings_json = JSON.stringify(defaultSettings(db, clip));
      }
      db.updateClip(clip.id, fields);
      return;
    }

    const bodyText = await res.text();
    if (res.status === 422 && bodyText.includes("no_speech")) {
      // Write defaults here too: a no_speech clip can still be marked ready
      // and rendered, which requires settings (gameplayCrop etc.).
      const fields: Parameters<Db["updateClip"]>[1] = { status: "no_speech" };
      const fresh = db.getClip(clip.id) ?? clip;
      if (!fresh.settings_json) {
        fields.settings_json = JSON.stringify(defaultSettings(db, clip));
      }
      db.updateClip(clip.id, fields);
      return;
    }
    db.updateClip(clip.id, {
      status: "error",
      error: `whisper-api ${res.status}: ${bodyText.slice(0, 500)}`,
    });
  } catch (err) {
    try {
      db.updateClip(clip.id, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // db failure while reporting an error: nothing left to do
    }
  }
}
