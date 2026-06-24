# lightsout — high-quality validation run

> Generated 2026-06-24T02:20:35.784Z · 20-site panel · **3 cold reps each, concurrency 1, HTTP cache disabled**, ~150ms RTT / 1.6Mbps.

This run exists to remove one objection to the [main benchmark](RESULTS.md):
that its concurrent throttled Chrome tabs fought for CPU and made per-site
FCP noisy. Here exactly one page renders at a time, and each site is loaded
cold **3 times** so we can report the spread, not a single sample.

## Summary

- **Mean PRR across the panel: 0.46** (between-site SD 0.34).
- **Median within-site PRR standard deviation: 0.021** — the repetition noise is small.
- Mean within-site FCP coefficient of variation: **14%**.
- **17 / 20** sites paint past the network floor (PRR < 1); **3** reach it exactly (PRR ≈ 1); **5** are JS-bound (PRR < 0.1).

**Two honest conclusions.**

1. **The measurement is not the noise.** With one tab at a time and cache
   disabled, repeated loads barely move — median per-site PRR SD 0.021, FCP
   variation ~14%. The gap between floor and real paint is real, not an
   artifact of Chrome instances fighting for CPU.
2. **But the contended run overstated the gap.** Free of CPU contention,
   mean PRR rises to **0.46** (the main run's tabs inflated FCP). Several sites
   (google, dell, lyft, figma) paint *right at* the network floor; the
   JS-bound tail (spotify, x, microsoft, github, bestbuy) is genuine and
   stable. So: JavaScript dominates *for the sites where it dominates* — it
   is not a universal law, and the clean numbers say so.

## Per-site (mean ± sample SD over reps)

| Site | Floor | FCP (mean ± SD) | PRR (mean ± SD) | reps (FCP, s) |
|---|---:|---:|---:|---|
| bestbuy.com | 300 ms | 9.4 ± 0.8s | **0.03** ± 0.00 | 8.6, 9.3, 10.3 |
| open.spotify.com | 450 ms | 13.3 ± 0.2s | **0.03** ± 0.00 | 13.5, 13.2, 13.2 |
| x.com | 450 ms | 6.0 ± 0.2s | **0.07** ± 0.00 | 6.3, 5.9, 5.9 |
| microsoft.com | 600 ms | 6.2 ± 0.2s | **0.10** ± 0.00 | 6.5, 6.1, 6.1 |
| github.com | 900 ms | 9.1 ± 0.0s | **0.10** ± 0.00 | 9.1, 9.1, 9.1 |
| reddit.com | 150 ms | 1.5 ± 0.4s | **0.11** ± 0.03 | 1.2, 1.2, 2.0 |
| youtube.com | 900 ms | 4.0 ± 0.1s | **0.22** ± 0.01 | 4.2, 4.0, 3.9 |
| nytimes.com | 900 ms | 3.1 ± 0.2s | **0.29** ± 0.02 | 2.9, 3.3, 3.2 |
| linkedin.com | 450 ms | 1.2 ± 0.1s | **0.36** ± 0.03 | 1.4, 1.2, 1.2 |
| apple.com | 600 ms | 1.5 ± 0.4s | **0.41** ± 0.09 | 1.9, 1.2, 1.3 |
| atlassian.com | 900 ms | 2.2 ± 0.5s | **0.42** ± 0.10 | 2.6, 2.4, 1.7 |
| wordpress.com | 750 ms | 1.6 ± 0.3s | **0.47** ± 0.07 | 1.9, 1.6, 1.4 |
| cloudflare.com | 900 ms | 1.7 ± 0.1s | **0.52** ± 0.03 | 1.9, 1.7, 1.7 |
| wikipedia.org | 300 ms | 0.5 ± 0.1s | **0.64** ± 0.15 | 0.6, 0.4, 0.4 |
| forbes.com | 750 ms | 1.1 ± 0.3s | **0.70** ± 0.15 | 1.4, 1.0, 0.9 |
| google.com | 600 ms | 0.7 ± 0.0s | **0.81** ± 0.02 | 0.8, 0.8, 0.7 |
| netlify.com | 750 ms | 0.9 ± 0.0s | **0.88** ± 0.04 | 0.9, 0.9, 0.8 |
| dell.com | 600 ms | 0.2 ± 0.1s | **1.00** ± 0.00 | 0.3, 0.2, 0.2 |
| lyft.com | 600 ms | 0.2 ± 0.0s | **1.00** ± 0.00 | 0.2, 0.2, 0.2 |
| figma.com | 900 ms | 0.6 ± 0.2s | **1.00** ± 0.00 | 0.8, 0.4, 0.4 |

## Reproduce

```bash
node bench/run-bench-hq.mjs        # 20 sites × 3 cold reps, one tab at a time
```
