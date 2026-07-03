import { describe, expect, it } from "vitest";
import { clampCrop, cropVideoStyle, topPaneHeight } from "./previewMath";

describe("topPaneHeight", () => {
  it("scales crop aspect to width 1080 and rounds even", () => {
    // 1080x640 crop -> 1080 * 640/1080 = 640
    expect(topPaneHeight({ x: 0, y: 0, w: 1080, h: 640 })).toBe(640);
  });

  it("clamps to minimum 400", () => {
    // 480x270 -> round(1080*270/480) = 608? no: 607.5 -> 608. Use flatter crop.
    expect(topPaneHeight({ x: 0, y: 0, w: 1920, h: 300 })).toBe(400);
  });

  it("clamps to maximum 960", () => {
    expect(topPaneHeight({ x: 0, y: 0, w: 600, h: 1080 })).toBe(960);
  });

  it("forces an even result", () => {
    // round(1080*333/1000) = round(359.64) = 360 (even); pick one that lands odd
    // round(1080*371/1000) = round(400.68) = 401 -> 402
    expect(topPaneHeight({ x: 0, y: 0, w: 1000, h: 371 })).toBe(402);
  });

  it("matches the composite default webcam crop", () => {
    // defaults: 480x270 -> round(1080*270/480) = 607.5 -> 608
    expect(topPaneHeight({ x: 0, y: 0, w: 480, h: 270 })).toBe(608);
  });
});

describe("cropVideoStyle", () => {
  it("positions the source so the pane shows exactly the crop rect", () => {
    const style = cropVideoStyle(
      { x: 420, y: 0, w: 1080, h: 640 },
      3840,
      1080,
      1080,
      640,
    );
    // scaleX = 1, scaleY = 1
    expect(style).toEqual({ left: -420, top: -0, width: 3840, height: 1080 });
  });

  it("stretches x and y independently like ffmpeg crop+scale", () => {
    const style = cropVideoStyle(
      { x: 100, y: 50, w: 608, h: 1080 },
      1920,
      1080,
      1080,
      1312,
    );
    const scaleX = 1080 / 608;
    const scaleY = 1312 / 1080;
    expect(style.left).toBeCloseTo(-100 * scaleX);
    expect(style.top).toBeCloseTo(-50 * scaleY);
    expect(style.width).toBeCloseTo(1920 * scaleX);
    expect(style.height).toBeCloseTo(1080 * scaleY);
  });
});

describe("clampCrop", () => {
  it("keeps an in-bounds rect unchanged", () => {
    expect(clampCrop({ x: 10, y: 20, w: 100, h: 50 }, 1920, 1080)).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 50,
    });
  });

  it("clamps negative positions to zero", () => {
    expect(clampCrop({ x: -5, y: -9, w: 100, h: 50 }, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
  });

  it("clamps to the right/bottom edges", () => {
    expect(clampCrop({ x: 4000, y: 2000, w: 608, h: 1080 }, 3840, 1080)).toEqual(
      { x: 3232, y: 0, w: 608, h: 1080 },
    );
  });

  it("rounds fractional drag positions", () => {
    expect(clampCrop({ x: 10.6, y: 3.2, w: 100, h: 50 }, 1920, 1080)).toEqual({
      x: 11,
      y: 3,
      w: 100,
      h: 50,
    });
  });
});
