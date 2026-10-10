import os
import sys

import ollama

from config import WINDOW_H
from prompt import PROMPT_VERSION, SYSTEM
from schema import Hypothesis, is_backtestable

MODEL = os.environ.get("LORE_MODEL", "gemma3:4b")


def extract(text: str, model: str | None = None) -> Hypothesis:
    """Proverb in any language -> validated Hypothesis. One retry, then raise (F10)."""
    model = model or MODEL
    err = None
    for _ in range(2):
        r = ollama.chat(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Proverb: {text}"},
            ],
            format=Hypothesis.model_json_schema(),
            options={"temperature": 0},
            keep_alive="1h",  # keep Gemma loaded between requests (first call is the slow one)
        )
        try:
            h = Hypothesis.model_validate_json(r.message.content)
            h.outcome.window_hours = WINDOW_H  # the window is a pre-committed constant, not a model guess
            return h
        except Exception as e:
            err = e
    raise RuntimeError(f"Invalid output after retry: {err}")


if __name__ == "__main__":
    h = extract(" ".join(sys.argv[1:]))
    print(h.model_dump_json(indent=2))
    print("backtestable:", is_backtestable(h), "| prompt", PROMPT_VERSION, "| model", MODEL)