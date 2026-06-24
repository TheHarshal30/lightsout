#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { analyze, measureResponse, paintReadiness, classifyPRR, DEFAULT_BUDGET, DEFAULT_RTT_MS } from "../src/analyze.mjs";

function parseArgs(argv) {
  const opts = { budget: DEFAULT_BUDGET, rtt: DEFAULT_RTT_MS, json: false, fcp: false, file: null, target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--fcp") opts.fcp = true;
    else if (a === "--budget") opts.budget = Number(argv[++i]);
    else if (a === "--rtt") opts.rtt = Number(argv[++i]);
    else if (a === "--file") opts.file = argv[++i];
    else opts.target = a;
  }
  return opts;
}

const fmt = (n) => `${n.toLocaleString()} B`;
const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
const ms = (n) => `${Math.round(n).toLocaleString()} ms`;

const resSize = (b) => b.wire ?? b.gzip ?? b.raw ?? 0;

const CLASS_ICON = { "Floor-limited": "✅", Efficient: "✅", "Moderately delayed": "⚠️ ", "JS-taxed": "⚠️ ", "JS-bound": "❌" };

async function measureFcp(url, rtt) {
  const { launchBrowser } = await import("../src/cdp-fcp.mjs");
  const browser = await launchBrowser();
  try {
    return await browser.measureFcp(url, { throttle: { latencyMs: rtt, downloadKbps: 1600, uploadKbps: 750 } });
  } finally {
    await browser.close();
  }
}

const RISK_ICON = { safe: "✓", caution: "⚠", architectural: "⛔" };

async function runScan(args) {
  const { scanProject } = await import("../src/scan.mjs");
  let dir = ".", json = false, rtt = DEFAULT_RTT_MS;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--rtt") rtt = Number(args[++i]);
    else dir = args[i];
  }
  const report = await scanProject(dir, { rtt });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.error ? 2 : 0);
  }
  if (report.error) {
    console.error(`lightsout scan: ${report.error}`);
    process.exit(2);
  }

  const p = report.project, cp = report.criticalPath, d = report.document;
  console.log(`\n  lightsout scan — ${report.root}`);
  console.log("  " + "═".repeat(54));
  console.log(`  project            ${p.name || "(unnamed)"}`);
  console.log(`  framework          ${p.framework || "none detected"}${p.bundler ? `  ·  ${p.bundler}` : ""}`);
  console.log(`  render strategy    ${p.strategy}`);
  console.log(`  html entry         ${report.entry.rel} (${report.entry.kind})`);
  console.log();
  console.log(`  network floor      ${ms(cp.networkFloorMs)}   (${cp.roundTrips} round-trip${cp.roundTrips === 1 ? "" : "s"} @ ${rtt} ms RTT)`);
  console.log(`  document           ${kb(d.gzip)} gzip   ${d.fits ? "fits the first window" : "spills past the first window"}`);
  if (report.jsWeightGzip) console.log(`  javascript         ${kb(report.jsWeightGzip)} gzip   (all scripts the page loads)`);
  if (report.csr.isCsr) {
    console.log(`  rendering          ❌ client-rendered shell (only ~${report.csr.visibleChars} chars of static content in <body>)`);
  } else {
    console.log(`  rendering          ✓ static content present in <body> (${report.csr.visibleChars} chars)`);
  }

  if (report.resources.length) {
    console.log(`\n  render-blocking in <head>:`);
    for (const r of report.resources) {
      const where = r.external ? "(external — can't read)" : `${kb((r.gzip || 0))} gzip`;
      console.log(`    [${r.type}] ${r.external ? r.url : r.rel}  ${where}`);
    }
  }

  if (report.advice.length) {
    const order = { architectural: 0, caution: 1, safe: 2 };
    report.advice.sort((a, b) => (order[a.risk] ?? 3) - (order[b.risk] ?? 3));
    console.log(`\n  recommendations:`);
    for (const a of report.advice) {
      console.log(`    ${RISK_ICON[a.risk] ?? "•"} [${a.risk}] ${a.title}`);
      if (a.detail) console.log(`        ${a.detail}`);
    }
  }
  console.log(`\n  (static analysis — no network, no browser. For the measured PRR, run: lightsout <url> --fcp)\n`);
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === "scan") return runScan(argv.slice(1));

  const opts = parseArgs(argv);
  if (!opts.target && !opts.file) {
    console.error("usage:\n  lightsout <url> [--fcp] [--budget N] [--rtt N] [--json]   analyze a live URL\n  lightsout --file <path.html>                            analyze a local HTML file\n  lightsout scan [dir]                                    analyze a project on disk");
    process.exit(2);
  }

  let html, baseUrl, documentWire = null;
  if (opts.file) {
    html = await readFile(opts.file, "utf8");
    baseUrl = null;
  } else {
    const r = await fetch(opts.target, { redirect: "follow" });
    html = await r.text();
    baseUrl = r.url;
    documentWire = measureResponse(r.headers, html);
  }

  const report = await analyze(html, { baseUrl, budget: opts.budget, documentWire, rtt: opts.rtt });
  const d = report.document;
  const cp = report.criticalPath;

  let fcpMs = null, prr = null, cls = null;
  if (opts.fcp) {
    if (!baseUrl) {
      console.error("lightsout: --fcp needs a URL to render (not a local --file).");
    } else {
      fcpMs = await measureFcp(baseUrl, opts.rtt);
      prr = paintReadiness(cp.networkFloorMs, fcpMs);
      cls = classifyPRR(prr);
    }
  }

  report.paint = { rttMs: opts.rtt, fcpMs, paintReadiness: prr == null ? null : Number(prr.toFixed(3)), classification: cls?.label ?? null };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(d.fits ? 0 : 1);
  }

  const tripWord = cp.roundTrips === 1 ? "round-trip" : "round-trips";
  console.log(`\n  lightsout — ${opts.file || opts.target}`);
  console.log("  " + "═".repeat(54));

  if (prr != null) {
    const icon = CLASS_ICON[cls.label] ?? "";
    console.log(`  paint efficiency   ${icon} ${cls.label}`);
    console.log(`  PRR                ${prr.toFixed(2)}   ${cls.hint}`);
  } else if (opts.fcp && baseUrl) {
    console.log(`  paint efficiency   — page never painted within the timeout`);
  } else {
    console.log(`  paint efficiency   — run with --fcp to measure (renders in headless Chrome)`);
  }
  console.log();

  console.log(`  network floor      ${ms(cp.networkFloorMs)}   (${cp.roundTrips} ${tripWord} @ ${opts.rtt} ms RTT)`);
  if (prr != null) {
    console.log(`  actual FCP         ${ms(fcpMs)}   (measured in headless Chrome)`);
  } else {
    console.log(`  actual FCP         —   (the floor is the earliest paint the network allows;`);
    console.log(`                         real FCP can run far later — JS, hydration, server work)`);
  }
  console.log();

  const enc = d.estimated ? `${d.encoding} est.` : d.encoding;
  const spill = cp.htmlTrips - 1;
  const windowNote = d.fits
    ? "fits the first congestion window (~14 KB) — arrives in one round-trip"
    : `spills past the first window — adds ${spill} ${spill === 1 ? "round-trip" : "round-trips"} to the floor`;
  console.log("  document (diagnostic, not a verdict)");
  console.log(`    ${kb(d.wire)} (${enc}), ${fmt(d.wire)} — ${windowNote}`);

  const htmlTripLabel = cp.htmlTrips > 1 ? `trips 1-${cp.htmlTrips}` : "trip 1";
  console.log(`    floor breakdown:`);
  console.log(`      ${htmlTripLabel.padEnd(10)} HTML document${cp.htmlTrips > 1 ? " (too big for one window)" : ""}  ${kb(d.wire)}`);
  const okBlk = report.blocking.filter((b) => !b.error);
  const failed = report.blocking.filter((b) => b.error);
  if (report.blocking.length) {
    const from = cp.htmlTrips + 1;
    const to = cp.roundTrips;
    const label = to > from ? `trips ${from}-${to}` : `trip ${from}`;
    console.log(`      ${label.padEnd(10)} render-blocking in <head>, fetched in parallel:`);
    for (const b of report.blocking) {
      const tag = `[${b.type}${b.type === "js" ? ", sync" : ""}]`;
      const measured = b.wire != null || b.gzip != null;
      const size = b.error ? `(${b.error})` : measured ? `${kb(resSize(b))}${b.estimated ? " est." : ""}` : "(size unknown — local file)";
      console.log(`                   ${tag.padEnd(12)} ${b.url}  ${size}`);
    }
  }
  console.log();

  const RISK = {
    safe: { icon: "✓", label: "safe" },
    caution: { icon: "⚠", label: "caution" },
    architectural: { icon: "⛔", label: "architectural" },
  };
  const advice = [...(report.advice || [])];
  if (cls && cls.min < 0.5) {
    advice.push({ risk: "caution", title: `PRR ${prr.toFixed(2)} (${cls.label}) — the bottleneck is JavaScript, not bytes`, detail: "the network floor is already low; the gap to real paint is client JS. Reducing/deferring it (where safe) or pre-rendering is what moves this number." });
  }
  if (failed.length) advice.push({ risk: "caution", title: `couldn't fetch ${failed.length} blocking resource(s)`, detail: "their cost and script type couldn't be assessed." });

  if (advice.length) {

    const order = { architectural: 0, caution: 1, safe: 2 };
    advice.sort((a, b) => (order[a.risk] ?? 3) - (order[b.risk] ?? 3));
    console.log("  recommendations:");
    for (const a of advice) {
      const r = RISK[a.risk] ?? { icon: "•", label: a.risk };
      console.log(`    ${r.icon} [${r.label}] ${a.title}`);
      if (a.detail) console.log(`        ${a.detail}`);
    }
    console.log();
  } else if (report.blocking.length === 0) {
    console.log(`  no render-blocking sub-resources — the floor is just this one response. 🎉\n`);
  }

  if (prr != null) {
    console.log(`  note: FCP measured on a simulated ${opts.rtt} ms-RTT link; on a faster`);
    console.log(`        connection it'll be lower. Re-run with --rtt to match your audience.\n`);
  }

  process.exit(d.fits ? 0 : 1);
}

main().catch((e) => {
  console.error("lightsout: " + e.message);
  process.exit(2);
});
