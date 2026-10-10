
import json
import sys
from pathlib import Path

from extract import MODEL, extract
from prompt import PROMPT_VERSION
from schema import is_backtestable

# (text, expected sign.kind or None to skip, expected backtestable or None to skip)
TESTS = [
    # --- Lab Tests: atmospheric signs an instrument can record ---
    ("When the glass falls low, prepare for a blow.", "atmospheric", True),
    ("Wind from the west, weather at its best; wind from the east, bad for man and beast.", "atmospheric", True),
    ("When the wind turns south, rain is in its mouth.", "atmospheric", True),
    ("A rapid drop in the barometer brings a gale.", "atmospheric", True),
    # --- Field Tests: a person has to judge the sign ---
    ("Red sky at night, sailor's delight; red sky in morning, sailor's warning.", "celestial", False),
    ("Ring around the moon, rain is coming soon.", "celestial", False),
    ("Abendrot, Gutwetterbot'; Morgenrot bringt Wolkennot.", "celestial", False),
    ("Halo around the sun means rain before the day is done.", "celestial", False),
    ("When cows lie down in the pasture, expect rain.", "animal", False),
    ("Swifts flying low means rain.", "animal", False),
    ("Count cricket chirps to tell how warm it is tonight.", "animal", False),
    ("When frogs croak loudly by the pond, rain is near.", "animal", False),
    ("चींटियां अंडे लेकर चलें तो वर्षा निश्चित है।", "animal", False),
    ("Si les fourmis font de hauts dômes, l'hiver sera rude.", "animal", False),
    ("When pine cones close up tight, rain is in sight.", "plant", False),
    ("Dandelions folding their blossoms during the day means rain.", "plant", False),
    ("When leaves show their undersides, rain is coming.", "plant", False),
    ("My aching knee says rain is on the way.", "body", False),
    ("When the salt shaker cakes, rain is on the way.", None, False),   # humidity-driven, but a person judges it
    ("When the ditch smells pungent, rain will fall.", None, False),    # smell: a person judges it
    ("Dew on the grass, no rain will come to pass.", None, None),       # ambiguous on purpose: reported, not scored
]


def run(model: str) -> dict:
    rows, valid, kind_ok, n_kind, bt_ok, n_bt = [], 0, 0, 0, 0, 0
    for text, exp_kind, exp_bt in TESTS:
        row = {"text": text, "expected_kind": exp_kind, "expected_backtestable": exp_bt}
        try:
            h = extract(text, model)
        except Exception as e:
            row["error"] = str(e)
            print(f"INVALID  {text}  ({e})")
            rows.append(row)
            continue
        valid += 1
        bt = is_backtestable(h)
        row.update(kind=h.sign.kind, backtestable=bt, fit=h.proxy.fit, language=h.language,
                ambiguities=h.ambiguities)
        print(f"{h.sign.kind:12} bt={bt!s:5} fit={h.proxy.fit:5} lang={h.language:10} | {text}")
        if exp_kind:
            n_kind += 1
            kind_ok += h.sign.kind == exp_kind
        if exp_bt is not None:
            n_bt += 1
            bt_ok += bt == exp_bt
        rows.append(row)
    summary = {
        "model": model, "prompt_version": PROMPT_VERSION, "cases": len(TESTS),
        "json_valid": valid, "sign_kind_correct": kind_ok, "sign_kind_total": n_kind,
        "backtestable_correct": bt_ok, "backtestable_total": n_bt, "rows": rows,
    }
    Path("results").mkdir(exist_ok=True)
    Path("results", model.replace(":", "_").replace("/", "_") + ".json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


if __name__ == "__main__":
    models = sys.argv[1:] or [MODEL]
    results = [run(m) for m in models]
    print("\n| Model | Prompt | JSON valid | Sign kind right | Backtestable right |")
    print("|---|---|---|---|---|")
    for r in results:
        print(f"| {r['model']} | {r['prompt_version']} | {r['json_valid']}/{r['cases']} | "
            f"{r['sign_kind_correct']}/{r['sign_kind_total']} | {r['backtestable_correct']}/{r['backtestable_total']} |")