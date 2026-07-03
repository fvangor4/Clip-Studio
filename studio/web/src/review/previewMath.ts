export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const OUT_W = 1080;
export const OUT_H = 1920;
const TOP_MIN = 400;
const TOP_MAX = 960;

/**
 * Height (in 1080x1920 canvas px) of the top (webcam) pane. Mirrors
 * server/composite.ts buildStackFilter: scale crop aspect to width 1080,
 * clamp to [400, 960], force even.
 */
export function topPaneHeight(webcamCrop: CropRect): number {
  let topH = Math.round((OUT_W * webcamCrop.h) / webcamCrop.w);
  topH = Math.min(TOP_MAX, Math.max(TOP_MIN, topH));
  if (topH % 2 !== 0) topH += 1;
  return topH;
}

export interface CropVideoStyle {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Position/size (in pane-local px) for a source-video element inside an
 * overflow:hidden pane of paneW x paneH, so the pane shows exactly `crop`
 * of the source. FFmpeg's crop+scale stretches x and y independently, so
 * we do too.
 */
export function cropVideoStyle(
  crop: CropRect,
  sourceW: number,
  sourceH: number,
  paneW: number,
  paneH: number,
): CropVideoStyle {
  const scaleX = paneW / crop.w;
  const scaleY = paneH / crop.h;
  return {
    left: -crop.x * scaleX,
    top: -crop.y * scaleY,
    width: sourceW * scaleX,
    height: sourceH * scaleY,
  };
}

export type Corner = "nw" | "ne" | "sw" | "se";

/**
 * Resize a crop by dragging one corner by (dx, dy) in source-space px. The
 * opposite corner stays anchored; the moving corner is clamped to the source
 * bounds and kept at least `minSize` away from the anchor on each axis.
 * Results are rounded to integers.
 */
export function resizeCrop(
  crop: CropRect,
  corner: Corner,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
  minSize = 120,
): CropRect {
  const left = crop.x;
  const top = crop.y;
  const right = crop.x + crop.w;
  const bottom = crop.y + crop.h;
  const movesLeft = corner === "nw" || corner === "sw";
  const movesTop = corner === "nw" || corner === "ne";

  let x0 = left;
  let x1 = right;
  let y0 = top;
  let y1 = bottom;
  if (movesLeft) {
    x0 = Math.min(Math.max(0, left + dx), right - minSize);
  } else {
    x1 = Math.max(Math.min(bounds.w, right + dx), left + minSize);
  }
  if (movesTop) {
    y0 = Math.min(Math.max(0, top + dy), bottom - minSize);
  } else {
    y1 = Math.max(Math.min(bounds.h, bottom + dy), top + minSize);
  }
  x0 = Math.round(x0);
  x1 = Math.round(x1);
  y0 = Math.round(y0);
  y1 = Math.round(y1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Clamp a crop rect's position inside the source bounds (size unchanged). */
export function clampCrop(
  crop: CropRect,
  sourceW: number,
  sourceH: number,
): CropRect {
  return {
    ...crop,
    x: Math.round(Math.min(Math.max(0, crop.x), Math.max(0, sourceW - crop.w))),
    y: Math.round(Math.min(Math.max(0, crop.y), Math.max(0, sourceH - crop.h))),
  };
}
