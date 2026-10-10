"""Offline tests for the pre-generated lookup. Stdlib only."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pregen  # noqa: E402


def test_normalize_ignores_case_punctuation_and_spacing():
    a = pregen.normalize("Swifts flying low means rain.")
    b = pregen.normalize("  swifts  FLYING low, means rain ")
    assert a == b


def test_lookup_finds_saved_saying_and_reports_model(tmp_path):
    f = tmp_path / "pregenerated.json"
    f.write_text(json.dumps({
        "model": "gemma3:4b", "prompt_version": "v2.1",
        "items": {pregen.normalize("Rain before seven, fine before eleven."): {"original_text": "x"}},
    }))
    hit = pregen.lookup("rain before seven fine before eleven", f)
    assert hit and hit["model"] == "gemma3:4b" and hit["prompt_version"] == "v2.1"
    assert hit["hypothesis"] == {"original_text": "x"}


def test_lookup_misses_unknown_saying_and_missing_or_bad_file(tmp_path):
    f = tmp_path / "pregenerated.json"
    assert pregen.lookup("anything", f) is None  # no file
    f.write_text("{not json")
    assert pregen.lookup("anything", f) is None  # corrupt file
    f.write_text(json.dumps({"items": {}}))
    assert pregen.lookup("anything", f) is None  # empty