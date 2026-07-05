export type SortKey = "name" | "date";
export type SortDir = "asc" | "desc";

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

interface SortableClip {
  path: string;
  mtime: number | null;
}

/**
 * Pure sort for the batch table. Name: case-insensitive, numeric-aware on the
 * basename. Date: by mtime; clips without an mtime always sort last regardless
 * of direction.
 */
export function sortClips<T extends SortableClip>(
  clips: T[],
  key: SortKey,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...clips].sort((a, b) => {
    if (key === "name") {
      return (
        sign *
        basename(a.path).localeCompare(basename(b.path), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    }
    if (a.mtime === null && b.mtime === null) return 0;
    if (a.mtime === null) return 1;
    if (b.mtime === null) return -1;
    return sign * (a.mtime - b.mtime);
  });
}
