export interface Word {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface CaptionLine {
  start: number;
  end: number;
  words: Word[];
}

export interface ChunkOptions {
  maxWords: number;
  /** Break a line when the silence between two words exceeds this (seconds). Default 1.2. */
  gapBreak?: number;
}

export type CaptionMode = "word" | "highlight";

const DEFAULT_GAP_BREAK = 1.2;

/**
 * Group words into caption lines. A line breaks when it reaches `maxWords`
 * or when the gap between the previous word's end and the next word's start
 * exceeds `gapBreak`. Line end extends to the next line's start only when
 * the gap between lines is <= gapBreak (prevents flicker between contiguous
 * lines while keeping silence gaps caption-free).
 */
export function chunkWords(words: Word[], opts: ChunkOptions): CaptionLine[] {
  const gapBreak = opts.gapBreak ?? DEFAULT_GAP_BREAK;
  const maxWords = Math.max(1, opts.maxWords);

  const lines: CaptionLine[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0) {
      const gap = word.start - current[current.length - 1].end;
      if (current.length >= maxWords || gap > gapBreak) flush();
    }
    current.push(word);
  }
  flush();

  // Extend each line's end to the next line's start when contiguous.
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i + 1].start - lines[i].end;
    if (gap > 0 && gap <= gapBreak) lines[i].end = lines[i + 1].start;
  }

  return lines;
}

/**
 * Index of the word being spoken at time `t` within a line. Between words,
 * returns the most recently started word; clamps to first/last word.
 */
export function activeWordIndex(line: CaptionLine, t: number): number {
  const { words } = line;
  let index = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= t) index = i;
    else break;
  }
  return index;
}

export function lineForMode(words: Word[], mode: CaptionMode): CaptionLine[] {
  return chunkWords(words, { maxWords: mode === "word" ? 1 : 5 });
}
