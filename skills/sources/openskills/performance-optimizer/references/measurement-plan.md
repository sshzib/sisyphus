# Measurement Plan

## Before Measuring

State the hypothesis, user journey or endpoint, metric, unit, population, environment, load, sample count, and baseline revision. Keep these constant for a before/after comparison.

## Interpret Carefully

Report distributions or percentiles for latency rather than only averages. Separate cold and warm cache behavior. Note variance, outliers, data collection failures, and changes in traffic or hardware. A small difference inside measurement noise is not a proven improvement.

## Decision

Declare the threshold that matters before optimizing. Keep the raw measurements and a reproducible command or dashboard query with the result.
