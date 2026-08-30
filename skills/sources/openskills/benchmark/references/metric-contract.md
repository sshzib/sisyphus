# Metric File Contract

`compare_metrics.py` accepts two JSON objects containing numeric values with matching keys.

```json
{
  "lcp_ms": 2100,
  "api_p95_ms": 180,
  "bundle_kb": 312
}
```

Use the same units, test environment, workload, cache state, and metric definition in both files. Lower is treated as better by default. The script compares values; it does not establish statistical significance or replace a benchmark plan.
