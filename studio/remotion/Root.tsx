import { Composition, type CalculateMetadataFunction } from "remotion";
import { CaptionVideo, type CaptionVideoProps } from "./CaptionVideo";
import type { Word } from "../shared/captions";
import fixtureWords from "./fixtures/lines.json";

const FPS = 30;

const calculateMetadata: CalculateMetadataFunction<CaptionVideoProps> = ({
  props,
}) => {
  if (props.durationSeconds && props.durationSeconds > 0) {
    return { durationInFrames: Math.ceil(props.durationSeconds * FPS) };
  }
  return {};
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="CaptionVideo"
      component={CaptionVideo}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={900}
      calculateMetadata={calculateMetadata}
      defaultProps={{
        baseVideoSrc: "",
        words: fixtureWords as Word[],
        styleId: "karaokeHighlight",
        mode: "highlight" as const,
        captionY: 960,
      }}
    />
  );
};
