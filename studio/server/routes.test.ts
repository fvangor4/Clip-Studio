import { afterEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./db.js";
import { buildApp } from "./index.js";

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
