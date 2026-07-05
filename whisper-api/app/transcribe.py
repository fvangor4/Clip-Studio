def flatten_words(segments):
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            words.append({"text": text, "start": round(w.start, 3),
                          "end": round(w.end, 3), "confidence": round(w.probability, 3)})
    return words
