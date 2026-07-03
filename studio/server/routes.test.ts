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

describe("render routes", () => {
  it("enqueues only ready/done clips, dedupes, and reports queue sizes", async () => {
    db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4" }); // status 'new'
    db.upsertClip({ path: "/media/recordings/b.mp4" });
    db.upsertClip({ path: "/media/recordings/c.mp4" });
    db.updateClip(2, { status: "ready" });
    db.updateClip(3, { status: "done" });

    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const started: number[] = [];
    const app = Fastify();
    registerRoutes(
      app,
      db,
      async () => {},
      async (id) => {
        started.push(id);
        await gate;
      },
    );

    // Clip 1 is 'new': not render-eligible.
    const notReady = await app.inject({ method: "POST", url: "/api/clips/1/render" });
    expect(notReady.json()).toEqual({ queued: 0 });

    const batch = await app.inject({
      method: "POST",
      url: "/api/render-batch",
      payload: { ids: [1, 2, 3] },
    });
    expect(batch.json()).toEqual({ queued: 2 });

    // Re-posting while queued/running is a no-op.
    const dupe = await app.inject({ method: "POST", url: "/api/clips/2/render" });
    expect(dupe.json()).toEqual({ queued: 0 });

    const jobs = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(jobs.json()).toEqual({
      transcribe: { queued: 0 },
      render: { queued: 2, progress: {} },
    });

    release();
    await new Promise((res) => setTimeout(res, 0));
    expect(started).toEqual([2, 3]);
    await app.close();
  });

  it("404s rendering a missing clip", async () => {
    db = createDb(":memory:");
    const app = buildApp(db);
    const res = await app.inject({ method: "POST", url: "/api/clips/99/render" });
    await app.close();
    expect(res.statusCode).toBe(404);
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

describe("GET /api/clips/:id", () => {
  it("returns a single serialized clip", async () => {
    db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4", width: 1920, height: 1080 });
    db.updateClip(1, {
      settings_json: JSON.stringify({ styleId: "boldPop", captionY: 900 }),
    });
    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/clips/1" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({ styleId: "boldPop", captionY: 900 });
    expect(res.json()).not.toHaveProperty("settings_json");
  });

  it("404s for a missing clip", async () => {
    db = createDb(":memory:");
    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/clips/42" });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("presets API", () => {
  it("round-trips a JSON preset", async () => {
    db = createDb(":memory:");
    const app = buildApp(db);
    const put = await app.inject({
      method: "PUT",
      url: "/api/presets/webcamRegion",
      payload: { x: 12, y: 34, w: 480, h: 270 },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/presets/webcamRegion" });
    await app.close();
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({
      name: "webcamRegion",
      value: { x: 12, y: 34, w: 480, h: 270 },
    });
    expect(db.getPreset("webcamRegion")).toBe(
      JSON.stringify({ x: 12, y: 34, w: 480, h: 270 }),
    );
  });

  it("404s an unknown preset", async () => {
    db = createDb(":memory:");
    const app = buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/presets/nope" });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("rejects an invalid preset name", async () => {
    db = createDb(":memory:");
    const app = buildApp(db);
    const res = await app.inject({
      method: "PUT",
      url: "/api/presets/bad%2Fname",
      payload: { x: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
