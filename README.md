# lightsout

**The network-floor analyzer: the earliest point at which the network allows your page to paint.**

`lightsout` computes one honest, defensible number — the **network floor** — and is
careful about what that number is *not*. It is **not** a prediction of when your
page actually paints. It is the earliest first paint the *network* permits; real
first paint is usually later, gated by JavaScript. We know that because we
[**validated it against 77 real sites**](#validation-against-77-real-sites-the-centerpiece)
— actual FCP ran **~10× later** than the floor and barely correlated with it.

When a browser opens a TCP connection, the server can't send data at full speed
right away — it has to probe the network with "slow start". The first burst it's
allowed to send before waiting for an acknowledgment is the *initial congestion
window*, ~10 packets on modern servers:

```
10 packets × ~1460 B payload  ≈  14,600 bytes  ≈  "14 KB"
```

If your **gzipped HTML document** fits in that ~14 KB window, the browser gets
the whole thing in the **first round-trip** and can start painting immediately.
Bust it, and the network *floor* rises by a round-trip (50–200 ms on real mobile)
before anything *can* appear.

`lightsout` measures that for you — and, crucially, separates two things most
size tools conflate:

1. **The HTML document** vs the 14 KB budget. *This is the verdict.*
2. **Render-blocking resources** in `<head>` (stylesheets, synchronous scripts).
   These don't add to the 14 KB — the browser can't even discover them until the
   HTML arrives — but each one costs an **additional round-trip** before first
   paint. `lightsout` lists them separately, because that's how loading really
   works.

Then it models the whole thing as a **round-trip waterfall**: how many network
round-trips first paint actually costs, accounting for TCP slow-start (the
congestion window roughly doubles each trip, so a doc bigger than 14 KB can
still arrive in 2 trips, and render-blocking resources fetched in parallel add
their own).

## Install

```bash
npm i -g @fourdoorsmorewhoes/lightsout    # then the command is `lightsout`
# or run without installing:  npx @fourdoorsmorewhoes/lightsout <url> --fcp
```

## Usage

```bash
lightsout https://example.com               # network floor + document evidence
lightsout https://example.com --fcp         # + real FCP, paint readiness, classification
lightsout scan ./my-project                 # analyze your codebase directly (most accurate)
lightsout --file ./index.html               # measure a local HTML file
lightsout https://x.com --budget 14336      # override the byte budget
lightsout https://x.com --rtt 100           # assume a 100 ms RTT for the floor
lightsout https://x.com --json              # machine-readable, for CI
```

### `lightsout scan` — analyze the project, not a black-box URL

A live fetch can't tell a client-rendered SPA from a server-rendered page, can't
see your build setup, and can't read the bundle a runtime injects. Running inside
the project lifts all three blind spots — it reads `package.json` (framework +
render strategy), the HTML entry/build output, and the **actual JS/CSS from disk**
to give accurate, framework-aware advice:

```
  lightsout scan — /path/to/my-spa
  ══════════════════════════════════════════════════════
  framework          React  ·  Vite
  render strategy    React SPA — likely client-rendered
  network floor      300 ms   (2 round-trips @ 150 ms RTT)
  javascript         69.0 KB gzip   (all scripts the page loads)
  rendering          ❌ client-rendered shell (only ~0 chars of static content in <body>)

  recommendations:
    ⛔ [architectural] client-rendered SPA — first paint waits on the JS bundle (69 KB gzip)
        …no 14 KB tweak reaches the floor while rendering is client-side. Fix:
        add a prerender/SSG step (vite-plugin-ssr, vite-react-ssg) or move to Astro.
```

Every recommendation is graded by risk (**✓ safe**, **⚠ caution**, **⛔ architectural**)
and the fix is tailored to your stack (CRA → react-snap; Vite → vite-ssg; Svelte →
SvelteKit prerender; …). Pair it with `lightsout <url> --fcp` for the measured PRR.

The URL output **leads with paint efficiency** and treats the byte budget as a
*diagnostic, not a verdict* — because a passing budget barely predicts early
paint (Spotify fits and is awful; Figma busts and is excellent):

```
  lightsout — https://www.spotify.com
  ══════════════════════════════════════════════════════
  paint efficiency   ❌ JS-bound
  PRR                0.03   paint waits 10×+ the floor; the HTML budget is irrelevant here

  network floor      450 ms     (3 round-trips @ 150 ms RTT)
  actual FCP      13,500 ms     (measured in headless Chrome)

  document (diagnostic, not a verdict)
    19.71 KB (gzip~ est.) — spills past the first window — adds 1 round-trip to the floor
```

Same tool, a site that does it right:

```
  lightsout — https://www.dell.com --fcp
  paint efficiency   ✅ Floor-limited
  PRR                1.00
  network floor      600 ms
  actual FCP         292 ms     (measured in headless Chrome)
```

### Interactive explorer (TUI)

```bash
npx lightsout-tui        # or: npm run tui
```

A zero-dependency terminal UI: a colour-coded PRR leaderboard from the committed
benchmark (Floor-limited green → JS-bound red), plus a live analyzer — type a URL
(or press ⏎ on a row) and it renders the page in headless Chrome and animates a
floor-vs-FCP gauge where the floor bar's length *is* the PRR. `lightsout-tui
--selftest` prints one static frame (handy for non-TTY/screenshots).

### Paint Readiness Ratio & classification

```
PRR = network floor ÷ actual FCP   (capped at 1.0)
```

| PRR | Classification | Meaning |
|---|---|---|
| ≥ 0.8 | **Floor-limited** | paints at the network floor — the network is the only cost left |
| 0.5–0.8 | **Efficient** | paints close to the floor; little JS in the way |
| 0.2–0.5 | **Moderately delayed** | real paint runs a few× past the floor |
| 0.1–0.2 | **JS-taxed** | the browser waits 5–10× the floor — JavaScript is the bottleneck |
| < 0.1 | **JS-bound** | paint waits 10×+ the floor; the HTML budget is irrelevant here |

`--fcp` drives the system Chrome over the DevTools Protocol (no Puppeteer, no
install) under a `--rtt` throttle and reads the page's real Paint Timing entry.
Without `--fcp` you still get the network floor and document evidence; PRR needs
a real render.

Exit code is `1` when the HTML document busts the budget, so `lightsout` still
works as a **CI page-weight gate**.

### Honest measurement

The number that matters is what actually travels. For a live URL, `lightsout`
reads the server's real `content-encoding` / `content-length` and reports *those*
bytes. Only when the server doesn't expose a usable length (e.g. compressed
chunked responses) does it fall back to a gzip estimate — and it labels that
with `est.` so you always know which number you're looking at.

## As a library

```js
import { analyze } from "lightsout";

const html = await (await fetch("https://example.com")).text();
const report = await analyze(html, { baseUrl: "https://example.com" });
// → {
//     budget,
//     document:     { gzip, raw, wire, encoding, estimated, fits, pct },
//     blocking:     [ { type, url, wire, gzip, encoding, estimated } ],
//     criticalPath: { roundTrips, htmlTrips, blockingTrips, networkFloorMs },
//   }
// networkFloorMs = roundTrips × the assumed RTT (`rtt` option, default 150 ms) —
// the earliest first paint the network allows, NOT a prediction of actual FCP.
```

Turn a real First Contentful Paint into a paint-readiness verdict:

```js
import { paintReadiness, classifyPRR } from "lightsout";

const prr = paintReadiness(report.criticalPath.networkFloorMs, fcpMs); // floor ÷ FCP, capped at 1
classifyPRR(prr).label; // → "Floor-limited" | "Efficient" | … | "JS-bound"
```

To measure `fcpMs` yourself without Puppeteer, the package also ships a headless
Chrome driver: `import { launchBrowser } from "lightsout/cdp"` (used by `--fcp`).

## GitHub Action

Gate every pull request on the budget. The action wraps the same analysis and
writes a render-blocking breakdown to the PR's job summary; it fails the job
when the HTML document busts the first round-trip (toggle with `fail-on-bust`).

```yaml
# .github/workflows/lightsout.yml
name: lightsout
on: pull_request
jobs:
  budget:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: lightsout/action@v1
        with:
          file: dist/index.html         # …or  url: https://your-preview-deploy
          # budget: 14336               # optional (default ~14 KB)
          # fail-on-bust: true          # optional (default true)
```

Outputs `fits`, `document-bytes`, and `round-trips` for downstream steps. A full
example lives in [`examples/github-workflow.yml`](examples/github-workflow.yml).

## Validation against 77 real sites (the centerpiece)

Most projects build a model. Far fewer test the model against reality and publish
the result — including where it fails. That's the most interesting thing here.

[`bench/`](bench/) runs the exact `lightsout` analysis across ~100 popular
homepages, then renders the reachable ones in a throttled headless Chrome
(~150 ms RTT) and records each page's **real First Contentful Paint** from the
Paint Timing API. Everything is measured and committed — see
[`bench/RESULTS.md`](bench/RESULTS.md) and [`bench/dataset.csv`](bench/dataset.csv).

| Metric | Value |
|---|---:|
| Mean network floor (model) | **608 ms** |
| Mean actual FCP (browser) | **6,521 ms** |
| Ratio (actual ÷ floor) | **10.7×** |
| Correlation (predicted RTTs ↔ FCP) | **≈ 0** |

**The finding: network constraints matter, but JavaScript dominates.** Real first
paint runs well past the network floor and barely tracks it, because popular
homepages paint when their JavaScript is ready — not when the HTML arrives. The
14 KB rule removes the *network* excuse; it does nothing about the JS.

> **Controlled re-run (to kill the "noisy measurement" objection).** The table
> above renders many sites in concurrent throttled Chrome tabs, so per-site FCP is
> noisy. A separate [high-quality run](bench/RESULTS-hq.md) — 20 sites, **one tab
> at a time, 3 cold reps each** — shows the repetition noise is tiny (median
> per-site PRR SD ≈ **0.02**), so the floor-vs-paint gap is *real, not an
> artifact*. It also corrects the picture: free of CPU contention, **mean PRR is
> ~0.46**, not the contended run's ~0.14. Some sites (google, dell, figma) paint
> *right at* the floor; the JS-bound tail (spotify 0.03, x 0.07, github/microsoft
> 0.10) is genuine and stable. JavaScript dominates *where it dominates* — and the
> clean numbers say exactly where.

### Paint Readiness Ratio (PRR)

A single number that falls straight out of the benchmark and exposes JS-bound
sites instantly:

```
PRR  =  network floor  ÷  actual FCP        (capped at 1.0)
```

**1.0** means the page paints as soon as the network permits. **0.05** means the
browser waits ~20× longer than the network requires — a JavaScript-bound page.

| Paints near the floor | PRR | | Waits on JavaScript | PRR |
|---|---:|---|---|---:|
| dell.com | ~1.00 | | reddit.com | ~0.01 |
| lyft.com | ~1.00 | | outlook.live.com | ~0.01 |
| figma.com | ~0.62 | | wikipedia.org | ~0.02 |
| mozilla.org | ~0.76 | | open.spotify.com | ~0.03 |

> Figma succeeds not because it is small (257 KB doc, 6-RTT floor) but because it
> *paints early*. SoundCloud's document fits the 14 KB budget and still paints
> ~20× past its floor. Small and early are different goals — PRR measures the one
> that matters. (Per-site FCP is noisy under concurrent throttled tabs; the
> aggregate and the high/low split are the robust signal.)

Reproduce it:

```bash
npm run bench                      # network layer only — writes dataset.json/.csv + RESULTS.md
node bench/run-bench.mjs --fcp     # also measure real FCP + PRR in headless Chrome
```

## Why this exists

Inspired by
[“Why your website should be under 14 kB in size”](https://endtimes.dev/why-your-website-should-be-under-14kb-in-size/).
That article explains the rule. This tool started out trying to *enforce* it as a
performance predictor — then the [benchmark](#validation-against-77-real-sites-the-centerpiece)
showed that the network round-trip isn't what makes real pages slow to paint. So
it makes a narrower, defensible claim instead: it reports the **network floor**,
the earliest paint the network allows, and is explicit that JavaScript is what
usually keeps a page from reaching it.

## License

MIT
