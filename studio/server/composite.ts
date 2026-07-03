import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Clip } from "./db.js";
import { runFFmpeg } from "./ffmpeg.js";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StackCrops {
  webcamCrop: CropRect;
  gameplayCrop: CropRect;
}

const OUT_W = 1080;
const OUT_H = 1920;
const TOP_MIN = 400;
const TOP_MAX = 960;

/**
 * Build the filter_complex that crops the webcam and gameplay regions out of
 * the source and stacks them vertically into a 1080x1920 frame. The webcam is
 * scaled to width 1080 preserving its crop aspect (clamped, forced even); the
 * gameplay fills the remainder exactly (slight stretch acceptable — the user
 * controls the crop rect).
 */
export function buildStackFilter({
  webcamCrop,
  gameplayCrop,
}: StackCrops): string {
  for (const [name, rect] of [
    ["webcamCrop", webcamCrop],
    ["gameplayCrop", gameplayCrop],
  ] as const) {
    if (rect.w <= 0 || rect.h <= 0) {
      throw new Error(
        `${name} must have positive w/h, got ${rect.w}x${rect.h}`,
      );
    }
  }
  let topH = Math.round((OUT_W * webcamCrop.h) / webcamCrop.w);
  topH = Math.min(TOP_MAX, Math.max(TOP_MIN, topH));
  if (topH % 2 !== 0) topH += 1;
  const bottomH = OUT_H - topH;

  const cam = `[0:v]crop=${webcamCrop.w}:${webcamCrop.h}:${webcamCrop.x}:${webcamCrop.y},scale=${OUT_W}:${topH}[cam]`;
  const game = `[0:v]crop=${gameplayCrop.w}:${gameplayCrop.h}:${gameplayCrop.x}:${gameplayCrop.y},scale=${OUT_W}:${bottomH}[game]`;
  return `${cam};${game};[cam][game]vstack=inputs=2[out]`;
}

/** Video encoder; override with ENCODER=libx264 when NVENC is unavailable. */
export const DEFAULT_ENCODER = "h264_nvenc";

export function buildCompositeArgs(
  src: string,
  filter: string,
  out: string,
  encoder: string = process.env.ENCODER || DEFAULT_ENCODER,
): string[] {
  const quality =
    encoder === "libx264"
      ? ["-crf", "21"]
      : ["-preset", "p5", "-cq", "21"];
  return [
    "-y",
    "-i",
    src,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-map",
    // OBS Track 1 is the full mix; Shorts need exactly one audio stream.
    "0:a:0?",
    "-c:v",
    encoder,
    ...quality,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    out,
  ];
}

/**
 * Composite one clip into <workDir>/<clip.id>/base.mp4. `src` is the source
 * path from the caller's point of view (host vs container). Returns the
 * output path.
 */
export async function compositeClip(
  clip: Clip,
  settings: StackCrops,
  workDir: string,
  src: string = clip.path,
): Promise<string> {
  const outDir = path.join(workDir, String(clip.id));
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, "base.mp4");
  const filter = buildStackFilter(settings);
  await runFFmpeg(buildCompositeArgs(src, filter, out));
  return out;
}
