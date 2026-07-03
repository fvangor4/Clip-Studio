import type { CaptionLine, CaptionMode } from "../../shared/captions";
import { BoldPop } from "./BoldPop";
import { KaraokeHighlight } from "./KaraokeHighlight";
import { PillHighlight } from "./PillHighlight";

export interface CaptionStyleProps {
  line: CaptionLine;
  activeIndex: number;
  /** Current time in seconds. */
  t: number;
  highlightColor?: string;
  fontSize?: number;
}

export interface CaptionStyle {
  id: string;
  name: string;
  component: React.FC<CaptionStyleProps>;
  defaults: { fontSize: number; highlightColor?: string };
  supportsModes: readonly CaptionMode[];
}

export const styleRegistry = {
  boldPop: {
    id: "boldPop",
    name: "Bold Pop",
    component: BoldPop,
    defaults: { fontSize: 90 },
    supportsModes: ["word"],
  },
  karaokeHighlight: {
    id: "karaokeHighlight",
    name: "Karaoke Highlight",
    component: KaraokeHighlight,
    defaults: { fontSize: 64, highlightColor: "#FFE600" },
    supportsModes: ["highlight", "word"],
  },
  pillHighlight: {
    id: "pillHighlight",
    name: "Pill Highlight",
    component: PillHighlight,
    defaults: { fontSize: 64, highlightColor: "#FFE600" },
    supportsModes: ["highlight"],
  },
} as const satisfies Record<string, CaptionStyle>;

export type StyleId = keyof typeof styleRegistry;

export function resolveStyle(styleId: string): CaptionStyle {
  return (
    (styleRegistry as Record<string, CaptionStyle>)[styleId] ??
    styleRegistry.karaokeHighlight
  );
}
