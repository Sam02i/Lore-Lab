"""Run Gemma once over the verified starter sayings and save the results for the hosted demo.

    python pregenerate.py              # uses LORE_MODEL or gemma3:4b
    LORE_MODEL=gemma3:12b python pregenerate.py

Needs Ollama running. Writes pregenerated.json. Commit that file."""
import json
import sys
from pathlib import Path

from extract import MODEL, extract
from pregen import FILE, normalize
from prompt import PROMPT_VERSION

PROVERBS = Path(__file__).parent / "proverbs.json"


def main() -> int:
    sayings = [p for p in json.loads(PROVERBS.read_text(encoding="utf-8")) if p.get("verified")]
    items, failed = {}, []
    for p in sayings:
        try:
            h = extract(p["text"])
        except Exception as e:
            print(f"FAILED   {p['text']}  ({e})")
            failed.append(p["text"])
            continue
        items[normalize(p["text"])] = h.model_dump()
        print(f"ok       {p['text']}")
    FILE.write_text(
        json.dumps({"model": MODEL, "prompt_version": PROMPT_VERSION, "items": items}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nwrote {FILE.name}: {len(items)} of {len(sayings)} sayings ({MODEL}, prompt {PROMPT_VERSION})")
    if failed:
        print("Not saved (re-run, or leave them out of the hosted demo):", *failed, sep="\n  ")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())