import { describe, expect, test } from "vitest";
import { buildCompositeArgs, buildStackFilter } from "./composite.js";

describe("buildStackFilter", () => {
  test("crops both regions and stacks to 1080x1920", () => {
    const f = buildStackFilter({
      webcamCrop: { x: 420, y: 0, w: 1080, h: 700 },
      gameplayCrop: { x: 2340, y: 0, w: 686, h: 1080 },
    });
    expect(f).toContain("crop=1080:700:420:0");
    expect(f).toContain("crop=686:1080:2340:0");
    expect(f).toContain("scale=1080:1220");
    expect(f).toContain("vstack");
  });

  test("topH is always even", () => {
    // 1080 * 333 / 720 = 499.5 -> rounds to 499/500; must be even -> 500
    const f = buildStackFilter({
      webcamCrop: { x: 0, y: 0, w: 720, h: 333 },
      gameplayCrop: { x: 0, y: 0, w: 608, h: 1080 },
    });
    const m = /scale=1080:(\d+)\[cam\]/.exec(f);
    expect(m).not.toBeNull();
    const topH = Number(m![1]);
    expect(topH % 2).toBe(0);
    const g = /scale=1080:(\d+)\[game\]/.exec(f);
    expect(Number(g![1])).toBe(1920 - topH);
  });

  test("topH is clamped to min 400", () => {
    const f = buildStackFilter({
      webcamCrop: { x: 0, y: 0, w: 1080, h: 100 },
      gameplayCrop: { x: 0, y: 0, w: 608, h: 1080 },
    });
    expect(f).toContain("scale=1080:400[cam]");
    expect(f).toContain("scale=1080:1520[game]");
  });

  test("topH is clamped to max 960", () => {
    const f = buildStackFilter({
      webcamCrop: { x: 0, y: 0, w: 500, h: 1000 },
      gameplayCrop: { x: 0, y: 0, w: 608, h: 1080 },
    });
    expect(f).toContain("scale=1080:960[cam]");
    expect(f).toContain("scale=1080:960[game]");
  });

  test("output is labeled [out]", () => {
    const f = buildStackFilter({
      webcamCrop: { x: 420, y: 0, w: 1080, h: 640 },
      gameplayCrop: { x: 2526, y: 0, w: 608, h: 1080 },
    });
    expect(f.endsWith("[out]")).toBe(true);
    expect(f).toContain("vstack=inputs=2[out]");
  });
});

describe("buildCompositeArgs", () => {
  const filter = "dummy[out]";

  test("nvenc uses -cq", () => {
    const args = buildCompositeArgs("in.mp4", filter, "out.mp4", "h264_nvenc");
    expect(args).toEqual([
      "-y",
      "-i",
      "in.mp4",
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-map",
      "0:a?",
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p5",
      "-cq",
      "21",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "out.mp4",
    ]);
  });

  test("libx264 uses -crf and no nvenc preset", () => {
    const args = buildCompositeArgs("in.mp4", filter, "out.mp4", "libx264");
    expect(args).toContain("libx264");
    expect(args).toContain("-crf");
    expect(args).not.toContain("-cq");
    expect(args).not.toContain("p5");
  });
});
