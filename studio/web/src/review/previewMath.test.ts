import { describe, expect, it } from "vitest";
import {
  clampCrop,
  cropVideoStyle,
  resizeCrop,
  topPaneHeight,
} from "./previewMath";

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

describe("resizeCrop", () => {
  const crop = { x: 100, y: 100, w: 400, h: 300 };
  const bounds = { w: 1920, h: 1080 };

  it("se drag grows width/height, anchoring the nw corner", () => {
    expect(resizeCrop(crop, "se", 50, 20, bounds, 120)).toEqual({
      x: 100,
      y: 100,
      w: 450,
      h: 320,
    });
  });

  it("nw drag moves origin and shrinks size, anchoring the se corner", () => {
    expect(resizeCrop(crop, "nw", 40, -30, bounds, 120)).toEqual({
      x: 140,
      y: 70,
      w: 360,
      h: 330,
    });
  });

  it("ne drag anchors the sw corner", () => {
    expect(resizeCrop(crop, "ne", 60, -20, bounds, 120)).toEqual({
      x: 100,
      y: 80,
      w: 460,
      h: 320,
    });
  });

  it("sw drag anchors the ne corner", () => {
    expect(resizeCrop(crop, "sw", -60, 40, bounds, 120)).toEqual({
      x: 40,
      y: 100,
      w: 460,
      h: 340,
    });
  });

  it("enforces the minimum size against the anchor", () => {
    expect(resizeCrop(crop, "se", -1000, -1000, bounds, 120)).toEqual({
      x: 100,
      y: 100,
      w: 120,
      h: 120,
    });
    expect(resizeCrop(crop, "nw", 1000, 1000, bounds, 120)).toEqual({
      x: 380,
      y: 280,
      w: 120,
      h: 120,
    });
  });

  it("clamps the moving corner to the source bounds", () => {
    expect(resizeCrop(crop, "se", 5000, 5000, bounds, 120)).toEqual({
      x: 100,
      y: 100,
      w: 1820,
      h: 980,
    });
    expect(resizeCrop(crop, "nw", -5000, -5000, bounds, 120)).toEqual({
      x: 0,
      y: 0,
      w: 500,
      h: 400,
    });
  });

  it("rounds fractional deltas to integers", () => {
    expect(resizeCrop(crop, "se", 10.6, 3.2, bounds, 120)).toEqual({
      x: 100,
      y: 100,
      w: 411,
      h: 303,
    });
  });

  it("supports covering the whole left monitor (full facecam)", () => {
    const full = resizeCrop(
      { x: 0, y: 0, w: 1080, h: 640 },
      "se",
      840,
      440,
      { w: 3840, h: 1080 },
      120,
    );
    expect(full).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    // topPaneHeight stays in range for the resulting aspect
    expect(topPaneHeight(full)).toBe(608);
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
