import sys
import ollama
from schema import Hypothesis, is_backtestable
from prompt import SYSTEM
import os

MODEL = os.environ.get("LORE_MODEL", "gemma3:4b")

def extract(text: str) -> Hypothesis:
    err = None
    for _ in range(2):
        r = ollama.chat(
            model= MODEL,
            messages = [ {"role" : "system","content" : SYSTEM},
                        {"role" : "user","content": f"Proverb :{text}"}],
            format = Hypothesis.model_json_schema(),
            options = {"temperature":0},
            keep_alive = "1h",   # keep Gemma loaded between requests (first call is the slow one)
        )
        try:
            return Hypothesis.model_validate_json(r.message.content)
        except Exception as e:
            err = e
    raise RuntimeError(f"Invalid output after retry : {err}")
if __name__ == "__main__":
    h = extract(" ".join(sys.argv[1:]))
    print(h.model_dump_json(indent=2))
    print("backtestable:", is_backtestable(h))