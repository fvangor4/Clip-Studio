import { test, expect } from "vitest";
import { createDb } from "./db";

test("upsertClip is idempotent by path", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080, duration: 42.5 });
  db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080, duration: 42.5 });
  expect(db.listClips()).toHaveLength(1);
  expect(db.listClips()[0].status).toBe("new");
});

test("upsertClip updates metadata on existing path", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/a.mp4", width: 1920, height: 1080, duration: 10 });
  db.upsertClip({ path: "/a.mp4", width: 3840, height: 1080, duration: 42.5 });
  const clip = db.listClips()[0];
  expect(clip.width).toBe(3840);
  expect(clip.duration).toBe(42.5);
});

test("getClip returns clip by id, undefined for missing", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/a.mp4", width: 1920, height: 1080, duration: 10 });
  const id = db.listClips()[0].id;
  const clip = db.getClip(id);
  expect(clip?.path).toBe("/a.mp4");
  expect(db.getClip(9999)).toBeUndefined();
});

test("updateClip partial update preserves other fields", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/a.mp4", width: 1920, height: 1080, duration: 10 });
  const id = db.listClips()[0].id;
  db.updateClip(id, { status: "error", error: "boom" });
  db.updateClip(id, { status: "review" });
  const clip = db.getClip(id)!;
  expect(clip.status).toBe("review");
  expect(clip.error).toBe("boom");
  expect(clip.width).toBe(1920);
});

test("upsert of existing path does not reset status", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/a.mp4", width: 1920, height: 1080, duration: 10 });
  const id = db.listClips()[0].id;
  db.updateClip(id, { status: "review" });
  db.upsertClip({ path: "/a.mp4", width: 1920, height: 1080, duration: 10 });
  expect(db.getClip(id)!.status).toBe("review");
  expect(db.listClips()).toHaveLength(1);
});

test("presets: setPreset upserts and getPreset retrieves", () => {
  const db = createDb(":memory:");
  expect(db.getPreset("default")).toBeUndefined();
  db.setPreset("default", '{"styleId":"hormozi"}');
  expect(db.getPreset("default")).toBe('{"styleId":"hormozi"}');
  db.setPreset("default", '{"styleId":"clean"}');
  expect(db.getPreset("default")).toBe('{"styleId":"clean"}');
});
