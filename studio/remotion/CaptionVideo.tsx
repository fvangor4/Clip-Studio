import { useMemo } from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import {
  activeWordIndex,
  lineForMode,
  type CaptionMode,
  type Word,
} from "../shared/captions";
import { resolveStyle } from "./styles/registry";

const { fontFamily } = loadFont("normal", { weights: ["800"] });

export type CaptionVideoProps = {
  baseVideoSrc: string;
  words: Word[];
  styleId: string;
  mode: CaptionMode;
  captionY: number;
  highlightColor?: string;
  fontSize?: number;
  /** Used by calculateMetadata to size the composition. */
  durationSeconds?: number;
};

export const CaptionVideo: React.FC<CaptionVideoProps> = ({
  baseVideoSrc,
  words,
  styleId,
  mode,
  captionY,
  highlightColor,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines = useMemo(() => lineForMode(words, mode), [words, mode]);

  const t = frame / fps;
  const line = lines.find((l) => l.start <= t && t < l.end);

  const style = resolveStyle(styleId);
  const StyleComponent = style.component;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {baseVideoSrc !== "" && (
        <OffthreadVideo
          src={baseVideoSrc}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {line && (
        <div
          style={{
            position: "absolute",
            top: captionY,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            fontFamily,
          }}
        >
          <StyleComponent
            line={line}
            activeIndex={activeWordIndex(line, t)}
            t={t}
            highlightColor={highlightColor ?? style.defaults.highlightColor}
            fontSize={fontSize ?? style.defaults.fontSize}
          />
        </div>
      )}
    </AbsoluteFill>
  );
};
