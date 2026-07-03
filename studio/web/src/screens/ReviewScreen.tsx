import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Clip, type TranscriptWord } from "../api";
import { CropControl } from "../review/CropControl";
import { PreviewPlayer } from "../review/PreviewPlayer";
import { normalizeSettings, type ClipSettings } from "../review/settings";
import { StylePicker } from "../review/StylePicker";
import { TranscriptEditor } from "../review/TranscriptEditor";

export function ReviewScreen() {
  const { id } = useParams();
  const clipId = Number(id);
  const navigate = useNavigate();

  const [clip, setClip] = useState<Clip | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [settings, setSettings] = useState<ClipSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presetSaved, setPresetSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setClip(null);
    setSettings(null);
    setDirty(false);
    setError(null);
    setPresetSaved(false);
    Promise.all([api.getClip(clipId), api.listClips()])
      .then(([c, list]) => {
        if (cancelled) return;
        setClip(c);
        setClips(list);
        setWords(c.transcript ?? []);
        setSettings(normalizeSettings(c.settings, c));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clipId]);

  const updateWords = useCallback((next: TranscriptWord[]) => {
    setWords(next);
    setDirty(true);
  }, []);

  const updateSettings = useCallback((patch: Partial<ClipSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const save = async (): Promise<boolean> => {
    if (!settings) return false;
    setSaving(true);
    try {
      const updated = await api.patchClip(clipId, {
        transcript: words,
        settings: settings as unknown as Record<string, unknown>,
        status: "ready",
      });
      setClip(updated);
      setDirty(false);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndNext = async () => {
    if (!(await save())) return;
    const reviewable = clips.filter(
      (c) => c.status === "review" && c.id !== clipId,
    );
    const next =
      reviewable.find((c) => c.id > clipId) ?? reviewable[0] ?? null;
    navigate(next ? `/review/${next.id}` : "/");
  };

  if (error && !clip) {
    return (
      <div className="page">
        <header className="toolbar">
          <Link to="/">&larr; Back to batch</Link>
        </header>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!clip || !settings) {
    return (
      <div className="page">
        <p className="muted">Loading clip…</p>
      </div>
    );
  }

  const src = api.clipFileUrl(clip.id);
  const sourceW = clip.width ?? 1920;
  const sourceH = clip.height ?? 1080;
  const singleLayout = sourceW === 1920 && sourceH === 1080;

  const savePreset = async () => {
    if (!settings.webcamCrop) return;
    try {
      await api.putPreset("webcamRegion", settings.webcamCrop);
      setPresetSaved(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page page-wide">
      <header className="toolbar">
        <Link to="/">&larr; Back to batch</Link>
        <h1>
          Review clip #{clip.id}
          {dirty && (
            <span className="dirty-dot" title="Unsaved changes">
              ●
            </span>
          )}
        </h1>
        <span className={`chip chip-${clip.status}`}>{clip.status}</span>
        <button disabled={saving || !dirty} onClick={() => void save()}>
          Save
        </button>
        <button disabled={saving} onClick={() => void saveAndNext()}>
          Save &amp; Next
        </button>
        {error && <span className="error-text">{error}</span>}
      </header>

      <div className="review-layout">
        <div className="review-preview">
          <PreviewPlayer
            src={src}
            sourceW={sourceW}
            sourceH={sourceH}
            words={words}
            settings={settings}
          />
        </div>

        <div className="review-panel">
          <section>
            <h2>Transcript</h2>
            {clip.transcript === null && words.length === 0 ? (
              <p className="muted">
                No transcript for this clip
                {clip.status === "no_speech" && " (no speech was detected)"}.
                Transcribe it from the batch screen first, or render it
                without captions.
              </p>
            ) : (
              <TranscriptEditor words={words} onChange={updateWords} />
            )}
          </section>

          <section>
            <h2>Captions</h2>
            <StylePicker settings={settings} onChange={updateSettings} />
          </section>

          <section>
            <h2>Crops</h2>
            {settings.webcamCrop && (
              <CropControl
                label="Webcam"
                src={src}
                sourceW={sourceW}
                sourceH={sourceH}
                crop={settings.webcamCrop}
                onChange={(crop) => updateSettings({ webcamCrop: crop })}
                action={
                  singleLayout ? (
                    <button onClick={() => void savePreset()}>
                      {presetSaved
                        ? "Preset saved"
                        : "Save webcam region as preset"}
                    </button>
                  ) : undefined
                }
              />
            )}
            {settings.gameplayCrop && (
              <CropControl
                label="Gameplay"
                src={src}
                sourceW={sourceW}
                sourceH={sourceH}
                crop={settings.gameplayCrop}
                onChange={(crop) => updateSettings({ gameplayCrop: crop })}
              />
            )}
            {!settings.webcamCrop && !settings.gameplayCrop && (
              <p className="muted">
                No crop regions for this clip (unrecognized layout).
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
