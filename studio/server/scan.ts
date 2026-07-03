import { readdir } from "node:fs/promises";
import path from "node:path";
import { probeFile } from "./ffmpeg.js";
import type { Db } from "./db.js";

export type Layout = "dual" | "single" | "other";

/** Classify a recording by resolution: 32:9 dual-monitor, 16:9 1080p single, or other. */
export function detectLayout(width: number, height: number): Layout {
  if (height > 0 && width === (height * 32) / 9) return "dual";
  if (width === 1920 && height === 1080) return "single";
  return "other";
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".mov"]);

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (
      entry.isFile() &&
      VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      out.push(full);
    }
  }
}

export interface ScanResult {
  added: number;
  total: number;
  errors: { path: string; message: string }[];
}

export async function scanRecordings(db: Db, dir: string): Promise<ScanResult> {
  const files: string[] = [];
  await walk(path.resolve(dir), files);

  const known = new Set(db.listClips().map((c) => c.path));
  const errors: ScanResult["errors"] = [];
  let added = 0;

  for (const file of files) {
    if (known.has(file)) continue;
    try {
      const { width, height, duration } = await probeFile(file);
      db.upsertClip({ path: file, width, height, duration });
      added++;
    } catch (err) {
      errors.push({
        path: file,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { added, total: files.length, errors };
}
