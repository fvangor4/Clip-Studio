import os
import threading

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.transcribe import flatten_words

app = FastAPI()

_model = None
_device = None
_lock = threading.Lock()


class TranscribeRequest(BaseModel):
    path: str
    initial_prompt: str | None = None


def _get_model():
    global _model, _device
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel
            try:
                _model = WhisperModel("distil-large-v3", device="cuda", compute_type="float16")
                _device = "cuda"
            except Exception:
                _model = WhisperModel("distil-large-v3", device="cpu", compute_type="int8")
                _device = "cpu"
        return _model


@app.get("/health")
def health():
    return {"status": "ok", "device": _device or "cuda"}


@app.post("/transcribe")
def transcribe(req: TranscribeRequest):
    if not os.path.isfile(req.path):
        raise HTTPException(status_code=404, detail="file not found")
    model = _get_model()
    segments, info = model.transcribe(req.path, word_timestamps=True,
                                      initial_prompt=req.initial_prompt)
    words = flatten_words(segments)
    if not words:
        return JSONResponse(status_code=422, content={"error": "no_speech"})
    return {"words": words, "language": info.language, "duration": info.duration}
