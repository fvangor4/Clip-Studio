import { spawn } from "node:child_process";

const STDERR_TAIL_CHARS = 2000;

function run(
  bin: string,
  args: string[],
  captureStdout: boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    if (captureStdout) {
      child.stdout.on("data", (d) => (stdout += d));
    } else {
      child.stdout.resume();
    }
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      reject(new Error(`Failed to start ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const tail = stderr.slice(-STDERR_TAIL_CHARS).trim();
        reject(new Error(`${bin} exited with code ${code}: ${tail}`));
      }
    });
  });
}

export async function runFFmpeg(args: string[]): Promise<void> {
  await run(process.env.FFMPEG_PATH || "ffmpeg", args, false);
}

export function runFFprobe(args: string[]): Promise<string> {
  return run(process.env.FFPROBE_PATH || "ffprobe", args, true);
}

export interface ProbeResult {
  width: number;
  height: number;
  duration: number;
}

interface FFprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

interface FFprobeOutput {
  streams?: FFprobeStream[];
  format?: { duration?: string };
}

export function parseProbe(json: string): ProbeResult {
  const data = JSON.parse(json) as FFprobeOutput;
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video) {
    throw new Error("ffprobe output contains no video stream");
  }
  if (typeof video.width !== "number" || typeof video.height !== "number") {
    throw new Error("video stream is missing width/height");
  }
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration)) {
    throw new Error("ffprobe output has no valid format.duration");
  }
  return { width: video.width, height: video.height, duration };
}

export async function probeFile(path: string): Promise<ProbeResult> {
  const out = await runFFprobe([
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    path,
  ]);
  return parseProbe(out);
}
