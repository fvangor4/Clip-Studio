import type { CaptionMode } from "../../../shared/captions";
import type { CropRect } from "./previewMath";

export interface ClipSettings {
  styleId: string;
  mode: CaptionMode;
  captionY: number;
  highlightColor?: string;
  fontSize?: number;
  webcamCrop?: CropRect;
  gameplayCrop?: CropRect;
}

function asCrop(value: unknown): CropRect | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.w === "number" &&
    typeof r.h === "number"
  ) {
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }
  return undefined;
}

/** Fill in defaults matching server/jobs.ts defaultSettings caption fields. */
export function normalizeSettings(
  raw: Record<string, unknown> | null,
): ClipSettings {
  const r = raw ?? {};
  return {
    styleId: typeof r.styleId === "string" ? r.styleId : "karaokeHighlight",
    mode: r.mode === "word" ? "word" : "highlight",
    captionY: typeof r.captionY === "number" ? r.captionY : 960,
    ...(typeof r.highlightColor === "string" && {
      highlightColor: r.highlightColor,
    }),
    ...(typeof r.fontSize === "number" && { fontSize: r.fontSize }),
    ...(asCrop(r.webcamCrop) && { webcamCrop: asCrop(r.webcamCrop) }),
    ...(asCrop(r.gameplayCrop) && { gameplayCrop: asCrop(r.gameplayCrop) }),
  };
}
