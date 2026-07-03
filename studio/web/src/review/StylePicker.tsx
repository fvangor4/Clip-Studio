import type { CaptionMode } from "../../../shared/captions";
import {
  styleRegistry,
  type CaptionStyle,
} from "../../../remotion/styles/registry";
import type { ClipSettings } from "./settings";

interface StylePickerProps {
  settings: ClipSettings;
  onChange(patch: Partial<ClipSettings>): void;
}

/** Static, non-animated approximation of each style for the picker card. */
function miniPreview(styleId: string, highlightColor: string) {
  const base: React.CSSProperties = {
    fontWeight: 800,
    fontFamily: "Montserrat, system-ui, sans-serif",
    fontSize: 14,
    display: "flex",
    gap: 5,
    justifyContent: "center",
    alignItems: "center",
  };
  if (styleId === "boldPop") {
    return (
      <div style={{ ...base, fontSize: 18, color: "white", textShadow: "1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black" }}>
        POP
      </div>
    );
  }
  if (styleId === "pillHighlight") {
    return (
      <div style={base}>
        <span style={{ color: "white" }}>one</span>
        <span style={{ color: "#111", background: highlightColor, borderRadius: 6, padding: "1px 6px" }}>
          two
        </span>
        <span style={{ color: "white" }}>three</span>
      </div>
    );
  }
  return (
    <div style={base}>
      <span style={{ color: "white" }}>one</span>
      <span style={{ color: highlightColor }}>two</span>
      <span style={{ color: "white" }}>three</span>
    </div>
  );
}

export function StylePicker({ settings, onChange }: StylePickerProps) {
  const styles = Object.values(styleRegistry) as CaptionStyle[];
  const current =
    styles.find((s) => s.id === settings.styleId) ?? styleRegistry.karaokeHighlight;
  const highlightColor =
    settings.highlightColor ?? current.defaults.highlightColor ?? "#FFE600";

  const selectStyle = (id: string) => {
    const style = styles.find((s) => s.id === id)!;
    const patch: Partial<ClipSettings> = { styleId: id };
    if (!style.supportsModes.includes(settings.mode)) {
      patch.mode = style.supportsModes[0];
    }
    onChange(patch);
  };

  return (
    <div className="style-picker">
      <div className="style-cards">
        {styles.map((s) => (
          <button
            key={s.id}
            className={`style-card${s.id === settings.styleId ? " style-card-active" : ""}`}
            onClick={() => selectStyle(s.id)}
          >
            {miniPreview(s.id, highlightColor)}
            <span className="style-card-name">{s.name}</span>
          </button>
        ))}
      </div>
      <div className="style-options">
        <label>
          Mode{" "}
          <select
            value={settings.mode}
            onChange={(e) => onChange({ mode: e.target.value as CaptionMode })}
          >
            {current.supportsModes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Highlight{" "}
          <input
            type="color"
            value={highlightColor}
            onChange={(e) => onChange({ highlightColor: e.target.value })}
          />
        </label>
        <label>
          Font size{" "}
          <input
            type="number"
            min={24}
            max={160}
            value={settings.fontSize ?? current.defaults.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="caption-y">
          Caption Y{" "}
          <input
            type="range"
            min={0}
            max={1920}
            step={10}
            value={settings.captionY}
            onChange={(e) => onChange({ captionY: Number(e.target.value) })}
          />
          <span className="muted">{settings.captionY}</span>
        </label>
      </div>
    </div>
  );
}
