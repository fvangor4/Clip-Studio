import { test, expect } from "vitest";
import { chunkWords, activeWordIndex, lineForMode } from "./captions";

const w = (text: string, start: number, end: number) => ({ text, start, end, confidence: 1 });

test("chunks into lines of max 5 words", () => {
  const words = "one two three four five six seven".split(" ").map((t, i) => w(t, i, i + 1));
  const lines = chunkWords(words, { maxWords: 5 });
  expect(lines.map(l => l.words.length)).toEqual([5, 2]);
  expect(lines[0].start).toBe(0);
  expect(lines[0].end).toBe(5);
});

test("breaks line early on gap > 1.2s (sentence pause)", () => {
  const words = [w("hey", 0, 0.3), w("wow", 2.0, 2.4), w("ok", 2.4, 2.8)];
  const lines = chunkWords(words, { maxWords: 5 });
  expect(lines.map(l => l.words.map(x => x.text))).toEqual([["hey"], ["wow", "ok"]]);
});

test("line end extends to next line start (no caption flicker)", () => {
  const words = [w("a", 0, 0.5), ...Array.from({length: 5}, (_, i) => w("x", 1 + i, 1.2 + i))];
  const lines = chunkWords(words, { maxWords: 5 });
  expect(lines[0].end).toBe(lines[1].start);
});

test("activeWordIndex returns spoken word at time t", () => {
  const line = { start: 0, end: 3, words: [w("a", 0, 1), w("b", 1, 2), w("c", 2, 3)] };
  expect(activeWordIndex(line, 1.5)).toBe(1);
  expect(activeWordIndex(line, 0)).toBe(0);
  expect(activeWordIndex(line, 2.99)).toBe(2);
});

test("empty input returns empty array", () => {
  expect(chunkWords([], { maxWords: 5 })).toEqual([]);
});

test("maxWords 1 produces one word per line", () => {
  const words = [w("a", 0, 1), w("b", 1, 2), w("c", 2, 3)];
  const lines = chunkWords(words, { maxWords: 1 });
  expect(lines.map(l => l.words.map(x => x.text))).toEqual([["a"], ["b"], ["c"]]);
});

test("gap break does not extend previous line end across the gap", () => {
  const words = [w("hey", 0, 0.3), w("wow", 2.0, 2.4)];
  const lines = chunkWords(words, { maxWords: 5 });
  expect(lines[0].end).toBe(0.3);
  expect(lines[1].start).toBe(2.0);
});

test("activeWordIndex clamps before start and at/after end", () => {
  const line = { start: 1, end: 3, words: [w("a", 1, 2), w("b", 2, 3)] };
  expect(activeWordIndex(line, 0)).toBe(0);
  expect(activeWordIndex(line, 3)).toBe(1);
  expect(activeWordIndex(line, 10)).toBe(1);
});

test("activeWordIndex returns most recent started word between words", () => {
  const line = { start: 0, end: 4, words: [w("a", 0, 1), w("b", 3, 4)] };
  expect(activeWordIndex(line, 2)).toBe(0);
});

test("lineForMode: word mode is one word per line, highlight mode is 5", () => {
  const words = "one two three four five six".split(" ").map((t, i) => w(t, i, i + 1));
  expect(lineForMode(words, "word").map(l => l.words.length)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(lineForMode(words, "highlight").map(l => l.words.length)).toEqual([5, 1]);
});

test("custom gapBreak option is respected", () => {
  const words = [w("a", 0, 0.5), w("b", 1.2, 1.5)]; // gap 0.7
  expect(chunkWords(words, { maxWords: 5, gapBreak: 0.5 }).length).toBe(2);
  expect(chunkWords(words, { maxWords: 5, gapBreak: 1.0 }).length).toBe(1);
});
