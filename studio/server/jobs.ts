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
  // Normalize Windows separators first so this works regardless of the
  // platform the code runs on (dev on Windows, CI/containers on Linux).
  const toPosix = (p: string) => p.replaceAll("\\", "/");
  const relative = path.posix.relative(toPosix(root), toPosix(clipPath));
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

function isCropRect(value: unknown): value is CropRect {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.w === "number" &&
    typeof r.h === "number"
  );
}

const OUT_W = 1080;
const OUT_H = 1920;

/**
 * Full-height gameplay crop whose aspect matches the bottom pane left after
 * the webcam pane (so scaling to fill it does not stretch), centered inside
 * a 1920-wide monitor starting at `monitorX`.
 */
function fittedGameplayCrop(webcamCrop: CropRect, monitorX: number): CropRect {
  const bottomH = OUT_H - topPaneHeight(webcamCrop);
  let w = Math.round((OUT_W * 1080) / bottomH);
  if (w % 2 !== 0) w -= 1;
  return { x: monitorX + Math.round((1920 - w) / 2), y: 0, w, h: 1080 };
}

/**
 * A saved layout profile ("make all my clips look like this one"): the full
 * settings object stored as preset profile:<layout>. Returns undefined when
 * missing or malformed (must parse to an object with a valid gameplayCrop).
 */
function layoutProfile(
  db: Db,
  layout: string,
): Record<string, unknown> | undefined {
  const raw = db.getPreset(`profile:${layout}`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      isCropRect((parsed as Record<string, unknown>).gameplayCrop)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // malformed profile: fall through to built-in defaults
  }
  return undefined;
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
    // Gameplay comes from the right monitor of the 3840x1080 canvas.
    settings.gameplayCrop = fittedGameplayCrop(webcamCrop, 1920);
    // Default caption sits at the webcam/gameplay seam: the top pane height
    // for the default webcam crop, nudged up ~40px so the text overlaps it.
    settings.captionY = topPaneHeight(webcamCrop) - 40;
  } else if (layout === "single") {
    let webcamCrop: CropRect = { x: 0, y: 0, w: 480, h: 270 };
    const webcamRegion = db.getPreset("webcamRegion");
    if (webcamRegion) {
      try {
        const parsed = JSON.parse(webcamRegion) as unknown;
        if (isCropRect(parsed)) webcamCrop = parsed;
      } catch {
        // malformed preset: keep the default rect
      }
    }
    settings.webcamCrop = webcamCrop;
    settings.gameplayCrop = fittedGameplayCrop(webcamCrop, 0);
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
  const profile = layoutProfile(db, layout);
  if (profile) return { ...settings, ...profile };
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
