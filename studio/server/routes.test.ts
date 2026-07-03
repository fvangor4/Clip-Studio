import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./db.js";
import { buildApp } from "./index.js";
import { registerRoutes } from "./routes.js";

let db: Db;
afterEach(() => db?.close());

describe("GET /api/clips", () => {
  it("returns clips with transcript/settings parsed into objects", async () => {
    db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080, duration: 12 });
    db.updateClip(1, {
      status: "review",
      transcript_json: JSON.stringify([{ text: "hi", start: 0, end: 0.5, confidence: 0.9 }]),
      settings_json: JSON.stringify({ styleId: "karaokeHighlight", captionY: 960 }),
    });

    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/clips" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const clips = res.json();
    expect(clips).toHaveLength(1);
    expect(clips[0].status).toBe("review");
    expect(clips[0].transcript).toEqual([
      { text: "hi", start: 0, end: 0.5, confidence: 0.9 },
    ]);
    expect(clips[0].settings).toEqual({ styleId: "karaokeHighlight", captionY: 960 });
    expect(clips[0]).not.toHaveProperty("transcript_json");
  });
});

describe("POST /api/clips/:id/transcribe", () => {
  it("does not double-enqueue a clip that is queued but not yet started", async () => {
    db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4" });
    db.upsertClip({ path: "/media/recordings/b.mp4" });

    // Blocking worker: jobs pile up in the queue and never start clip 2.
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const started: number[] = [];
    const app = Fastify();
    registerRoutes(app, db, async (id) => {
      started.push(id);
      await gate;
    });

    const first = await app.inject({ method: "POST", url: "/api/clips/1/transcribe" });
    expect(first.json()).toEqual({ queued: 1 });

    // Clip 2 queues behind clip 1 and stays pending (worker blocked on 1).
    const second = await app.inject({ method: "POST", url: "/api/clips/2/transcribe" });
    expect(second.json()).toEqual({ queued: 1 });

    // Re-posting clip 2 (still pending, status still 'new') must be a no-op.
    const dupe = await app.inject({ method: "POST", url: "/api/clips/2/transcribe" });
    expect(dupe.json()).toEqual({ queued: 0 });

    const batchDupe = await app.inject({
      method: "POST",
      url: "/api/transcribe-batch",
      payload: { ids: [1, 2] },
    });
    expect(batchDupe.json()).toEqual({ queued: 0 });

    release();
    await new Promise((res) => setTimeout(res, 0));
    expect(started).toEqual([1, 2]);
    await app.close();
  });
});

describe("PATCH /api/clips/:id", () => {
  it("rejects an invalid status value", async () => {
    db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4" });
    const app = buildApp(db);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/clips/1",
      payload: { status: "bogus" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404s for a missing clip", async () => {
    db = createDb(":memory:");
    const app = buildApp(db);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/clips/99",
      payload: { status: "ready" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
