import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compositeClip, type CropRect, type StackCrops } from "./composite.js";
import type { Db } from "./db.js";
import type { TranscriptWord } from "./jobs.js";

/** Recursively sort object keys so hashing is insensitive to key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Stable cache key for composite/render outputs: sha1 of the canonical JSON
 * of the settings (keys sorted at every level) plus the transcript JSON.
 */
export function settingsHash(
  settings: unknown,
  transcriptJson: string | null = null,
): string {
  const hash = createHash("sha1");
  hash.update(JSON.stringify(canonicalize(settings)));
  if (transcriptJson !== null) hash.update(transcriptJson);
  return hash.digest("hex");
}

/**
 * Pick an output path in `dir` for `<base>.mp4`, appending " (2)", " (3)", …
 * when the name is taken.
 */
export function uniqueOutputPath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.mp4`);
  for (let n = 2; existsSync(candidate); n++) {
    candidate = path.join(dir, `${base} (${n}).mp4`);
  }
  return candidate;
}

export interface RenderProgress {
  progress: number;
  stage: "composite" | "render";
}

/** In-memory progress for clips currently compositing/rendering. */
export const renderProgress = new Map<number, RenderProgress>();

export function workDir(): string {
  return (
    process.env.WORK_DIR ??
    (process.platform === "win32" ? "./data/work" : "/data/work")
  );
}

export function outputDir(): string {
  return (
    process.env.OUTPUT_DIR ??
    (process.platform === "win32" ? "./output" : "/media/output")
  );
}

// Bundle the Remotion project once per process; renders reuse the result.
let bundlePromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      const here = path.dirname(fileURLToPath(import.meta.url));
      return bundle({
        entryPoint: path.resolve(here, "../remotion/index.ts"),
      });
    })();
    // Allow a retry on the next render if bundling itself fails.
    bundlePromise.catch(() => {
      bundlePromise = null;
    });
  }
  return bundlePromise;
}

/**
 * Serve a single file over an ephemeral localhost HTTP server for the
 * duration of a render. Remotion's OffthreadVideo proxy cannot fetch file://
 * URLs, so the base video must be reachable over http. Supports range
 * requests (the render browser seeks into the video).
 */
export async function serveFile(
  filePath: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer } = await import("node:http");
  const { createReadStream, statSync } = await import("node:fs");
  const server = createServer((req, res) => {
    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      res.writeHead(404).end();
      return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (match && (match[1] !== "" || match[2] !== "")) {
      const start =
        match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
      const end =
        match[1] !== "" && match[2] !== ""
          ? Math.min(Number(match[2]), size - 1)
          : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": end - start + 1,
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-length": size,
    });
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind base video server");
  }
  return {
    url: `http://127.0.0.1:${address.port}/base.mp4`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

interface ClipSettings {
  webcamCrop?: CropRect;
  gameplayCrop?: CropRect;
  styleId?: string;
  mode?: string;
  captionY?: number;
  highlightColor?: string;
  fontSize?: number;
}

export interface RenderOptions {
  workDir?: string;
  outDir?: string;
}

/**
 * Render one clip end to end: ffmpeg composite (cached by crop hash) then a
 * Remotion caption render into the output dir. Never throws — failures are
 * recorded on the clip row as status 'error'.
 */
export async function renderClip(
  db: Db,
  clipId: number,
  opts: RenderOptions = {},
): Promise<void> {
  const clip = db.getClip(clipId);
  if (!clip) return; // deleted while queued
  if (clip.status !== "ready" && clip.status !== "done") {
    console.log(`render: skipping clip ${clipId} with status '${clip.status}'`);
    return;
  }

  let baseServer: Awaited<ReturnType<typeof serveFile>> | null = null;
  try {
    db.updateClip(clip.id, { status: "rendering", error: null });
    renderProgress.set(clip.id, { progress: 0, stage: "composite" });

    const settings = JSON.parse(clip.settings_json ?? "{}") as ClipSettings;
    if (!settings.webcamCrop || !settings.gameplayCrop) {
      throw new Error("clip settings missing webcamCrop/gameplayCrop");
    }
    const crops: StackCrops = {
      webcamCrop: settings.webcamCrop,
      gameplayCrop: settings.gameplayCrop,
    };

    // Composite step, cached on the crop-relevant hash only so pure style
    // changes never re-run ffmpeg.
    const work = opts.workDir ?? workDir();
    const clipWorkDir = path.join(work, String(clip.id));
    const basePath = path.join(clipWorkDir, "base.mp4");
    const hashPath = path.join(clipWorkDir, "base.hash");
    const cropHash = settingsHash(crops);
    const cached =
      existsSync(basePath) &&
      existsSync(hashPath) &&
      (await readFile(hashPath, "utf8")).trim() === cropHash;
    if (!cached) {
      await compositeClip(clip, crops, work);
      await writeFile(hashPath, cropHash);
    }

    renderProgress.set(clip.id, { progress: 0, stage: "render" });

    const [{ selectComposition, renderMedia }, serveUrl] = await Promise.all([
      import("@remotion/renderer"),
      getBundle(),
    ]);

    baseServer = await serveFile(path.resolve(basePath));
    const words = JSON.parse(clip.transcript_json ?? "[]") as TranscriptWord[];
    const inputProps = {
      baseVideoSrc: baseServer.url,
      words,
      styleId: settings.styleId ?? "karaokeHighlight",
      mode: settings.mode ?? "highlight",
      captionY: settings.captionY ?? 960,
      highlightColor: settings.highlightColor,
      fontSize: settings.fontSize,
      durationSeconds: clip.duration ?? undefined,
    };

    const composition = await selectComposition({
      serveUrl,
      id: "CaptionVideo",
      inputProps,
    });

    const out = opts.outDir ?? outputDir();
    await mkdir(out, { recursive: true });
    const base = path.basename(clip.path, path.extname(clip.path));
    const outputLocation = uniqueOutputPath(out, base);

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 18,
      inputProps,
      outputLocation,
      onProgress: ({ progress }) => {
        renderProgress.set(clip.id, { progress, stage: "render" });
      },
    });

    db.updateClip(clip.id, { status: "done" });
  } catch (err) {
    try {
      db.updateClip(clip.id, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // db failure while reporting an error: nothing left to do
    }
  } finally {
    renderProgress.delete(clip.id);
    await baseServer?.close();
  }
}
