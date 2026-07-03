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
  const [whisperWarning, setWhisperWarning] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [vocab, setVocab] = useState("");
  const [vocabSaved, setVocabSaved] = useState(false);

  // Whisper health probe for the CPU-fallback / unreachable banner. Runs on
  // mount and again while jobs are in flight (see the polling effect below):
  // whisper reports "unloaded" until the first transcription, so a mount-only
  // probe would almost never see the CPU fallback.
  const probeWhisper = useCallback(async () => {
    try {
      const health = await api.whisperHealth();
      setWhisperWarning(
        health.device === "cpu"
          ? "Transcription running on CPU — this will be slow."
          : null,
      );
    } catch {
      setWhisperWarning("Whisper service unreachable.");
    }
  }, []);

  useEffect(() => {
    void probeWhisper();
  }, [probeWhisper]);

  // Load the custom vocabulary preset once.
  useEffect(() => {
    let cancelled = false;
    api
      .getPreset("vocab")
      .then((value) => {
        if (!cancelled && typeof value === "string") setVocab(value);
      })
      .catch(() => {
        // non-fatal: leave the textarea empty
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveVocab = async () => {
    try {
      await api.putPreset("vocab", vocab);
      setVocabSaved(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
    const timer = setInterval(() => {
      void refresh();
      // Cheap local call: re-probe so the CPU-fallback banner can appear once
      // whisper actually loads a model.
      void probeWhisper();
    }, 2000);
    return () => {
      clearInterval(timer);
      // One last probe when polling stops so the final device state sticks.
      void probeWhisper();
    };
  }, [active, refresh, probeWhisper]);

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
      {whisperWarning && !warningDismissed && (
        <div className="banner banner-warning" role="alert">
          <span>{whisperWarning}</span>
          <button
            aria-label="Dismiss warning"
            onClick={() => setWarningDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
      <details className="settings-panel">
        <summary>Settings</summary>
        <label htmlFor="vocab-input">
          Custom vocabulary (game terms, names — passed to the transcriber as
          an initial prompt)
        </label>
        <textarea
          id="vocab-input"
          rows={3}
          value={vocab}
          placeholder="e.g. Terraria, Moon Lord, Zenith"
          onChange={(e) => {
            setVocab(e.target.value);
            setVocabSaved(false);
          }}
          onBlur={() => void saveVocab()}
        />
        <button onClick={() => void saveVocab()}>
          {vocabSaved ? "Vocabulary saved" : "Save vocabulary"}
        </button>
      </details>
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
                {(clip.status === "no_speech" || clip.status === "error") && (
                  <button
                    className="row-action"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(() => api.transcribeClip(clip.id));
                    }}
                  >
                    {clip.status === "no_speech"
                      ? "Transcribe anyway"
                      : "Retry transcribe"}
                  </button>
                )}
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
