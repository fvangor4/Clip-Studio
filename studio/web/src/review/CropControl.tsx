import { useRef } from "react";
import {
  clampCrop,
  resizeCrop,
  type Corner,
  type CropRect,
} from "./previewMath";

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const HANDLE_HIT = 16; // px hit area
const CURSORS: Record<Corner, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

interface CropControlProps {
  label: string;
  src: string;
  sourceW: number;
  sourceH: number;
  crop: CropRect;
  onChange(crop: CropRect): void;
  /** Extra action rendered next to the label (e.g. save-as-preset). */
  action?: React.ReactNode;
  displayWidth?: number;
}

/**
 * Draggable, resizable crop rectangle over a paused, muted frame of the full
 * source video. Dragging the body moves the rect; dragging a corner handle
 * resizes it (opposite corner anchored, free aspect). Constrained to the
 * source bounds with a minimum size. Updates flow up so the PreviewPlayer
 * refreshes live.
 */
export function CropControl({
  label,
  src,
  sourceW,
  sourceH,
  crop,
  onChange,
  action,
  displayWidth = 440,
}: CropControlProps) {
  const scale = displayWidth / sourceW;
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: CropRect;
    corner: Corner | null; // null = move
  } | null>(null);

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    corner: Corner | null,
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: crop,
      corner,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (d.corner) {
      onChange(
        resizeCrop(d.origin, d.corner, dx, dy, { w: sourceW, h: sourceH }),
      );
    } else {
      onChange(
        clampCrop(
          { ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy },
          sourceW,
          sourceH,
        ),
      );
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="crop-control">
      <div className="crop-header">
        <span>{label}</span>
        {action}
      </div>
      <div
        className="crop-frame"
        style={{ width: displayWidth, height: sourceH * scale }}
      >
        <video src={src} muted preload="metadata" width={displayWidth} />
        <div
          className="crop-rect"
          role="slider"
          aria-label={`${label} crop position`}
          style={{
            left: crop.x * scale,
            top: crop.y * scale,
            width: crop.w * scale,
            height: crop.h * scale,
          }}
          onPointerDown={(e) => startDrag(e, null)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {CORNERS.map((corner) => (
            <div
              key={corner}
              className="crop-handle"
              role="slider"
              aria-label={`${label} crop resize ${corner}`}
              style={{
                position: "absolute",
                width: HANDLE_HIT,
                height: HANDLE_HIT,
                cursor: CURSORS[corner],
                ...(corner.includes("w")
                  ? { left: -HANDLE_HIT / 2 }
                  : { right: -HANDLE_HIT / 2 }),
                ...(corner.includes("n")
                  ? { top: -HANDLE_HIT / 2 }
                  : { bottom: -HANDLE_HIT / 2 }),
              }}
              onPointerDown={(e) => startDrag(e, corner)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
