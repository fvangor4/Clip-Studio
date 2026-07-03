import type { CaptionMode } from "../../../shared/captions";
import { OUT_H, OUT_W, topPaneHeight, type CropRect } from "./previewMath";

export type Layout = "dual" | "single" | "other";

/** Classify a clip by resolution, mirroring server/scan.ts detectLayout. */
export function detectLayout(
  width: number | null,
  height: number | null,
): Layout {
  const w = width ?? 0;
  const h = height ?? 0;
  if (h > 0 && w === Math.round((h * 32) / 9)) return "dual";
  if (w === 1920 && h === 1080) return "single";
  return "other";
}

export interface ClipSettings {
  styleId: string;
  mode: CaptionMode;
  captionY: number;
  highlightColor?: string;
  fontSize?: number;
  /** null = intentional gameplay-only (single-pane) composite. */
  webcamCrop?: CropRect | null;
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

/**
 * Default crop rects by source resolution, mirroring server/jobs.ts
 * defaultSettings (dual = 3840x1080 halves, single = 1920x1080 overlay,
 * anything else = centered full-height 9:16, no webcam stack).
 */
/**
 * Full-height gameplay crop whose aspect matches the bottom pane left after
 * the webcam pane (so scaling to fill it does not stretch), centered inside
 * a 1920-wide monitor starting at `monitorX`. Mirrors server/jobs.ts.
 */
function fittedGameplayCrop(webcamCrop: CropRect, monitorX: number): CropRect {
  const bottomH = OUT_H - topPaneHeight(webcamCrop);
  let cw = Math.round((OUT_W * 1080) / bottomH);
  if (cw % 2 !== 0) cw -= 1;
  return { x: monitorX + Math.round((1920 - cw) / 2), y: 0, w: cw, h: 1080 };
}

export function defaultCrops(
  width: number | null,
  height: number | null,
): Pick<ClipSettings, "webcamCrop" | "gameplayCrop"> {
  const w = width ?? 0;
  const h = height ?? 0;
  const layout = detectLayout(w, h);
  if (layout === "dual") {
    const webcamCrop = { x: 420, y: 0, w: 1080, h: 640 };
    return { webcamCrop, gameplayCrop: fittedGameplayCrop(webcamCrop, 1920) };
  }
  if (layout === "single") {
    const webcamCrop = { x: 0, y: 0, w: 480, h: 270 };
    return { webcamCrop, gameplayCrop: fittedGameplayCrop(webcamCrop, 0) };
  }
  const srcW = w || 1920;
  const srcH = h || 1080;
  let cw = Math.min(srcW, Math.round((srcH * 9) / 16));
  if (cw % 2 !== 0) cw -= 1;
  return {
    gameplayCrop: { x: Math.max(0, Math.round((srcW - cw) / 2)), y: 0, w: cw, h: srcH },
  };
}

/**
 * Full-height centered 9:16 crop within the gameplay monitor region, used
 * when the webcam pane is disabled ("gameplay only"): the crop then fills
 * the whole 1080x1920 output. Dual layouts use the right monitor
 * (1920..3840); single/other use the whole frame.
 */
export function gameplayOnlyCrop(
  layout: Layout,
  width: number | null,
  height: number | null,
): CropRect {
  const srcW = width ?? 1920;
  const srcH = height ?? 1080;
  const monitorX = layout === "dual" ? 1920 : 0;
  const monitorW = layout === "dual" ? 1920 : srcW;
  const monitorH = layout === "dual" ? 1080 : srcH;
  let cw = Math.min(monitorW, Math.round((monitorH * 9) / 16));
  if (cw % 2 !== 0) cw -= 1;
  return {
    x: monitorX + Math.max(0, Math.round((monitorW - cw) / 2)),
    y: 0,
    w: cw,
    h: monitorH,
  };
}

/**
 * Fill in defaults matching server/jobs.ts defaultSettings. When the stored
 * settings lack crop rects (e.g. saved while the clip was still transcribing),
 * synthesize them from the clip resolution so the crop controls always work.
 */
export function normalizeSettings(
  raw: Record<string, unknown> | null,
  clip?: { width: number | null; height: number | null },
): ClipSettings {
  const r = raw ?? {};
  const fallback = clip ? defaultCrops(clip.width, clip.height) : {};
  // Explicit null means "gameplay only" — do not re-add the default webcam.
  const webcamCrop =
    r.webcamCrop === null
      ? null
      : (asCrop(r.webcamCrop) ?? fallback.webcamCrop);
  const gameplayCrop = asCrop(r.gameplayCrop) ?? fallback.gameplayCrop;
  return {
    styleId: typeof r.styleId === "string" ? r.styleId : "karaokeHighlight",
    mode: r.mode === "word" ? "word" : "highlight",
    captionY: typeof r.captionY === "number" ? r.captionY : 960,
    ...(typeof r.highlightColor === "string" && {
      highlightColor: r.highlightColor,
    }),
    ...(typeof r.fontSize === "number" && { fontSize: r.fontSize }),
    ...(webcamCrop !== undefined && { webcamCrop }),
    ...(gameplayCrop && { gameplayCrop }),
  };
}
