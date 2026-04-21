from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

try:
    import joblib
    from sklearn.ensemble import RandomForestClassifier
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "This training script requires scikit-learn and joblib. "
        "Install them first, for example: pip install scikit-learn joblib"
    ) from exc


DEFAULT_FEATURES = [
    "temp_avg_5m",
    "o2_min_5m",
    "sample_count_temp",
    "sample_count_o2",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a control model from CSV and export a joblib file."
    )
    parser.add_argument("--csv", required=True, help="Input CSV path")
    parser.add_argument(
        "--output",
        default="models/cp500_control_from_csv_v1.joblib",
        help="Output model path, relative to project root by default",
    )
    parser.add_argument(
        "--label-col",
        default="decision",
        help="Label column name. Supported values: on/off/hold or 1/0",
    )
    parser.add_argument(
        "--features",
        nargs="+",
        default=DEFAULT_FEATURES,
        help="Feature columns in order",
    )
    return parser.parse_args()


def normalize_label(value: object) -> int:
    text = str(value).strip().lower()
    if text in {"1", "on", "true"}:
        return 1
    if text in {"0", "off", "false", "hold"}:
        return 0
    raise ValueError(f"Unsupported label value: {value}")


def main() -> None:
    args = parse_args()
    base_dir = Path(__file__).resolve().parent.parent
    csv_path = Path(args.csv)
    if not csv_path.is_absolute():
        csv_path = base_dir / csv_path
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = base_dir / output_path

    df = pd.read_csv(csv_path)
    missing = [col for col in [*args.features, args.label_col] if col not in df.columns]
    if missing:
        raise SystemExit(f"Missing required columns: {', '.join(missing)}")

    train_df = df[[*args.features, args.label_col]].dropna().copy()
    if train_df.empty:
        raise SystemExit("No usable rows after dropping missing feature/label values")

    x = train_df[args.features].astype(float)
    y = train_df[args.label_col].map(normalize_label).astype(int)

    model = RandomForestClassifier(
        n_estimators=120,
        max_depth=6,
        min_samples_leaf=2,
        random_state=42,
    )
    model.fit(x, y)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output_path)

    print(f"trained rows: {len(train_df)}")
    print(f"features: {args.features}")
    print(f"saved model: {output_path}")


if __name__ == "__main__":
    main()
