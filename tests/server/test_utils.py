"""
Unit tests for pure utility functions in scripts/gliner2_server.py.
Run with: pytest tests/server/test_utils.py -v
"""
import sys
from pathlib import Path

# Add scripts dir to path so we can import without installing
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))

from gliner2_server import make_chunks, deduplicate_detections, flatten_gliner2_output, CHUNK_SIZE, CHUNK_OVERLAP


class TestMakeChunks:
    def test_short_text_single_chunk(self):
        text = "Hello world"
        chunks = make_chunks(text)
        assert len(chunks) == 1
        assert chunks[0] == (text, 0)

    def test_exact_chunk_size_single_chunk(self):
        text = "a" * CHUNK_SIZE
        chunks = make_chunks(text)
        assert len(chunks) == 1

    def test_long_text_multiple_chunks(self):
        text = "word " * 200  # well over CHUNK_SIZE
        chunks = make_chunks(text)
        assert len(chunks) > 1

    def test_chunks_cover_full_text(self):
        text = "Hello world. " * 100
        chunks = make_chunks(text)
        # Every character of the text should appear in at least one chunk
        covered = set()
        for chunk_text, offset in chunks:
            for i, ch in enumerate(chunk_text):
                covered.add(offset + i)
        assert covered == set(range(len(text)))

    def test_chunk_offsets_correct(self):
        text = "a" * 200 + "b" * 200 + "c" * 200
        chunks = make_chunks(text)
        for chunk_text, offset in chunks:
            # Verify the chunk matches the source text at the given offset
            assert text[offset:offset + len(chunk_text)] == chunk_text

    def test_overlap_captures_boundary(self):
        # An entity spanning the boundary should appear in adjacent chunks
        text = ("word " * 90) + "BOUNDARY_ENTITY " + ("word " * 90)
        chunks = make_chunks(text)
        entity_pos = text.index("BOUNDARY_ENTITY")
        chunks_with_entity = [
            (ct, off) for ct, off in chunks
            if off <= entity_pos < off + len(ct)
        ]
        assert len(chunks_with_entity) >= 1


class TestDeduplicateDetections:
    def _det(self, start, end, label="person", score=0.8):
        return {"text": "x", "label": label, "start": start, "end": end, "score": score}

    def test_empty(self):
        assert deduplicate_detections([]) == []

    def test_no_overlap(self):
        dets = [self._det(0, 5), self._det(10, 15)]
        result = deduplicate_detections(dets)
        assert len(result) == 2

    def test_exact_overlap_keeps_higher_score(self):
        dets = [self._det(0, 5, score=0.9), self._det(0, 5, score=0.7)]
        result = deduplicate_detections(dets)
        assert len(result) == 1
        assert result[0]["score"] == 0.9

    def test_partial_overlap_keeps_higher_score(self):
        dets = [self._det(0, 10, score=0.6), self._det(5, 15, score=0.85)]
        result = deduplicate_detections(dets)
        assert len(result) == 1
        assert result[0]["score"] == 0.85

    def test_adjacent_no_overlap(self):
        dets = [self._det(0, 5), self._det(5, 10)]
        result = deduplicate_detections(dets)
        assert len(result) == 2

    def test_output_sorted_by_start(self):
        dets = [self._det(10, 15), self._det(0, 5), self._det(20, 25)]
        result = deduplicate_detections(dets)
        starts = [d["start"] for d in result]
        assert starts == sorted(starts)


class TestFlattenGliner2Output:
    def test_grouped_dict_format(self):
        raw = {
            "entities": {
                "person": [{"text": "John", "start": 0, "end": 4, "confidence": 0.9}],
                "email": [{"text": "a@b.com", "start": 10, "end": 17, "confidence": 0.95}],
            }
        }
        result = flatten_gliner2_output(raw)
        assert len(result) == 2
        labels = {r["label"] for r in result}
        assert labels == {"person", "email"}

    def test_flat_list_format(self):
        raw = [
            {"text": "John", "label": "person", "start": 0, "end": 4},
        ]
        result = flatten_gliner2_output(raw)
        assert len(result) == 1
        assert result[0]["label"] == "person"

    def test_empty_entities(self):
        assert flatten_gliner2_output({"entities": {}}) == []
        assert flatten_gliner2_output([]) == []
        assert flatten_gliner2_output({}) == []

    def test_grouped_sets_label_from_key(self):
        raw = {
            "entities": {
                "custom_employee_id": [{"text": "EMP-001", "start": 0, "end": 7, "confidence": 0.88}]
            }
        }
        result = flatten_gliner2_output(raw)
        assert result[0]["label"] == "custom_employee_id"
