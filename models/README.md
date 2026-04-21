# Control Models

This directory stores control-script model files.

Current demo model:

- `cp500_demo_control_v1.pkl`

How to rebuild the demo model:

```powershell
python scripts/build_demo_control_model.py
```

How to train a model from CSV:

```powershell
python scripts/train_control_model_from_csv.py --csv data/control_samples.csv
```

Expected default feature columns:

- `temp_avg_5m`
- `o2_min_5m`
- `sample_count_temp`
- `sample_count_o2`

Expected default label column:

- `decision`

Supported label values:

- `on`
- `off`
- `hold`
- `1`
- `0`
