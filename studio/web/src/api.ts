export type ClipStatus =
  | "new"
  | "transcribing"
  | "review"
  | "no_speech"
  | "ready"
  | "rendering"
  | "done"
  | "error";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface Clip {
  id: number;
  path: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: ClipStatus;
  error: string | null;
  transcript: TranscriptWord[] | null;
  settings: Record<string, unknown> | null;
}

export interface Jobs {
  transcribe: { queued: number };
  render: {
    queued: number;
    progress: Record<string, { progress: number; stage: string }>;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    ...(body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

export const api = {
  listClips: () => request<Clip[]>("/api/clips"),
  getJobs: () => request<Jobs>("/api/jobs"),
  scan: () => post<unknown>("/api/scan"),
  transcribeBatch: (ids: number[]) =>
    post<{ queued: number }>("/api/transcribe-batch", { ids }),
  renderBatch: (ids: number[]) =>
    post<{ queued: number }>("/api/render-batch", { ids }),
};
