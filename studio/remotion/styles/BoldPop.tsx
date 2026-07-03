import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyleProps } from "./registry";

/** Single active word, extra-bold, outlined, spring pop on each word start. */
export const BoldPop: React.FC<CaptionStyleProps> = ({
  line,
  activeIndex,
  fontSize = 90,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
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
