import type { CaptionStyleProps } from "./registry";

/** Whole line in white; the active word as dark text on a colored pill. */
export const PillHighlight: React.FC<CaptionStyleProps> = ({
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
        alignItems: "center",
        columnGap: "0.35em",
        rowGap: "0.15em",
        maxWidth: 900,
        fontWeight: 800,
        fontSize,
        textAlign: "center",
      }}
    >
      {line.words.map((word, i) => {
        const active = i === activeIndex;
        return (
          <span
            key={`${word.start}-${i}`}
            style={{
              color: active ? "#111111" : "white",
              backgroundColor: active ? highlightColor : "transparent",
              borderRadius: 16,
              padding: "4px 14px",
              transform: active ? "scale(1.06)" : "scale(1)",
              display: "inline-block",
              textShadow: active
                ? "none"
                : "0 2px 12px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.9)",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
