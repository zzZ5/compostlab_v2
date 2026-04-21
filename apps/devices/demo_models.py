from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List


@dataclass
class Cp500DemoClassifier:
    """
    Lightweight pickle-safe demo classifier.

    Input vector order:
    1. temp_avg_5m
    2. o2_min_5m
    3. sample_count_temp
    4. sample_count_o2
    """

    temp_high: float = 68.0
    o2_low: float = 8.5
    min_samples: float = 3.0

    @property
    def classes_(self) -> List[int]:
        return [0, 1]

    def _score(self, row: Iterable[float]) -> float:
        values = list(row)
        temp = float(values[0]) if len(values) > 0 else 0.0
        o2_value = float(values[1]) if len(values) > 1 else 21.0
        sample_count_temp = float(values[2]) if len(values) > 2 else 0.0
        sample_count_o2 = float(values[3]) if len(values) > 3 else 0.0

        if sample_count_temp < self.min_samples or sample_count_o2 < self.min_samples:
            return 0.35

        score = 0.15
        if temp >= self.temp_high:
            score += 0.45
        if o2_value <= self.o2_low:
            score += 0.35
        if temp >= self.temp_high + 4:
            score += 0.05
        return max(0.0, min(0.98, score))

    def predict_proba(self, rows: Iterable[Iterable[float]]) -> List[List[float]]:
        probs: List[List[float]] = []
        for row in rows:
            on_prob = self._score(row)
            probs.append([1.0 - on_prob, on_prob])
        return probs

    def predict(self, rows: Iterable[Iterable[float]]) -> List[int]:
        return [1 if self._score(row) >= 0.5 else 0 for row in rows]
