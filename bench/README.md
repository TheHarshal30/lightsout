# lightsout-bench

A reproducible benchmark that validates the `lightsout` model against the real
web. It runs the exact `lightsout` analysis over a curated list of popular
homepages ([`sites.json`](sites.json)) and commits the results as data.

## Files

| File | What it is |
|---|---|
| [`sites.json`](sites.json) | The input list of origins (edit to change the panel). |
| [`run-bench.mjs`](run-bench.mjs) | The harness — no dependencies, one fetch per site. |
| `dataset.json` | Structured records, one per site (schema below). |
| `dataset.csv` | The same rows, flattened for spreadsheets / notebooks. |
| [`RESULTS.md`](RESULTS.md) | Human-readable summary table + headline stats. |
| [`run-bench-hq.mjs`](run-bench-hq.mjs) | High-quality run: 20 sites, **concurrency 1, 3 cold reps each**, mean ± SD per site — removes the "tabs fought for CPU" objection. |
| `dataset-hq.json` / [`RESULTS-hq.md`](RESULTS-hq.md) | The controlled run's data and write-up. |

## Run it

```bash
node run-bench.mjs                 # full run
node run-bench.mjs --limit 20      # first 20 sites (quick smoke run)
node run-bench.mjs --no-subresources   # skip fetching blocking assets (faster, less precise)
node run-bench.mjs --fcp           # also measure real First Contentful Paint (see below)
node run-bench.mjs --fcp --no-throttle # ...without the ~150 ms-RTT network throttle
node run-bench-hq.mjs              # controlled run: 20 sites, 1 tab at a time, 3 cold reps, mean ± SD
```

`dataset.json`, `dataset.csv`, and `RESULTS.md` are regenerated each run.

## Record schema (`dataset.csv` columns / `dataset.json` `sites[]` keys)

| Field | Meaning |
|---|---|
| `url` | Requested origin. |
| `finalUrl` | URL after redirects (the base for resolving sub-resources). |
| `ok` / `status` | Whether the response was 2xx, and the HTTP status. |
| `documentBytes` | The HTML document's real on-the-wire size in bytes. |
| `encoding` | `content-encoding` of the document (`gzip`, `br`, `identity`, …). |
| `estimated` | `true` if `documentBytes` is a gzip estimate (no usable `content-length`). |
| `fitsBudget` | Whether `documentBytes` ≤ the ~14 KB budget. |
| `pct` | `documentBytes` ÷ budget. |
| `blockingResources` | Count of render-blocking resources found in `<head>`. |
| `blockingBytes` | Summed on-the-wire bytes of those resources (fetched). |
| `predictedRoundTrips` | Model's round-trips to the network floor (`htmlTrips` + `blockingTrips`). |
| `htmlTrips` / `blockingTrips` | Round-trips attributed to the document vs. its blockers. |
| `networkFloorMs` | The network floor in ms — `predictedRoundTrips` × the assumed RTT (150 ms under throttle). |
| `fcpMs` | Real First Contentful Paint (ms) from a headless browser — `null` unless `--fcp`. |
| `paintReadiness` | **Paint Readiness Ratio** = `networkFloorMs ÷ fcpMs`, capped at 1.0. 1.0 = paints at the network floor; low = JS-bound. |
| `error` | Why a site wasn't measured (timeout, block, empty body), else `null`. |

## On honesty

Everything here is **measured, not assumed**:

- `documentBytes` comes from each server's own `content-length` / `content-encoding`.
- `blockingResources` are the resources actually present in the document's `<head>`.
- We send a real browser `User-Agent`, so we measure the document a browser is served.
- Bot-challenge stubs (e.g. empty HTTP 202 bodies) are rejected, not scored as "0 bytes, fits!".

**First-paint timing** (`fcpMs`) is left `null` by default, because true FCP
needs a real browser. Passing `--fcp` drives the system Chrome over the DevTools
Protocol — using Node's built-in WebSocket, no Puppeteer/Playwright and no
Chromium download (set `CHROME_PATH` if your browser is in a non-standard spot)
— under a ~150 ms-RTT throttle, and reads each page's own Paint Timing entry. We
do not invent FCP numbers when we can't measure them; if no browser is found the
run degrades to network-only.

What the committed run found is worth stating plainly: real FCP on popular
homepages averages **~10× the network floor the model predicts and barely
correlates with predicted round-trips** — because first paint on these sites is
gated by client-side JavaScript, not the HTML's first round-trip. `lightsout`
measures the network floor; it does not model the JS that sits on top of it. See
[`RESULTS.md`](RESULTS.md) for the numbers.
