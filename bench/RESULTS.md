# lightsout — validation results

> Generated 2026-06-24T01:57:02.417Z · 103 sites attempted · 84 measured · budget 14336 B (~14 KB).

This table is produced by `bench/run-bench.mjs`, which runs the exact
`lightsout` analysis against real homepages and records what actually
traveled on the wire. The numbers are measured, not assumed.

## Headline

- **18 / 84** measured homepages fit the HTML document in the first round-trip budget (21%).
- Median predicted round-trips to first paint: **4** (mean 4.11).
- **74 / 84** carry at least one render-blocking resource in `<head>`.

## Validation against 77 real sites

Most projects build a model. This one tests the model against reality and publishes the result — including where it fails. We rendered **77** of these sites in a throttled headless Chrome (headless Chrome @ ~150ms RTT / 1.6Mbps) and recorded each one's real Paint Timing First Contentful Paint.

| Metric | Value |
|---|---:|
| Mean network floor (model) | **608 ms** |
| Mean actual FCP (browser) | **6521 ms** |
| Ratio (actual ÷ floor) | **10.7×** |
| Correlation (predicted RTTs ↔ FCP) | **-0.06** |

**The result, in one line: network constraints matter, but JavaScript dominates.**
On popular homepages the network round-trip is *not* the bottleneck for first
paint — client-side JavaScript is. The 14 KB rule removes the network excuse (it
puts the HTML in the browser's hands in the first round-trip), but most sites then
spend seconds executing script before they paint. `lightsout` measures the *network
floor* first paint can't beat; how close a site gets to it is a JavaScript story
this tool deliberately doesn't model.

> ⚠️ **Per-site FCP here is noisy** — these sites render in concurrent throttled
> Chrome tabs sharing one CPU, which inflates the slower ones. For a controlled,
> single-tab, 3-reps-each run with mean ± SD per site, see
> [**RESULTS-hq.md**](RESULTS-hq.md). It confirms the gap is real (not measurement
> noise) but less extreme than this contended run suggests.

### Paint Readiness Ratio

**PRR = network floor ÷ actual FCP** (capped at 1.0). It measures how close a
site gets to painting as soon as the network allows. **1.0** = paints right at the
network floor; **0.05** = the browser waits ~20× longer than the network requires.
Low PRR is the signature of a JavaScript-bound page.

| Closest to the floor (best PRR) | PRR | | Furthest from the floor (worst PRR) | PRR |
|---|---:|---|---|---:|
| dell.com | 1.00 | | reddit.com | 0.01 |
| lyft.com | 1.00 | | outlook.live.com | 0.01 |
| netlify.com | 0.87 | | wikipedia.org | 0.02 |
| mozilla.org | 0.76 | | theguardian.com | 0.03 |
| coursera.org | 0.75 | | open.spotify.com | 0.03 |
| angular.dev | 0.75 | | office.com | 0.03 |
| figma.com | 0.62 | | microsoft.com | 0.03 |
| cloud.google.com | 0.59 | | bestbuy.com | 0.03 |

## Per-site

| Site | Doc (wire) | Fits 14 KB? | Blocking | Floor (RTTs / ms) | Real FCP | PRR |
|---|---:|:---:|---:|---:|---:|---:|
| outlook.live.com | 4.5 KB | ✅ | 0 | 1 / 150 ms | 13.5s | 0.01 |
| reddit.com | 8.2 KB | ✅ | 0 | 1 / 150 ms | 15.4s | 0.01 |
| archive.org | 0.8 KB | ✅ | 1 | 2 / 300 ms | 3.0s | 0.10 |
| bestbuy.com | 1.6 KB | ✅ | 1 | 2 / 300 ms | 10.3s | 0.03 |
| news.ycombinator.com | 5.8 KB | ✅ | 1 | 2 / 300 ms | 1.8s | 0.17 |
| adobe.com | 11.9 KB | ✅ | 1 | 2 / 300 ms | 4.7s | 0.06 |
| medium.com | 13.4 KB | ✅ | 1 | 2 / 300 ms | 5.6s | 0.05 |
| wikipedia.org | 29.9 KB | ❌ | 0 | 2 / 300 ms | 15.3s | 0.02 |
| intel.com | 0.6 KB | ✅ | 3 | 3 / 450 ms | 1.9s | 0.24 |
| open.spotify.com | 2.1 KB | ✅ | 1 | 3 / 450 ms | 16.4s | 0.03 |
| telegram.org | 5.9 KB | ✅ | 2 | 3 / 450 ms | 6.8s | 0.07 |
| jquery.com | 6.4 KB | ✅ | 5 | 3 / 450 ms | 6.5s | 0.07 |
| vuejs.org | 11.4 KB | ✅ | 2 | 3 / 450 ms | 2.1s | 0.21 |
| mit.edu | 11.4 KB | ✅ | 2 | 3 / 450 ms | 2.5s | 0.18 |
| x.com | 12.5 KB | ✅ | 1 | 3 / 450 ms | 6.1s | 0.07 |
| developer.mozilla.org | 13.7 KB | ✅ | 21 | 3 / 450 ms | — | — |
| angular.dev | 14.9 KB | ❌ | 3 | 3 / 450 ms | 0.6s | 0.75 |
| linkedin.com | 15.7 KB | ❌ | 1 | 3 / 450 ms | 1.5s | 0.30 |
| getbootstrap.com | 16.8 KB | ❌ | 3 | 3 / 450 ms | 1.1s | 0.42 |
| mozilla.org | 19.0 KB | ❌ | 11 | 3 / 450 ms | 0.6s | 0.76 |
| svelte.dev | 22.4 KB | ❌ | 6 | 3 / 450 ms | 1.4s | 0.32 |
| paypal.com | 37.1 KB | ❌ | 5 | 3 / 450 ms | 1.8s | 0.26 |
| about.gitlab.com | 38.8 KB | ❌ | 3 | 3 / 450 ms | 2.6s | 0.17 |
| bing.com | 59.5 KB | ❌ | 0 | 3 / 450 ms | 8.0s | 0.06 |
| twitch.tv | 64.5 KB | ❌ | 0 | 3 / 450 ms | 13.6s | 0.03 |
| airbnb.co.in | 90.1 KB | ❌ | 0 | 3 / 450 ms | 8.1s | 0.06 |
| pinterest.com | 97.1 KB | ❌ | 0 | 3 / 450 ms | 13.3s | 0.03 |
| kubernetes.io | 12.6 KB | ✅ | 3 | 4 / 600 ms | — | — |
| microsoft.com | 23.3 KB | ❌ | 8 | 4 / 600 ms | 21.1s | 0.03 |
| wordpress.org | 31.8 KB | ❌ | 8 | 4 / 600 ms | 3.9s | 0.15 |
| tiktok.com | 36.2 KB | ❌ | 9 | 4 / 600 ms | 2.4s | 0.25 |
| apple.com | 41.4 KB | ❌ | 10 | 4 / 600 ms | 5.5s | 0.11 |
| digitalocean.com | 43.2 KB | ❌ | 3 | 4 / 600 ms | 1.8s | 0.33 |
| office.com | 43.4 KB | ❌ | 4 | 4 / 600 ms | 21.4s | 0.03 |
| react.dev | 44.3 KB | ❌ | 1 | 4 / 600 ms | 1.7s | 0.35 |
| duckduckgo.com | 50.4 KB | ❌ | 9 | 4 / 600 ms | 4.4s | 0.14 |
| heroku.com | 50.9 KB | ❌ | 6 | 4 / 600 ms | 1.7s | 0.34 |
| notion.com | 51.1 KB | ❌ | 12 | 4 / 600 ms | 3.6s | 0.17 |
| salesforce.com | 55.5 KB | ❌ | 2 | 4 / 600 ms | 3.8s | 0.16 |
| hp.com | 56.7 KB | ❌ | 3 | 4 / 600 ms | 5.5s | 0.11 |
| nodejs.org | 59.4 KB | ❌ | 5 | 4 / 600 ms | 15.4s | 0.04 |
| dell.com | 62.5 KB | ❌ | 6 | 4 / 600 ms | 0.3s | 1.00 |
| google.com | 65.1 KB | ❌ | 1 | 4 / 600 ms | 15.5s | 0.04 |
| lyft.com | 66.3 KB | ❌ | 1 | 4 / 600 ms | 0.2s | 1.00 |
| shopify.com | 75.6 KB | ❌ | 1 | 4 / 600 ms | 6.3s | 0.10 |
| ebay.com | 78.2 KB | ❌ | 2 | 4 / 600 ms | 4.7s | 0.13 |
| target.com | 87.8 KB | ❌ | 15 | 4 / 600 ms | 9.3s | 0.06 |
| walmart.com | 88.3 KB | ❌ | 1 | 4 / 600 ms | 5.4s | 0.11 |
| bbc.com | 89.3 KB | ❌ | 1 | 4 / 600 ms | — | — |
| trello.com | 98.0 KB | ❌ | 3 | 4 / 600 ms | 4.0s | 0.15 |
| coursera.org | 103.9 KB | ❌ | 0 | 4 / 600 ms | 0.8s | 0.75 |
| instagram.com | 124.7 KB | ❌ | 0 | 4 / 600 ms | 6.3s | 0.10 |
| theguardian.com | 142.6 KB | ❌ | 0 | 4 / 600 ms | 23.8s | 0.03 |
| booking.com | 3.9 KB | ✅ | 1 | 5 / 750 ms | 1.8s | 0.42 |
| soundcloud.com | 12.1 KB | ✅ | 2 | 5 / 750 ms | 6.8s | 0.11 |
| substack.com | 15.4 KB | ❌ | 14 | 5 / 750 ms | 6.6s | 0.11 |
| cisco.com | 24.7 KB | ❌ | 12 | 5 / 750 ms | 5.2s | 0.14 |
| amd.com | 25.7 KB | ❌ | 7 | 5 / 750 ms | 7.1s | 0.10 |
| slack.com | 26.6 KB | ❌ | 12 | 5 / 750 ms | 6.7s | 0.11 |
| zoom.com | 32.3 KB | ❌ | 3 | 5 / 750 ms | 13.0s | 0.06 |
| stanford.edu | 47.2 KB | ❌ | 9 | 5 / 750 ms | 4.4s | 0.17 |
| dropbox.com | 62.4 KB | ❌ | 58 | 5 / 750 ms | 13.3s | 0.06 |
| vercel.com | 69.0 KB | ❌ | 5 | 5 / 750 ms | — | — |
| khanacademy.org | 99.0 KB | ❌ | 1 | 5 / 750 ms | 1.4s | 0.54 |
| wordpress.com | 101.8 KB | ❌ | 2 | 5 / 750 ms | 5.1s | 0.15 |
| docker.com | 104.3 KB | ❌ | 9 | 5 / 750 ms | — | — |
| netlify.com | 108.3 KB | ❌ | 7 | 5 / 750 ms | 0.9s | 0.87 |
| forbes.com | 117.9 KB | ❌ | 1 | 5 / 750 ms | 17.3s | 0.04 |
| stripe.com | 147.0 KB | ❌ | 6 | 5 / 750 ms | 3.7s | 0.20 |
| yahoo.com | 175.8 KB | ❌ | 10 | 5 / 750 ms | 6.7s | 0.11 |
| tailwindcss.com | 187.3 KB | ❌ | 3 | 5 / 750 ms | 5.3s | 0.14 |
| discord.com | 24.4 KB | ❌ | 5 | 6 / 900 ms | 14.1s | 0.06 |
| azure.microsoft.com | 54.6 KB | ❌ | 22 | 6 / 900 ms | — | — |
| aws.amazon.com | 61.9 KB | ❌ | 14 | 6 / 900 ms | — | — |
| nvidia.com | 85.4 KB | ❌ | 11 | 6 / 900 ms | 7.2s | 0.13 |
| github.com | 120.2 KB | ❌ | 29 | 6 / 900 ms | 3.7s | 0.24 |
| youtube.com | 212.2 KB | ❌ | 12 | 6 / 900 ms | 6.1s | 0.15 |
| atlassian.com | 223.4 KB | ❌ | 4 | 6 / 900 ms | 3.9s | 0.23 |
| figma.com | 256.5 KB | ❌ | 2 | 6 / 900 ms | 1.5s | 0.62 |
| cloud.google.com | 278.3 KB | ❌ | 1 | 6 / 900 ms | 1.5s | 0.59 |
| cloudflare.com | 282.8 KB | ❌ | 3 | 6 / 900 ms | 2.1s | 0.43 |
| nytimes.com | 342.0 KB | ❌ | 100 | 6 / 900 ms | 2.9s | 0.31 |
| washingtonpost.com | 461.9 KB | ❌ | 1 | 7 / 1050 ms | 17.6s | 0.06 |
| edition.cnn.com | 530.0 KB | ❌ | 1 | 7 / 1050 ms | 3.2s | 0.33 |

## Not measured

- `facebook.com` — HTTP 400
- `amazon.com` — empty/challenge body (HTTP 202, 0 B)
- `netflix.com` — fetch failed
- `bloomberg.com` — HTTP 403
- `wsj.com` — HTTP 401
- `espn.com` — empty/challenge body (HTTP 202, 0 B)
- `imdb.com` — empty/challenge body (HTTP 202, 0 B)
- `oracle.com` — HTTP 403
- `ibm.com` — HTTP 404
- `stackoverflow.com` — HTTP 403
- `w3.org` — HTTP 403
- `npmjs.com` — HTTP 403
- `quora.com` — HTTP 403
- `etsy.com` — HTTP 403
- `expedia.com` — HTTP 429
- `uber.com` — empty/challenge body (HTTP 406, 14 B)
- `whatsapp.com` — HTTP 400
- `canva.com` — HTTP 403
- `udemy.com` — HTTP 403

## How to reproduce

```bash
node bench/run-bench.mjs            # full run, writes dataset.json/.csv + this file
node bench/run-bench.mjs --fcp      # also measure real First Contentful Paint in a throttled headless Chrome
```
