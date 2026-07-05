import { describe, it, expect } from "vitest";
import { sortClips } from "./sortClips";

const clip = (path: string, mtime: number | null) => ({ path, mtime });

describe("sortClips", () => {
  it("sorts by name numeric-aware and case-insensitive on basename", () => {
    const clips = [
      clip("/rec/Clip 10.mp4", 1),
      clip("/rec/clip 2.mp4", 2),
      clip("/zzz/Alpha.mp4", 3),
      clip("/aaa/beta.mp4", 4),
    ];
    expect(sortClips(clips, "name", "asc").map((c) => c.path)).toEqual([
      "/zzz/Alpha.mp4",
      "/aaa/beta.mp4",
      "/rec/clip 2.mp4",
      "/rec/Clip 10.mp4",
    ]);
  });

  it("name desc reverses the order", () => {
    const clips = [clip("/a.mp4", null), clip("/b.mp4", null)];
    expect(sortClips(clips, "name", "desc").map((c) => c.path)).toEqual([
      "/b.mp4",
      "/a.mp4",
    ]);
  });

  it("sorts by date desc, newest first", () => {
    const clips = [clip("/old.mp4", 100), clip("/new.mp4", 300), clip("/mid.mp4", 200)];
    expect(sortClips(clips, "date", "desc").map((c) => c.path)).toEqual([
      "/new.mp4",
      "/mid.mp4",
      "/old.mp4",
    ]);
  });

  it("date asc, oldest first", () => {
    const clips = [clip("/b.mp4", 2), clip("/a.mp4", 1)];
    expect(sortClips(clips, "date", "asc").map((c) => c.path)).toEqual([
      "/a.mp4",
      "/b.mp4",
    ]);
  });

  it("null mtimes sort last in both directions", () => {
    const clips = [clip("/none.mp4", null), clip("/x.mp4", 5), clip("/y.mp4", 9)];
    expect(sortClips(clips, "date", "desc").map((c) => c.path)).toEqual([
      "/y.mp4",
      "/x.mp4",
      "/none.mp4",
    ]);
    expect(sortClips(clips, "date", "asc").map((c) => c.path)).toEqual([
      "/x.mp4",
      "/y.mp4",
      "/none.mp4",
    ]);
  });

  it("does not mutate the input array", () => {
    const clips = [clip("/b.mp4", 2), clip("/a.mp4", 1)];
    const copy = [...clips];
    sortClips(clips, "name", "asc");
    expect(clips).toEqual(copy);
  });
});
