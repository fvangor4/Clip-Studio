from app.transcribe import flatten_words


class FakeWord:
    def __init__(self, word, start, end, probability):
        self.word, self.start, self.end, self.probability = word, start, end, probability


class FakeSegment:
    def __init__(self, words):
        self.words = words


def test_flatten_words_strips_and_orders():
    segs = [FakeSegment([FakeWord(" Hello", 0.0, 0.4, 0.99), FakeWord(" world", 0.4, 0.8, 0.98)])]
    out = flatten_words(segs)
    assert out == [
        {"text": "Hello", "start": 0.0, "end": 0.4, "confidence": 0.99},
        {"text": "world", "start": 0.4, "end": 0.8, "confidence": 0.98},
    ]


def test_flatten_words_skips_empty_tokens():
    segs = [FakeSegment([FakeWord("  ", 0.0, 0.1, 0.5)])]
    assert flatten_words(segs) == []
