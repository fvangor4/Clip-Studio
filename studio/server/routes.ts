import type { FastifyInstance } from "fastify";
import { createReadStream, statSync } from "node:fs";
import { z } from "zod";
import type { Clip, ClipStatus, Db } from "./db.js";
import { recordingsDir, transcribeClip, createQueue, type Queue } from "./jobs.js";
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

export function registerRoutes(
  app: FastifyInstance,
  db: Db,
  queue: Queue<Clip> = createQueue((clip) => transcribeClip(db, clip)),
): void {
  app.get("/api/clips", async () => db.listClips().map(serializeClip));

  app.post("/api/scan", async () => scanRecordings(db, recordingsDir()));

  function enqueueClips(ids: number[]): number {
    let queued = 0;
    for (const id of ids) {
      const clip = db.getClip(id);
      if (!clip || clip.status === "transcribing") continue;
      queue.enqueue(clip);
      queued++;
    }
    return queued;
  }

  app.post("/api/clips/:id/transcribe", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    if (!db.getClip(params.data.id)) {
      return reply.code(404).send({ error: "clip not found" });
    }
    return { queued: enqueueClips([params.data.id]) };
  });

  app.post("/api/transcribe-batch", async (req, reply) => {
    const body = batchSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.message });
    }
    return { queued: enqueueClips(body.data.ids) };
  });

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
