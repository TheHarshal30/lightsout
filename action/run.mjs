#!/usr/bin/env node

import { readFile, appendFile } from "node:fs/promises";
import { analyze, measureResponse, DEFAULT_BUDGET } from "../src/analyze.mjs";

const env = (k, d = "") => (process.env[k] ?? d).trim();
const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

async function emit(file, text) {
  const path = process.env[file];
  if (path) await appendFile(path, text);
}

async function main() {
  const url = env("INPUT_URL");
  const file = env("INPUT_FILE");
  const budget = Number(env("INPUT_BUDGET", String(DEFAULT_BUDGET))) || DEFAULT_BUDGET;
  const failOnBust = env("INPUT_FAIL_ON_BUST", "true").toLowerCase() !== "false";

  if (!url && !file) {
    console.error("lightsout-action: provide either `url` or `file`.");
    process.exit(2);
  }

  let html, baseUrl, documentWire = null;
  if (file) {
    html = await readFile(file, "utf8");
    baseUrl = null;
  } else {
    const r = await fetch(url, { redirect: "follow" });
    html = await r.text();
    baseUrl = r.url;
    documentWire = measureResponse(r.headers, html);
  }

  const report = await analyze(html, { baseUrl, budget, documentWire });
  const d = report.document;
  const cp = report.criticalPath;
  const target = file || baseUrl || url;

  const verdict = d.fits ? "✅ fits the first round-trip" : "❌ busts the first round-trip";
  console.log(`lightsout — ${target}`);
  console.log(`  HTML document: ${kb(d.wire)} (${Math.round(d.pct * 100)}% of ${kb(budget)} budget) — ${verdict}`);
  console.log(`  first paint needs ${cp.roundTrips} round-trip(s); ${report.blocking.length} render-blocking resource(s) in <head>.`);

  const blockingList = report.blocking.length
    ? report.blocking
        .map((b) => {
          const size = b.error ? `_(${b.error})_` : b.wire != null || b.gzip != null ? kb(b.wire ?? b.gzip) : "_size unknown_";
          return `| \`${b.type}\` | ${b.url} | ${size} |`;
        })
        .join("\n")
    : "";
  const summary = [
    `## lightsout — \`${target}\``,
    "",
    `${verdict} — **${kb(d.wire)}** (${Math.round(d.pct * 100)}% of the ${kb(budget)} budget).`,
    "",
    `First paint needs **${cp.roundTrips} round-trip${cp.roundTrips === 1 ? "" : "s"}** ` +
      `(${cp.htmlTrips} for the HTML document${cp.blockingTrips ? `, +${cp.blockingTrips} for render-blocking resources` : ""}).`,
    "",
    report.blocking.length
      ? ["### Render-blocking in `<head>`", "", "| type | resource | size |", "|---|---|---:|", blockingList].join("\n")
      : "No render-blocking sub-resources in `<head>`. 🎉",
    "",
  ].join("\n");
  await emit("GITHUB_STEP_SUMMARY", summary + "\n");

  await emit("GITHUB_OUTPUT", `fits=${d.fits}\ndocument-bytes=${d.wire}\nround-trips=${cp.roundTrips}\n`);

  if (!d.fits && failOnBust) {
    console.error(`\nlightsout: document busts the ${kb(budget)} budget by ${kb(d.wire - budget)}. Failing the job.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("lightsout-action: " + e.message);
  process.exit(2);
});
