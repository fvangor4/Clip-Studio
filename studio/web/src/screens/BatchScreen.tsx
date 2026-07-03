import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Clip, type Jobs } from "../api";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "–";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function resolutionLabel(clip: Clip): string {
  if (clip.width === null || clip.height === null) return "other";
  if (clip.width === 3840 && clip.height === 1080) return "dual 3840x1080";
  if (clip.height === 1080) return "1080p";
  return "other";
}

export function BatchScreen() {
  const navigate = useNavigate();
  const [clips, setClips] = useState<Clip[]>([]);
  const [jobs, setJobs] = useState<Jobs | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [clipList, jobState] = await Promise.all([
        api.listClips(),
        api.getJobs(),
      ]);
      setClips(clipList);
      setJobs(jobState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Poll only while work is in flight.
  const active =
    clips.some((c) => c.status === "transcribing" || c.status === "rendering") ||
    (jobs !== null && (jobs.transcribe.queued > 0 || jobs.render.queued > 0));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = clips.length > 0 && clips.every((c) => selected.has(c.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(clips.map((c) => c.id)));
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const readyIds = clips.filter((c) => c.status === "ready").map((c) => c.id);
  const renderProgress = jobs?.render.progress ?? {};

  return (
    <div className="page">
      <header className="toolbar">
        <h1>Clip Studio</h1>
        <button disabled={busy} onClick={() => void run(() => api.scan())}>
          Scan folder
        </button>
        <button
          disabled={busy || selected.size === 0}
          onClick={() => void run(() => api.transcribeBatch([...selected]))}
        >
          Transcribe selected ({selected.size})
        </button>
        <button
          disabled={busy || readyIds.length === 0}
          onClick={() => void run(() => api.renderBatch(readyIds))}
        >
          Render all ready ({readyIds.length})
        </button>
        {active && <span className="muted">working…</span>}
        {error && <span className="error-text">{error}</span>}
      </header>
      <table className="clips">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
              />
            </th>
            <th>File</th>
            <th>Duration</th>
            <th>Resolution</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {clips.map((clip) => (
            <tr key={clip.id} onClick={() => navigate(`/review/${clip.id}`)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(clip.id)}
                  onChange={() => toggle(clip.id)}
                  aria-label={`Select ${basename(clip.path)}`}
                />
              </td>
              <td className="filename">{basename(clip.path)}</td>
              <td>{formatDuration(clip.duration)}</td>
              <td>
                <span className="badge">{resolutionLabel(clip)}</span>
              </td>
              <td>
                <span
                  className={`chip chip-${clip.status}`}
                  title={clip.status === "error" ? clip.error ?? undefined : undefined}
                >
                  {clip.status}
                  {clip.status === "rendering" &&
                    renderProgress[clip.id] !== undefined &&
                    ` ${Math.round(renderProgress[clip.id].progress * 100)}%`}
                </span>
              </td>
            </tr>
          ))}
          {clips.length === 0 && (
            <tr>
              <td colSpan={5} className="muted empty">
                No clips. Scan the recordings folder to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
