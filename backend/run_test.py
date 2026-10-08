from backend.extract import extract , MODEL
from backend.schema import is_backtestable

TESTS = [# --- LAB TESTS: Atmospheric signs with whitelisted sensor proxies (True) ---
    ("When the glass falls low, prepare for a blow.", "atmospheric", True),
    ("Wind from the west, weather at its best; wind from the east, bad for man and beast.", "atmospheric", True),
    ("When the wind turns south, rain is in its mouth.", "atmospheric", True),
    ("When the salt shaker cakes, rain is on the way.", "atmospheric", True),
    ("A rapid drop in the barometer brings a gale.", "atmospheric", True),
    ("When the dew is on the grass, rain will never come to pass.", "atmospheric", None),  # <-- Added missing comma

    # --- FIELD TESTS: Celestial & visual optics (False) ---
    ("Red sky at night, sailor's delight; red sky in morning, sailor's warning.", "celestial", False),
    ("Ring around the moon, rain is coming soon.", "celestial", False),
    ("Abendrot, Gutwetterbrot; Morgenrot bringt Wolkennot.", "celestial", False),
    ("Halo around the sun means rain before the day is done.", "celestial", False),

    # --- FIELD TESTS: Animal behavior (False) ---
    ("When cows lie down in the pasture, expect rain.", "animal", False),
    ("Cuando las golondrinas vuelan bajo, agua viene.", "animal", False),
    ("Count cricket chirps to tell how warm it is tonight.", "animal", False),
    ("When frogs croak loudly by the pond, rain is near.", "animal", False),
    ("चींटियां अंडे लेकर चलें तो वर्षा निश्चित है।", "animal", False),
    ("Si les fourmis font de hauts dômes, l'hiver sera rude.", "animal", False),

    # --- FIELD TESTS: Plant responses (False) ---
    ("When pine cones close up tight, rain is in sight.", "plant", False),
    ("Dandelions folding their blossoms during the day means rain.", "plant", False),
    ("When leaves show their undersides, rain is coming.", "plant", False),

    # --- FIELD TESTS: Physical / Bodily sensations (False) ---
    ("My aching knee says rain is on the way.", "body", False),
    ("When the ditch smells pungent, rain will fall.", "atmospheric", False),  # <-- Added missing comma
    
    # --- Multilingual smoke test ---
    ("Abendrot Schönwetterbot.", None, None),]

valid = kind_ok = bt_ok = n_kind = n_bt = 0

for text , exp_kind , exp_bt in TESTS:
    try:
        h = extract(text)
    except Exception as e:
        print(f"INVALID {text} ({e})")
        continue

    valid+= 1
    bt = is_backtestable(h)
    print(f"{h.sign.kind:12} bt={bt!s:5} fit={h.proxy.fit:5} lang={h.language:8} | {text}")

    if exp_kind:
        n_kind += 1
        kind_ok += h.sign.kind == exp_kind

    if exp_bt is not None:
        n_bt += 1
        bt_ok += bt == exp_bt

print(f"\nModel: {MODEL}")
print(f"JSON valid:      {valid}/{len(TESTS)}")
print(f"Sign kind right: {kind_ok}/{n_kind}")
print(f"Backtestable right: {bt_ok}/{n_bt}")


