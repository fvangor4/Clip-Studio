import Database from "better-sqlite3";

export type ClipStatus =
  | "new"
  | "transcribing"
  | "review"
  | "no_speech"
  | "ready"
  | "rendering"
  | "done"
  | "error";

export interface Clip {
  id: number;
  path: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: ClipStatus;
  error: string | null;
  transcript_json: string | null;
  settings_json: string | null;
}

export interface UpsertClipInput {
  path: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

export type UpdateClipFields = Partial<
  Pick<Clip, "status" | "error" | "transcript_json" | "settings_json">
>;

const UPDATABLE_FIELDS = ["status", "error", "transcript_json", "settings_json"] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clips(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  width INTEGER, height INTEGER, duration REAL,
  status TEXT NOT NULL DEFAULT 'new',
  error TEXT,
  transcript_json TEXT,
  settings_json TEXT
);
CREATE TABLE IF NOT EXISTS presets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  json TEXT NOT NULL
);
`;

export function createDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const upsertStmt = db.prepare(`
    INSERT INTO clips(path, width, height, duration) VALUES (@path, @width, @height, @duration)
    ON CONFLICT(path) DO UPDATE SET
      width = excluded.width,
      height = excluded.height,
      duration = excluded.duration
  `);
  const listStmt = db.prepare("SELECT * FROM clips ORDER BY id");
  const getStmt = db.prepare("SELECT * FROM clips WHERE id = ?");
  const getPresetStmt = db.prepare("SELECT json FROM presets WHERE name = ?");
  const setPresetStmt = db.prepare(`
    INSERT INTO presets(name, json) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json
  `);

  return {
    upsertClip(input: UpsertClipInput): void {
      upsertStmt.run({
        path: input.path,
        width: input.width ?? null,
        height: input.height ?? null,
        duration: input.duration ?? null,
      });
    },

    listClips(): Clip[] {
      return listStmt.all() as Clip[];
    },

    getClip(id: number): Clip | undefined {
      return getStmt.get(id) as Clip | undefined;
    },

    updateClip(id: number, fields: UpdateClipFields): void {
      const keys = UPDATABLE_FIELDS.filter((k) => fields[k] !== undefined);
      if (keys.length === 0) return;
      const setClause = keys.map((k) => `${k} = @${k}`).join(", ");
      const params: Record<string, unknown> = { id };
      for (const k of keys) params[k] = fields[k];
      db.prepare(`UPDATE clips SET ${setClause} WHERE id = @id`).run(params);
    },

    getPreset(name: string): string | undefined {
      const row = getPresetStmt.get(name) as { json: string } | undefined;
      return row?.json;
    },

    setPreset(name: string, json: string): void {
      setPresetStmt.run(name, json);
    },

    close(): void {
      db.close();
    },
  };
}

export type Db = ReturnType<typeof createDb>;
