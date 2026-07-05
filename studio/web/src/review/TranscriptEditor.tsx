import { useState } from "react";
import type { Word } from "../../../shared/captions";

interface TranscriptEditorProps {
  words: Word[];
  onChange(words: Word[]): void;
}

const LOW_CONFIDENCE = 0.5;

/**
 * Word chips in flow layout. Click a chip to edit its text inline
 * (Enter/blur commits, Escape cancels); the x button deletes the word.
 * Timings are never modified.
 */
export function TranscriptEditor({ words, onChange }: TranscriptEditorProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const commit = (index: number) => {
    const text = draft.trim();
    setEditing(null);
    if (text === "" || text === words[index].text) return;
    onChange(words.map((w, i) => (i === index ? { ...w, text } : w)));
  };

  return (
    <div className="transcript-editor">
      {words.map((word, i) =>
        editing === i ? (
          <input
            key={i}
            className="word-input"
            autoFocus
            value={draft}
            size={Math.max(draft.length, 2)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(i);
              else if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <span
            key={i}
            className={`word-chip${word.confidence < LOW_CONFIDENCE ? " word-chip-low" : ""}`}
            title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s (conf ${word.confidence.toFixed(2)})`}
            onClick={() => {
              setEditing(i);
              setDraft(word.text);
            }}
          >
            {word.text}
            <button
              className="word-delete"
              aria-label={`Delete "${word.text}"`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(words.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </span>
        ),
      )}
      {words.length === 0 && <span className="muted">No words.</span>}
    </div>
  );
}
