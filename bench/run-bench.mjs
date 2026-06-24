#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, measureResponse, DEFAULT_BUDGET, DEFAULT_RTT_MS } from "../src/analyze.mjs";
import { launchBrowser } from "../src/cdp-fcp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const o = { limit: Infinity, subresources: true, fcp: false, throttle: true, concurrency: 8, timeout: 20000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") o.limit = Number(argv[++i]);
    else if (a === "--no-subresources") o.subresources = false;
    else if (a === "--fcp") o.fcp = true;
    else if (a === "--no-throttle") o.throttle = false;
    else if (a === "--concurrency") o.concurrency = Number(argv[++i]);
    else if (a === "--timeout") o.timeout = Number(argv[++i]);
  }
  return o;
}

const THROTTLE = { latencyMs: 150, downloadKbps: 1600, uploadKbps: 750 };

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchWithTimeout(url, ms, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": UA }, ...init });
  } finally {
    clearTimeout(t);
  }
}

async function measureSite(url, opts) {
  const base = { url, finalUrl: null, ok: false, status: null, documentBytes: null, encoding: null, estimated: null, fitsBudget: null, pct: null, blockingResources: null, blockingBytes: null, predictedRoundTrips: null, htmlTrips: null, blockingTrips: null, networkFloorMs: null, fcpMs: null, paintReadiness: null, error: null };
  try {
    const r = await fetchWithTimeout(url, opts.timeout);
    const html = await r.text();

    if (Buffer.byteLength(html) < 256 || !/<\s*(!doctype|html|head|body|meta)/i.test(html)) {
      base.finalUrl = r.url;
      base.status = r.status;
      base.error = `empty/challenge body (HTTP ${r.status}, ${Buffer.byteLength(html)} B)`;
      return base;
    }
    const documentWire = measureResponse(r.headers, html);
    const report = await analyze(html, {
      baseUrl: r.url,
      budget: DEFAULT_BUDGET,
      documentWire,
      fetchBlocking: opts.subresources,
      rtt: opts.throttle ? THROTTLE.latencyMs : DEFAULT_RTT_MS,
    });
    const okBlocking = report.blocking.filter((b) => !b.error);
    Object.assign(base, {
      finalUrl: r.url,
      ok: r.ok,
      status: r.status,
      documentBytes: report.document.wire,
      encoding: report.document.encoding,
      estimated: report.document.estimated,
      fitsBudget: report.document.fits,
      pct: Number(report.document.pct.toFixed(4)),
      blockingResources: report.blocking.length,
      blockingBytes: okBlocking.reduce((s, b) => s + (b.wire ?? b.gzip ?? b.raw ?? 0), 0),
      predictedRoundTrips: report.criticalPath.roundTrips,
      htmlTrips: report.criticalPath.htmlTrips,
      blockingTrips: report.criticalPath.blockingTrips,
      networkFloorMs: report.criticalPath.networkFloorMs,
    });
  } catch (e) {
    base.error = e.name === "AbortError" ? `timeout after ${opts.timeout}ms` : e.message;
  }
  return base;
}

function toCsv(rows) {
  const cols = ["url", "finalUrl", "ok", "status", "documentBytes", "encoding", "estimated", "fitsBudget", "pct", "blockingResources", "blockingBytes", "predictedRoundTrips", "htmlTrips", "blockingTrips", "networkFloorMs", "fcpMs", "paintReadiness", "error"];
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

const kb = (n) => (n == null ? "—" : `${(n / 1024).toFixed(1)} KB`);

function buildResultsMd(rows, meta) {
  const ok = rows.filter((r) => r.ok && !r.error);
  const fit = ok.filter((r) => r.fitsBudget);
  const sorted = [...ok].sort((a, b) => a.predictedRoundTrips - b.predictedRoundTrips || a.documentBytes - b.documentBytes);
  const haveFcp = ok.filter((r) => r.fcpMs != null);

  const lines = [];
  lines.push("# lightsout — validation results");
  lines.push("");
  lines.push(`> Generated ${meta.generatedAt} · ${rows.length} sites attempted · ${ok.length} measured · budget ${DEFAULT_BUDGET} B (~14 KB).`);
  lines.push("");
  lines.push("This table is produced by `bench/run-bench.mjs`, which runs the exact");
  lines.push("`lightsout` analysis against real homepages and records what actually");
  lines.push("traveled on the wire. The numbers are measured, not assumed.");
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push(`- **${fit.length} / ${ok.length}** measured homepages fit the HTML document in the first round-trip budget (${(100 * fit.length / Math.max(1, ok.length)).toFixed(0)}%).`);
  const avgRtt = ok.reduce((s, r) => s + r.predictedRoundTrips, 0) / Math.max(1, ok.length);
  lines.push(`- Median predicted round-trips to first paint: **${median(ok.map((r) => r.predictedRoundTrips))}** (mean ${avgRtt.toFixed(2)}).`);
  const blockers = ok.filter((r) => r.blockingResources > 0).length;
  lines.push(`- **${blockers} / ${ok.length}** carry at least one render-blocking resource in \`<head>\`.`);
  lines.push("");
  const havePrr = ok.filter((r) => r.paintReadiness != null);
  if (haveFcp.length) {
    const c = correlation(haveFcp.map((r) => r.predictedRoundTrips), haveFcp.map((r) => r.fcpMs));
    const meanFloorMs = haveFcp.reduce((s, r) => s + (r.networkFloorMs ?? 0), 0) / haveFcp.length;
    const meanFcpMs = haveFcp.reduce((s, r) => s + r.fcpMs, 0) / haveFcp.length;
    lines.push(`## Validation against ${haveFcp.length} real sites`);
    lines.push("");
    lines.push(`Most projects build a model. This one tests the model against reality and publishes the result — including where it fails. We rendered **${haveFcp.length}** of these sites in a throttled headless Chrome (${meta.options.fcpMethod}) and recorded each one's real Paint Timing First Contentful Paint.`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---:|");
    lines.push(`| Mean network floor (model) | **${Math.round(meanFloorMs)} ms** |`);
    lines.push(`| Mean actual FCP (browser) | **${Math.round(meanFcpMs)} ms** |`);
    lines.push(`| Ratio (actual ÷ floor) | **${(meanFcpMs / meanFloorMs).toFixed(1)}×** |`);
    lines.push(`| Correlation (predicted RTTs ↔ FCP) | **${c.toFixed(2)}** |`);
    lines.push("");
    lines.push("**The result, in one line: network constraints matter, but JavaScript dominates.**");
    lines.push("On popular homepages the network round-trip is *not* the bottleneck for first");
    lines.push("paint — client-side JavaScript is. The 14 KB rule removes the network excuse (it");
    lines.push("puts the HTML in the browser's hands in the first round-trip), but most sites then");
    lines.push("spend seconds executing script before they paint. `lightsout` measures the *network");
    lines.push("floor* first paint can't beat; how close a site gets to it is a JavaScript story");
    lines.push("this tool deliberately doesn't model.");
    lines.push("");
    lines.push("> ⚠️ **Per-site FCP here is noisy** — these sites render in concurrent throttled");
    lines.push("> Chrome tabs sharing one CPU, which inflates the slower ones. For a controlled,");
    lines.push("> single-tab, 3-reps-each run with mean ± SD per site, see");
    lines.push("> [**RESULTS-hq.md**](RESULTS-hq.md). It confirms the gap is real (not measurement");
    lines.push("> noise) but less extreme than this contended run suggests.");
    lines.push("");
  }
  if (havePrr.length) {
    lines.push("### Paint Readiness Ratio");
    lines.push("");
    lines.push("**PRR = network floor ÷ actual FCP** (capped at 1.0). It measures how close a");
    lines.push("site gets to painting as soon as the network allows. **1.0** = paints right at the");
    lines.push("network floor; **0.05** = the browser waits ~20× longer than the network requires.");
    lines.push("Low PRR is the signature of a JavaScript-bound page.");
    lines.push("");
    const ranked = [...havePrr].sort((a, b) => b.paintReadiness - a.paintReadiness);
    const top = ranked.slice(0, 8);
    const bottom = ranked.slice(-8).reverse();
    lines.push("| Closest to the floor (best PRR) | PRR | | Furthest from the floor (worst PRR) | PRR |");
    lines.push("|---|---:|---|---|---:|");
    for (let i = 0; i < Math.max(top.length, bottom.length); i++) {
      const t = top[i], b = bottom[i];
      lines.push(`| ${t ? hostname(t.finalUrl || t.url) : ""} | ${t ? t.paintReadiness.toFixed(2) : ""} | | ${b ? hostname(b.finalUrl || b.url) : ""} | ${b ? b.paintReadiness.toFixed(2) : ""} |`);
    }
    lines.push("");
  }
  lines.push("## Per-site");
  lines.push("");
  const head = haveFcp.length
    ? "| Site | Doc (wire) | Fits 14 KB? | Blocking | Floor (RTTs / ms) | Real FCP | PRR |"
    : "| Site | Doc (wire) | Fits 14 KB? | Blocking | Floor (RTTs / ms) |";
  const sep = haveFcp.length ? "|---|---:|:---:|---:|---:|---:|---:|" : "|---|---:|:---:|---:|---:|";
  lines.push(head);
  lines.push(sep);
  for (const r of sorted) {
    const host = hostname(r.finalUrl || r.url);
    const fits = r.fitsBudget ? "✅" : "❌";
    const floor = `${r.predictedRoundTrips} / ${r.networkFloorMs} ms`;
    const cells = [host, kb(r.documentBytes), fits, String(r.blockingResources), floor];
    if (haveFcp.length) {
      cells.push(r.fcpMs != null ? `${(r.fcpMs / 1000).toFixed(1)}s` : "—");
      cells.push(r.paintReadiness != null ? r.paintReadiness.toFixed(2) : "—");
    }
    lines.push("| " + cells.join(" | ") + " |");
  }
  const failed = rows.filter((r) => r.error || !r.ok);
  if (failed.length) {
    lines.push("");
    lines.push("## Not measured");
    lines.push("");
    for (const r of failed) lines.push(`- \`${hostname(r.url)}\` — ${r.error || `HTTP ${r.status}`}`);
  }
  lines.push("");
  lines.push("## How to reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("node bench/run-bench.mjs            # full run, writes dataset.json/.csv + this file");
  lines.push("node bench/run-bench.mjs --fcp      # also measure real First Contentful Paint in a throttled headless Chrome");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function hostname(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function correlation(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { sites } = JSON.parse(await readFile(join(HERE, "sites.json"), "utf8"));
  const targets = sites.slice(0, opts.limit);

  console.error(`lightsout-bench: measuring ${targets.length} sites (concurrency ${opts.concurrency}, subresources ${opts.subresources ? "on" : "off"}${opts.fcp ? `, fcp via headless Chrome${opts.throttle ? " @ ~150ms RTT" : " (unthrottled)"}` : ""})…`);

  // For real First Contentful Paint we drive one headless Chrome and open a tab
  // per site. If Chrome can't be found, we degrade to network-only rather than fail.
  let browser = null;
  if (opts.fcp) {
    try {
      browser = await launchBrowser();
    } catch (e) {
      console.error(`  fcp disabled: ${e.message}`);
    }
  }

  let done = 0;
  const rows = await mapLimit(targets, opts.concurrency, async (url) => {
    const row = await measureSite(url, opts);
    if (browser && row.ok) {
      row.fcpMs = await browser.measureFcp(row.finalUrl || url, {
        timeout: Math.max(opts.timeout, 25000),
        throttle: opts.throttle ? THROTTLE : null,
      });

      if (row.fcpMs != null && row.fcpMs > 0 && row.networkFloorMs != null) {
        row.paintReadiness = Number(Math.min(1, row.networkFloorMs / row.fcpMs).toFixed(3));
      }
    }
    done++;
    const fcpTag = row.fcpMs != null ? ` · FCP ${(row.fcpMs / 1000).toFixed(1)}s` : "";
    const tag = row.error
      ? `✗ ${row.error}`
      : !row.ok
        ? `✗ HTTP ${row.status}`
        : `${row.fitsBudget ? "fits" : "busts"} · ${kb(row.documentBytes)} · ${row.predictedRoundTrips} RTT${fcpTag}`;
    console.error(`  [${String(done).padStart(3)}/${targets.length}] ${hostname(url).padEnd(24)} ${tag}`);
    return row;
  });

  if (browser) await browser.close();

  const meta = { generatedAt: new Date().toISOString(), budget: DEFAULT_BUDGET, count: rows.length, options: { subresources: opts.subresources, fcp: opts.fcp && !!browser, fcpMethod: opts.fcp && browser ? `headless Chrome${opts.throttle ? " @ ~150ms RTT / 1.6Mbps" : " (unthrottled)"}` : null } };
  const dataset = { ...meta, sites: rows };

  await writeFile(join(HERE, "dataset.json"), JSON.stringify(dataset, null, 2) + "\n");
  await writeFile(join(HERE, "dataset.csv"), toCsv(rows));
  await writeFile(join(HERE, "RESULTS.md"), buildResultsMd(rows, meta));

  const ok = rows.filter((r) => r.ok && !r.error);
  const fit = ok.filter((r) => r.fitsBudget).length;
  console.error(`\nDone. ${ok.length}/${rows.length} measured; ${fit} fit the 14 KB budget.`);
  console.error("Wrote bench/dataset.json, bench/dataset.csv, bench/RESULTS.md");
}

main().catch((e) => {
  console.error("bench failed:", e);
  process.exit(1);
});
