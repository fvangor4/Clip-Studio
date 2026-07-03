import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyleProps } from "./registry";

/**
 * Inner body once frame/fps are known — pure React, safe outside Remotion.
 */
const BoldPopFrame: React.FC<
  CaptionStyleProps & { frame: number; fps: number }
> = ({ line, activeIndex, fontSize = 90, frame, fps }) => {
  const word = line.words[activeIndex];
  if (!word) return null;

  const wordStartFrame = word.start * fps;
  const scale = spring({
    frame: frame - wordStartFrame,
    fps,
    config: { damping: 12 },
  });

  return (
    <div
      style={{
        fontWeight: 800,
        fontSize,
        color: "white",
        WebkitTextStroke: "3px black",
        textShadow:
          "0 0 8px rgba(0,0,0,0.9), 3px 3px 0 black, -3px 3px 0 black, 3px -3px 0 black, -3px -3px 0 black",
        transform: `scale(${scale})`,
        textAlign: "center",
      }}
    >
      {word.text}
    </div>
  );
};

/** Remotion path: reads frame/fps from hooks. */
const BoldPopRemotion: React.FC<CaptionStyleProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return <BoldPopFrame {...props} frame={frame} fps={fps} />;
};

/**
 * Single active word, extra-bold, outlined, spring pop on each word start.
 * Accepts optional `frame`/`fps` props for non-Remotion hosts (web preview);
 * falls back to Remotion hooks when they are omitted.
 */
export const BoldPop: React.FC<CaptionStyleProps> = (props) => {
  if (props.frame !== undefined && props.fps !== undefined) {
    const { frame, fps, ...rest } = props;
    return <BoldPopFrame {...rest} frame={frame} fps={fps} />;
  }
  return <BoldPopRemotion {...props} />;
};
