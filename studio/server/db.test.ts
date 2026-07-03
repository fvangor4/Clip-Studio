import { test, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("upsertClip stores mtime and updates it on conflict", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/a.mp4", width: 1920, height: 1080, duration: 10, mtime: 1000 });
  expect(db.listClips()[0].mtime).toBe(1000);
  db.upsertClip({ path: "/a.mp4", width: 1920, height: 1080, duration: 10, mtime: 2000 });
  expect(db.listClips()[0].mtime).toBe(2000);
});

test("setClipMtime backfills mtime by path", () => {
  const db = createDb(":memory:");
  db.upsertClip({ path: "/a.mp4" });
  expect(db.listClips()[0].mtime).toBeNull();
  db.setClipMtime("/a.mp4", 1234.5);
  expect(db.listClips()[0].mtime).toBe(1234.5);
});

test("createDb migrates a pre-mtime database in place", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "clipdb-"));
  const file = path.join(dir, "old.db");
  try {
    // Simulate an existing studio-data volume created before the mtime column.
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE clips(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        width INTEGER, height INTEGER, duration REAL,
        status TEXT NOT NULL DEFAULT 'new',
        error TEXT,
        transcript_json TEXT,
        settings_json TEXT
      );
    `);
    raw.prepare("INSERT INTO clips(path, width) VALUES (?, ?)").run("/legacy.mp4", 1920);
    raw.close();

    const db = createDb(file);
    const legacy = db.listClips()[0];
    expect(legacy.path).toBe("/legacy.mp4");
    expect(legacy.mtime).toBeNull();
    db.upsertClip({ path: "/new.mp4", mtime: 42 });
    expect(db.listClips().find((c) => c.path === "/new.mp4")?.mtime).toBe(42);
    db.close();

    // Re-opening is idempotent (ALTER must not run twice).
    const again = createDb(file);
    expect(again.listClips()).toHaveLength(2);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("presets: setPreset upserts and getPreset retrieves", () => {
  const db = createDb(":memory:");
  expect(db.getPreset("default")).toBeUndefined();
  db.setPreset("default", '{"styleId":"hormozi"}');
  expect(db.getPreset("default")).toBe('{"styleId":"hormozi"}');
  db.setPreset("default", '{"styleId":"clean"}');
  expect(db.getPreset("default")).toBe('{"styleId":"clean"}');
});
