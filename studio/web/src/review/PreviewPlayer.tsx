import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeWordIndex,
  lineForMode,
  type Word,
} from "../../../shared/captions";
import { resolveStyle } from "../../../remotion/styles/registry";
import type { ClipSettings } from "./settings";
import { cropVideoStyle, OUT_H, OUT_W, topPaneHeight } from "./previewMath";

const FPS = 30; // matches remotion/Root.tsx
const DRIFT_TOLERANCE = 0.15;

function formatTime(t: number): string {
  const total = Math.floor(t);
  const tenths = Math.floor((t - total) * 10);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}.${tenths}`;
}

interface PreviewPlayerProps {
  src: string;
  sourceW: number;
  sourceH: number;
  words: Word[];
  settings: ClipSettings;
  /** CSS pixel width of the preview column. */
  previewWidth?: number;
}

/**
 * WYSIWYG 9:16 preview without compositing: a fixed 1080x1920 stage scaled
 * down via CSS transform. The stacked layout is mirrored with two
 * overflow:hidden panes, each showing the crop rect of the source video.
 * Two <video> elements share the same src; the bottom one is muted and
 * drift-corrected against the top one.
 */
export function PreviewPlayer({
  src,
  sourceW,
  sourceH,
  words,
  settings,
  previewWidth = 380,
}: PreviewPlayerProps) {
  const primaryRef = useRef<HTMLVideoElement>(null);
  const secondaryRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Drive caption overlay + time display from the primary video's clock.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const primary = primaryRef.current;
      if (primary) {
        setCurrentTime(primary.currentTime);
        const secondary = secondaryRef.current;
        if (
          secondary &&
          Math.abs(secondary.currentTime - primary.currentTime) >
            DRIFT_TOLERANCE
        ) {
          secondary.currentTime = primary.currentTime;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const togglePlay = () => {
    const primary = primaryRef.current;
    const secondary = secondaryRef.current;
    if (!primary) return;
    if (primary.paused) {
      void primary.play();
      void secondary?.play();
      setPlaying(true);
    } else {
      primary.pause();
      secondary?.pause();
      setPlaying(false);
    }
  };

  const seek = (t: number) => {
    const primary = primaryRef.current;
    if (!primary) return;
    primary.currentTime = t;
    if (secondaryRef.current) secondaryRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const lines = useMemo(
    () => lineForMode(words, settings.mode),
    [words, settings.mode],
  );
  const line = lines.find(
    (l) => l.start <= currentTime && currentTime < l.end,
  );
  const style = resolveStyle(settings.styleId);
  const StyleComponent = style.component;

  const stacked =
    settings.webcamCrop !== undefined && settings.gameplayCrop !== undefined;
  const topH = stacked ? topPaneHeight(settings.webcamCrop!) : 0;
  const scale = previewWidth / OUT_W;

  const videoStyle = (pane: { w: number; h: number }, crop?: {
    x: number;
    y: number;
    w: number;
    h: number;
  }) => {
    if (!crop) return undefined;
    const s = cropVideoStyle(crop, sourceW, sourceH, pane.w, pane.h);
    return {
      position: "absolute" as const,
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
      maxWidth: "none",
    };
  };

  return (
    <div className="preview-player">
      <div
        className="preview-viewport"
        style={{ width: previewWidth, height: OUT_H * scale }}
      >
        <div
          className="preview-stage"
          style={{
            width: OUT_W,
            height: OUT_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {stacked ? (
            <>
              <div
                className="preview-pane"
                style={{ width: OUT_W, height: topH }}
              >
                <video
                  ref={primaryRef}
                  src={src}
                  preload="auto"
                  onLoadedMetadata={(e) =>
                    setDuration(e.currentTarget.duration)
                  }
                  onEnded={() => setPlaying(false)}
                  style={videoStyle(
                    { w: OUT_W, h: topH },
                    settings.webcamCrop,
                  )}
                />
              </div>
              <div
                className="preview-pane"
                style={{ width: OUT_W, height: OUT_H - topH }}
              >
                <video
                  ref={secondaryRef}
                  src={src}
                  preload="auto"
                  muted
                  style={videoStyle(
                    { w: OUT_W, h: OUT_H - topH },
                    settings.gameplayCrop,
                  )}
                />
              </div>
            </>
          ) : settings.gameplayCrop ? (
            // Single-pane layout ("other" resolutions): the gameplay crop
            // fills the whole 1080x1920 frame, no webcam stack.
            <div
              className="preview-pane"
              style={{ width: OUT_W, height: OUT_H }}
            >
              <video
                ref={primaryRef}
                src={src}
                preload="auto"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onEnded={() => setPlaying(false)}
                style={videoStyle(
                  { w: OUT_W, h: OUT_H },
                  settings.gameplayCrop,
                )}
              />
            </div>
          ) : (
            <video
              ref={primaryRef}
              src={src}
              preload="auto"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onEnded={() => setPlaying(false)}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          )}
          {line && (
            <div
              style={{
                position: "absolute",
                top: settings.captionY,
                left: 0,
                right: 0,
                display: "flex",
                justifyContent: "center",
                fontFamily: "Montserrat, system-ui, sans-serif",
                pointerEvents: "none",
              }}
            >
              <StyleComponent
                line={line}
                activeIndex={activeWordIndex(line, currentTime)}
                t={currentTime}
                frame={currentTime * FPS}
                fps={FPS}
                highlightColor={
                  settings.highlightColor ?? style.defaults.highlightColor
                }
                fontSize={settings.fontSize ?? style.defaults.fontSize}
              />
            </div>
          )}
        </div>
      </div>
      <div className="preview-controls">
        <button onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
        />
        <span className="muted preview-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}
