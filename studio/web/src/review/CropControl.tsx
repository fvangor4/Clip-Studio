import { useRef } from "react";
import { clampCrop, type CropRect } from "./previewMath";

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
 * Draggable crop rectangle over a paused, muted frame of the full source
 * video. Drag moves the rect's position (size fixed); constrained to the
 * source bounds. Updates flow up so the PreviewPlayer refreshes live.
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
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: crop,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    onChange(
      clampCrop(
        { ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy },
        sourceW,
        sourceH,
      ),
    );
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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    </div>
  );
}
