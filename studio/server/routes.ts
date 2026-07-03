import type { FastifyInstance } from "fastify";
import { createReadStream, statSync } from "node:fs";
import { z } from "zod";
import type { Clip, ClipStatus, Db } from "./db.js";
import {
  recordingsDir,
  transcribeClip,
  createQueue,
  WHISPER_API_URL,
  type Queue,
} from "./jobs.js";
import { renderClip, renderProgress } from "./render.js";
import { scanRecordings } from "./scan.js";

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

const clipStatusSchema = z.enum([
  "new",
  "transcribing",
  "review",
  "no_speech",
  "ready",
  "rendering",
  "done",
  "error",
]) satisfies z.ZodType<ClipStatus>;

const transcriptWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
});

const patchClipSchema = z
  .object({
    transcript: z.array(transcriptWordSchema).optional(),
    settings: z.record(z.unknown()).optional(),
    status: clipStatusSchema.optional(),
  })
  .strict();

const batchSchema = z.object({ ids: z.array(z.number().int().positive()) });

function safeParseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function serializeClip(clip: Clip) {
  const { transcript_json, settings_json, ...rest } = clip;
  return {
    ...rest,
    transcript: safeParseJson(transcript_json),
    settings: safeParseJson(settings_json),
  };
}

interface SerialJobQueue {
  /** Enqueue eligible clip ids; returns how many were actually queued. */
  enqueueClips(ids: number[]): number;
  size(): number;
}

/**
 * Serial queue plus a queued/running id set that closes the double-enqueue
 * window before the worker flips the clip's status, and an eligibility check
 * evaluated at enqueue time.
 */
function createJobQueue(
  db: Db,
  worker: (clipId: number) => Promise<void>,
  eligible: (clip: Clip) => boolean,
): SerialJobQueue {
  const queuedIds = new Set<number>();
  const queue: Queue<number> = createQueue(async (clipId) => {
    try {
      await worker(clipId);
    } finally {
      queuedIds.delete(clipId);
    }
  });
  return {
    enqueueClips(ids: number[]): number {
      let queued = 0;
      for (const id of ids) {
        const clip = db.getClip(id);
        if (!clip || !eligible(clip) || queuedIds.has(id)) continue;
        queuedIds.add(id);
        queue.enqueue(id);
        queued++;
      }
      return queued;
    },
    size: () => queue.size(),
  };
}

export function registerRoutes(
  app: FastifyInstance,
  db: Db,
  worker: (clipId: number) => Promise<void> = (clipId) =>
    transcribeClip(db, clipId),
  renderWorker: (clipId: number) => Promise<void> = (clipId) =>
    renderClip(db, clipId),
): void {
  const transcribeQueue = createJobQueue(
    db,
    worker,
    (clip) => clip.status !== "transcribing",
  );
  // Separate serial queue for renders: both workloads own the GPU while they
  // run, but transcription and rendering jobs should not block each other's
  // queue ordering.
  const renderQueue = createJobQueue(
    db,
    renderWorker,
    (clip) => clip.status === "ready" || clip.status === "done",
  );

  app.get("/api/clips", async () => db.listClips().map(serializeClip));

  app.get("/api/clips/:id", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const clip = db.getClip(params.data.id);
    if (!clip) return reply.code(404).send({ error: "clip not found" });
    return serializeClip(clip);
  });

  const presetParamsSchema = z.object({
    name: z.string().regex(/^[a-zA-Z0-9_:-]{1,64}$/),
  });

  app.get("/api/presets/:name", async (req, reply) => {
    const params = presetParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid name" });
    const json = db.getPreset(params.data.name);
    if (json === undefined) {
      return reply.code(404).send({ error: "preset not found" });
    }
    return { name: params.data.name, value: safeParseJson(json) };
  });

  app.put("/api/presets/:name", async (req, reply) => {
    const params = presetParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid name" });
    if (req.body === undefined || req.body === null) {
      return reply.code(400).send({ error: "missing body" });
    }
    db.setPreset(params.data.name, JSON.stringify(req.body));
    return { name: params.data.name, value: req.body };
  });

  app.post("/api/scan", async () => scanRecordings(db, recordingsDir()));

  // Proxy the whisper container's health so the browser (which cannot reach
  // the compose network) can show CPU-fallback / unreachable warnings.
  app.get("/api/whisper-health", async (_req, reply) => {
    try {
      const res = await fetch(`${WHISPER_API_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`whisper-api ${res.status}`);
      return (await res.json()) as { status: string; device: string };
    } catch {
      return reply.code(502).send({ error: "whisper service unreachable" });
    }
  });

  app.post("/api/clips/:id/transcribe", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    if (!db.getClip(params.data.id)) {
      return reply.code(404).send({ error: "clip not found" });
    }
    return { queued: transcribeQueue.enqueueClips([params.data.id]) };
  });

  app.post("/api/transcribe-batch", async (req, reply) => {
    const body = batchSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.message });
    }
    return { queued: transcribeQueue.enqueueClips(body.data.ids) };
  });

  app.post("/api/clips/:id/render", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    if (!db.getClip(params.data.id)) {
      return reply.code(404).send({ error: "clip not found" });
    }
    return { queued: renderQueue.enqueueClips([params.data.id]) };
  });

  app.post("/api/render-batch", async (req, reply) => {
    const body = batchSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.message });
    }
    return { queued: renderQueue.enqueueClips(body.data.ids) };
  });

  app.get("/api/jobs", async () => ({
    transcribe: { queued: transcribeQueue.size() },
    render: {
      queued: renderQueue.size(),
      progress: Object.fromEntries(renderProgress),
    },
  }));

  app.patch("/api/clips/:id", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const body = patchClipSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.message });
    }
    const clip = db.getClip(params.data.id);
    if (!clip) return reply.code(404).send({ error: "clip not found" });

    const { transcript, settings, status } = body.data;
    db.updateClip(params.data.id, {
      ...(transcript !== undefined && {
        transcript_json: JSON.stringify(transcript),
      }),
      ...(settings !== undefined && { settings_json: JSON.stringify(settings) }),
      ...(status !== undefined && { status }),
    });
    return serializeClip(db.getClip(params.data.id)!);
  });

  app.get("/api/clips/:id/file", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const clip = db.getClip(params.data.id);
    if (!clip) return reply.code(404).send({ error: "clip not found" });

    let size: number;
    try {
      size = statSync(clip.path).size;
    } catch {
      return reply.code(404).send({ error: "file not found" });
    }

    const range = req.headers.range;
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (match && (match[1] !== "" || match[2] !== "")) {
      const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
      const end =
        match[1] !== "" && match[2] !== ""
          ? Math.min(Number(match[2]), size - 1)
          : size - 1;
      if (start >= size || start > end) {
        return reply
          .code(416)
          .header("content-range", `bytes */${size}`)
          .send();
      }
      return reply
        .code(206)
        .header("content-type", "video/mp4")
        .header("accept-ranges", "bytes")
        .header("content-range", `bytes ${start}-${end}/${size}`)
        .header("content-length", end - start + 1)
        .send(createReadStream(clip.path, { start, end }));
    }

    return reply
      .code(200)
      .header("content-type", "video/mp4")
      .header("accept-ranges", "bytes")
      .header("content-length", size)
      .send(createReadStream(clip.path));
  });
}
