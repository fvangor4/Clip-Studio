import path from "node:path";
import type { Clip, Db } from "./db.js";
import { detectLayout } from "./scan.js";

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

function defaultSettings(db: Db, clip: Clip): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    styleId: "karaokeHighlight",
    mode: "highlight",
    captionY: 960,
  };
  const layout = detectLayout(clip.width ?? 0, clip.height ?? 0);
  if (layout === "dual") {
    settings.webcamCrop = { x: 420, y: 0, w: 1080, h: 640 } satisfies CropRect;
    settings.gameplayCrop = { x: 2526, y: 0, w: 608, h: 1080 } satisfies CropRect;
  } else if (layout === "single") {
    settings.gameplayCrop = { x: 656, y: 0, w: 608, h: 1080 } satisfies CropRect;
    const webcamRegion = db.getPreset("webcamRegion");
    settings.webcamCrop = webcamRegion
      ? (JSON.parse(webcamRegion) as CropRect)
      : ({ x: 0, y: 0, w: 480, h: 270 } satisfies CropRect);
  }
  return settings;
}

/**
 * Transcribe one clip via the whisper-api container. Never throws: all
 * failures are recorded on the clip row as status 'error' (or 'no_speech').
 */
export async function transcribeClip(db: Db, clip: Clip): Promise<void> {
  try {
    db.updateClip(clip.id, { status: "transcribing", error: null });

    const vocab = db.getPreset("vocab");
    const res = await fetch(`${WHISPER_API_URL}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: containerPath(clip.path),
        initial_prompt: vocab || undefined,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { words: TranscriptWord[] };
      const fields: Parameters<Db["updateClip"]>[1] = {
        status: "review",
        transcript_json: JSON.stringify(data.words),
      };
      if (!clip.settings_json) {
        fields.settings_json = JSON.stringify(defaultSettings(db, clip));
      }
      db.updateClip(clip.id, fields);
      return;
    }

    const bodyText = await res.text();
    if (res.status === 422 && bodyText.includes("no_speech")) {
      db.updateClip(clip.id, { status: "no_speech" });
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
