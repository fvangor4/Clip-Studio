import type { CaptionStyleProps } from "./registry";

/** Whole line in white; the active word tinted and slightly scaled. */
export const KaraokeHighlight: React.FC<CaptionStyleProps> = ({
  line,
  activeIndex,
  highlightColor = "#FFE600",
  fontSize = 64,
}) => {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: "0.35em",
        rowGap: "0.1em",
        maxWidth: 900,
        fontWeight: 800,
        fontSize,
        textShadow: "0 2px 12px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.9)",
        textAlign: "center",
      }}
    >
      {line.words.map((word, i) => {
        const active = i === activeIndex;
        return (
          <span
            key={`${word.start}-${i}`}
            style={{
              color: active ? highlightColor : "white",
              transform: active ? "scale(1.12)" : "scale(1)",
              display: "inline-block",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
