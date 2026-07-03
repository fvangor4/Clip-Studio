import { expect, test } from "vitest";
import {
  defaultCrops,
  detectLayout,
  gameplayOnlyCrop,
  normalizeSettings,
} from "./settings";

test("detectLayout mirrors server/scan.ts", () => {
  expect(detectLayout(3840, 1080)).toBe("dual");
  expect(detectLayout(1920, 1080)).toBe("single");
  expect(detectLayout(2560, 1440)).toBe("other");
  expect(detectLayout(null, null)).toBe("other");
});

test("defaultCrops matches server defaults for dual layout", () => {
  // top pane 640 → bottom pane 1280 → w = 1080*1080/1280 = 911 → 910 even,
  // centered in the right monitor: 1920 + (1920-910)/2 = 2425.
  expect(defaultCrops(3840, 1080)).toEqual({
    webcamCrop: { x: 420, y: 0, w: 1080, h: 640 },
    gameplayCrop: { x: 2425, y: 0, w: 910, h: 1080 },
  });
});

test("defaultCrops matches server defaults for single layout", () => {
  // top pane 608 → bottom pane 1312 → w = 888 even, centered at 516.
  expect(defaultCrops(1920, 1080)).toEqual({
    webcamCrop: { x: 0, y: 0, w: 480, h: 270 },
    gameplayCrop: { x: 516, y: 0, w: 888, h: 1080 },
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
  expect(s.gameplayCrop).toEqual({ x: 2425, y: 0, w: 910, h: 1080 });
  expect(s.webcamCrop).toEqual({ x: 420, y: 0, w: 1080, h: 640 });
});

test("normalizeSettings keeps stored crops over defaults", () => {
  const stored = { gameplayCrop: { x: 100, y: 0, w: 600, h: 1080 } };
  const s = normalizeSettings(stored, { width: 3840, height: 1080 });
  expect(s.gameplayCrop).toEqual(stored.gameplayCrop);
});

test("normalizeSettings preserves an explicit null webcamCrop (gameplay only)", () => {
  const s = normalizeSettings(
    { webcamCrop: null, gameplayCrop: { x: 2576, y: 0, w: 608, h: 1080 } },
    { width: 3840, height: 1080 },
  );
  expect(s.webcamCrop).toBeNull();
  expect(s.gameplayCrop).toEqual({ x: 2576, y: 0, w: 608, h: 1080 });
});

test("normalizeSettings still fills defaults when webcamCrop is absent", () => {
  const s = normalizeSettings({}, { width: 3840, height: 1080 });
  expect(s.webcamCrop).toEqual({ x: 420, y: 0, w: 1080, h: 640 });
});

test("gameplayOnlyCrop centers a full-height 9:16 crop in the right monitor for dual", () => {
  // 1080 tall -> w = round(1080*9/16) = 608 (even), centered in [1920, 3840)
  expect(gameplayOnlyCrop("dual", 3840, 1080)).toEqual({
    x: 1920 + 656,
    y: 0,
    w: 608,
    h: 1080,
  });
});

test("gameplayOnlyCrop uses the whole frame for single layout", () => {
  expect(gameplayOnlyCrop("single", 1920, 1080)).toEqual({
    x: 656,
    y: 0,
    w: 608,
    h: 1080,
  });
});

test("gameplayOnlyCrop handles other resolutions and null dimensions", () => {
  expect(gameplayOnlyCrop("other", 2560, 1440)).toEqual({
    x: 875,
    y: 0,
    w: 810,
    h: 1440,
  });
  expect(gameplayOnlyCrop("other", null, null)).toEqual({
    x: 656,
    y: 0,
    w: 608,
    h: 1080,
  });
});
