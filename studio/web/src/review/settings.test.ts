import { expect, test } from "vitest";
import { defaultCrops, normalizeSettings } from "./settings";

test("defaultCrops matches server defaults for dual layout", () => {
  expect(defaultCrops(3840, 1080)).toEqual({
    webcamCrop: { x: 420, y: 0, w: 1080, h: 640 },
    gameplayCrop: { x: 2526, y: 0, w: 608, h: 1080 },
  });
});

test("defaultCrops matches server defaults for single layout", () => {
  expect(defaultCrops(1920, 1080)).toEqual({
    webcamCrop: { x: 0, y: 0, w: 480, h: 270 },
    gameplayCrop: { x: 656, y: 0, w: 608, h: 1080 },
  });
});

test("defaultCrops centers a 9:16 crop for unrecognized layouts", () => {
  expect(defaultCrops(2560, 1440)).toEqual({
    gameplayCrop: { x: 875, y: 0, w: 810, h: 1440 },
  });
});

test("normalizeSettings synthesizes crops from clip resolution when missing", () => {
  const s = normalizeSettings(
    { styleId: "boldPop", mode: "word", captionY: 960 },
    { width: 3840, height: 1080 },
  );
  expect(s.gameplayCrop).toEqual({ x: 2526, y: 0, w: 608, h: 1080 });
  expect(s.webcamCrop).toEqual({ x: 420, y: 0, w: 1080, h: 640 });
});

test("normalizeSettings keeps stored crops over defaults", () => {
  const stored = { gameplayCrop: { x: 100, y: 0, w: 600, h: 1080 } };
  const s = normalizeSettings(stored, { width: 3840, height: 1080 });
  expect(s.gameplayCrop).toEqual(stored.gameplayCrop);
});
