import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { settingsHash, uniqueOutputPath } from "./render.js";

describe("settingsHash", () => {
  it("is stable across key order", () => {
    const a = {
      styleId: "karaokeHighlight",
      webcamCrop: { x: 1, y: 2, w: 3, h: 4 },
    };
    const b = {
      webcamCrop: { h: 4, w: 3, y: 2, x: 1 },
      styleId: "karaokeHighlight",
    };
    expect(settingsHash(a)).toBe(settingsHash(b));
  });

  it("changes when a crop changes", () => {
    const a = { webcamCrop: { x: 1, y: 2, w: 3, h: 4 } };
    const b = { webcamCrop: { x: 1, y: 2, w: 3, h: 5 } };
    expect(settingsHash(a)).not.toBe(settingsHash(b));
  });

  it("includes the transcript in the hash", () => {
    const s = { styleId: "boldPop" };
    expect(settingsHash(s, '[{"text":"hi"}]')).not.toBe(settingsHash(s, "[]"));
    expect(settingsHash(s, "[]")).toBe(settingsHash(s, "[]"));
  });
});

describe("uniqueOutputPath", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns <base>.mp4 when free", () => {
    dir = mkdtempSync(path.join(tmpdir(), "render-test-"));
    expect(uniqueOutputPath(dir, "clip")).toBe(path.join(dir, "clip.mp4"));
  });

  it("appends (2), (3) on collisions", () => {
    dir = mkdtempSync(path.join(tmpdir(), "render-test-"));
    writeFileSync(path.join(dir, "clip.mp4"), "");
    expect(uniqueOutputPath(dir, "clip")).toBe(path.join(dir, "clip (2).mp4"));
    writeFileSync(path.join(dir, "clip (2).mp4"), "");
    expect(uniqueOutputPath(dir, "clip")).toBe(path.join(dir, "clip (3).mp4"));
  });
});
