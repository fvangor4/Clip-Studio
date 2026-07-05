import { describe, it, expect } from "vitest";
import { detectLayout } from "./scan.js";
import { parseProbe } from "./ffmpeg.js";

describe("detectLayout", () => {
  it("detects dual-monitor 32:9", () => {
    expect(detectLayout(3840, 1080)).toBe("dual");
  });

  it("detects single 16:9 1080p", () => {
    expect(detectLayout(1920, 1080)).toBe("single");
  });

  it("returns other for anything else", () => {
    expect(detectLayout(2560, 1440)).toBe("other");
    expect(detectLayout(1080, 1920)).toBe("other");
    expect(detectLayout(1440, 1080)).toBe("other");
  });
});

const FIXTURE = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_name: "aac",
      codec_type: "audio",
      sample_rate: "48000",
    },
    {
      index: 1,
      codec_name: "h264",
      codec_type: "video",
      width: 3840,
      height: 1080,
      r_frame_rate: "60/1",
    },
  ],
  format: {
    filename: "clip.mp4",
    duration: "123.456000",
    size: "104857600",
  },
});

describe("parseProbe", () => {
  it("extracts width/height from first video stream and duration from format", () => {
    expect(parseProbe(FIXTURE)).toEqual({
      width: 3840,
      height: 1080,
      duration: 123.456,
    });
  });

  it("throws a clear error when no video stream exists", () => {
    const noVideo = JSON.stringify({
      streams: [{ index: 0, codec_type: "audio" }],
      format: { duration: "10.0" },
    });
    expect(() => parseProbe(noVideo)).toThrow(/no video stream/i);
  });
});
