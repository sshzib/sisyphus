#!/usr/bin/env python3
"""Compare two flat JSON metric files. Lower values are considered better."""

import json
import sys
from pathlib import Path


def load_metrics(path: str) -> dict[str, float]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not all(isinstance(value, (int, float)) for value in data.values()):
        raise ValueError(f"{path} must be a JSON object containing numeric metric values")
    return data


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: compare_metrics.py <baseline.json> <candidate.json>", file=sys.stderr)
        return 2
    baseline, candidate = load_metrics(sys.argv[1]), load_metrics(sys.argv[2])
    if baseline.keys() != candidate.keys():
        print("Metric keys must match exactly", file=sys.stderr)
        return 2
    print("| Metric | Baseline | Candidate | Change |")
    print("|---|---:|---:|---:|")
    for name in sorted(baseline):
        before, after = baseline[name], candidate[name]
        change = "n/a" if before == 0 else f"{((after - before) / before) * 100:+.1f}%"
        print(f"| {name} | {before:g} | {after:g} | {change} |")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(2)
