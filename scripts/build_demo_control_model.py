from __future__ import annotations

import pickle
from pathlib import Path

from apps.devices.demo_models import Cp500DemoClassifier


BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
OUTPUT_PATH = MODELS_DIR / "cp500_demo_control_v1.pkl"


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model = Cp500DemoClassifier(
        temp_high=68.0,
        o2_low=8.5,
        min_samples=3.0,
    )
    with OUTPUT_PATH.open("wb") as fp:
        pickle.dump(model, fp)
    print(f"saved demo model to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
