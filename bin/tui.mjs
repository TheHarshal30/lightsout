#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { analyze, measureResponse, paintReadiness, classifyPRR, DEFAULT_BUDGET, DEFAULT_RTT_MS } from "../src/analyze.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RTT = DEFAULT_RTT_MS;
const THROTTLE = { latencyMs: RTT, downloadKbps: 1600, uploadKbps: 750 };

const ESC = "\x1b[";
const reset = "\x1b[0m";
const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const dim = (s) => `\x1b[2m${s}\x1b[22m`;
const rgb = (r, g, b, s) => `\x1b[38;2;${r};${g};${b}m${s}${reset}`;
const bg = (r, g, b, s) => `\x1b[48;2;${r};${g};${b}m${s}\x1b[49m`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function prrColor(prr) {
  const p = clamp01(prr);

  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  if (p < 0.5) {
    const t = p / 0.5;
    return [lerp(235, 235, t), lerp(90, 200, t), lerp(90, 80, t)];
  }
  const t = (p - 0.5) / 0.5;
  return [lerp(235, 80, t), lerp(200, 220, t), lerp(80, 120, t)];
}

const ICON = { "Floor-limited": "●", Efficient: "●", "Moderately delayed": "◐", "JS-taxed": "◐", "JS-bound": "○" };
const BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];

function bar(frac, width, color) {
  frac = clamp01(frac);
  const units = Math.round(frac * width * 8);
  const whole = Math.floor(units / 8);
  const rem = units % 8;
  let cells = "█".repeat(Math.min(whole, width));
  let visible = Math.min(whole, width);
  if (rem > 0 && visible < width) {
    cells += BLOCKS[rem];
    visible++;
  }
  const [r, g, b] = color;
  return rgb(r, g, b, cells) + dim("·".repeat(Math.max(0, width - visible)));
}

const pad = (s, n) => {
  const len = visibleLen(s);
  return len >= n ? s : s + " ".repeat(n - len);
};
const padStart = (s, n) => {
  const len = visibleLen(s);
  return len >= n ? s : " ".repeat(n - len) + s;
};

const visibleLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

async function loadPanel() {
  try {
    const d = JSON.parse(await readFile(join(HERE, "../bench/dataset-hq.json"), "utf8"));
    return d.sites
      .filter((s) => s.ok && s.prrMean != null)
      .map((s) => ({ url: s.finalUrl || s.url, host: host(s.finalUrl || s.url), prr: s.prrMean, floor: s.networkFloorMs, fcp: s.fcpMeanMs, cls: classifyPRR(s.prrMean)?.label, live: false }))
      .sort((a, b) => b.prr - a.prr);
  } catch {
    return [];
  }
}

async function analyzeLive(url, browser, onStatus) {
  onStatus("fetching HTML…");
  const target = /^https?:\/\//i.test(url) ? url : "https://" + url;
  const r = await fetch(target, { redirect: "follow" });
  const html = await r.text();
  onStatus("modelling the network floor…");
  const documentWire = measureResponse(r.headers, html);
  const report = await analyze(html, { baseUrl: r.url, budget: DEFAULT_BUDGET, documentWire, rtt: RTT });
  onStatus("rendering in headless Chrome…");
  const fcp = await browser.measureFcp(r.url, { throttle: THROTTLE });
  const floor = report.criticalPath.networkFloorMs;
  const prr = paintReadiness(floor, fcp);
  return { url: r.url, host: host(r.url), floor, fcp, prr, cls: classifyPRR(prr)?.label, fits: report.document.fits, docBytes: report.document.wire, roundTrips: report.criticalPath.roundTrips };
}

function frame(state, cols, rows) {
  const W = Math.min(cols - 2, 78);
  const L = [];
  const accent = (s) => rgb(120, 200, 255, s);

  L.push("");
  L.push("  " + accent("lightsout") + dim(" · paint readiness explorer"));
  L.push("  " + dim("network floor ÷ actual FCP — how close a page paints to what the network allows"));
  L.push("");

  const chip = (label) => {
    const ex = { "Floor-limited": 0.9, Efficient: 0.6, "Moderately delayed": 0.35, "JS-taxed": 0.15, "JS-bound": 0.05 }[label];
    const [r, g, b] = prrColor(ex);
    return rgb(r, g, b, ICON[label] + " " + label);
  };
  L.push("  " + ["Floor-limited", "Efficient", "Moderately delayed", "JS-taxed", "JS-bound"].map(chip).join(dim("  ")));
  L.push("");

  if (state.mode === "result" || state.mode === "analyzing") {
    L.push(...resultCard(state, W));
  } else {
    L.push("  " + dim("─ benchmark panel " + "─".repeat(Math.max(0, W - 18))));
    L.push("");
    const barW = Math.max(16, W - 34);
    const viewport = Math.max(3, rows - 16);
    const { rowsOut, scrolled } = panelViewport(state, viewport);
    for (const { item, idx } of rowsOut) {
      const sel = idx === state.sel;
      const color = prrColor(item.prr);
      const name = pad((item.live ? "◆ " : "") + item.host, 20);
      const line = "  " + (sel ? rgb(120, 200, 255, "▸ ") : "  ") + pad(name, 20) + " " + bar(item.prr, barW, color) + " " + padStart(rgb(...color, item.prr.toFixed(2)), 4) + dim("  " + item.cls);
      L.push(sel ? bgRow(line, W) : line);
    }
    if (scrolled) L.push("  " + dim(`  …${state.panel.length} sites total — scroll with ↑/↓`));
  }

  L.push("");
  L.push("  " + dim("─".repeat(W)));

  const caret = rgb(120, 200, 255, "█");
  const promptBody = state.input.length ? state.input + caret : dim("type a URL, or ⏎ to analyze the highlighted row");
  L.push("  " + rgb(120, 200, 255, "❯ ") + promptBody);
  L.push("  " + dim("↑/↓ move · ⏎ analyze · esc clear · q quit"));
  return L;
}

function bgRow(line, W) {

  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  return `\x1b[48;2;28;34;48m` + pad(line, W + 6) + "\x1b[49m";
}

function panelViewport(state, viewport) {
  const n = state.panel.length;
  if (n <= viewport) return { rowsOut: state.panel.map((item, idx) => ({ item, idx })), scrolled: false };
  let start = Math.max(0, Math.min(state.sel - Math.floor(viewport / 2), n - viewport));
  const rowsOut = [];
  for (let i = start; i < start + viewport; i++) rowsOut.push({ item: state.panel[i], idx: i });
  return { rowsOut, scrolled: true };
}

function gauge(label, valueMs, maxMs, width, color) {
  const frac = maxMs > 0 ? valueMs / maxMs : 0;
  return "  " + pad(label, 14) + " " + bar(frac, width, color) + " " + padStart(`${Math.round(valueMs).toLocaleString()} ms`, 10);
}

function resultCard(state, W) {
  const L = [];
  const res = state.result;
  if (state.mode === "analyzing") {
    const sp = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][state.spin % 10];
    L.push("  " + rgb(120, 200, 255, sp) + "  analyzing " + (state.target || "") + dim("  " + (state.status || "")));
    L.push("");
    L.push("  " + dim("fetch → model the network floor → render in headless Chrome → measure FCP"));
    return L;
  }
  if (!res) return L;
  const color = prrColor(res.prr ?? 0);
  const barW = Math.max(20, W - 28);
  L.push("  " + rgb(...color, (ICON[res.cls] ?? "•") + " ") + bold(res.host) + dim("  " + res.url.replace(/^https?:\/\//, "")));
  L.push("");

  const maxMs = Math.max(res.fcp ?? res.floor, res.floor);
  L.push(gauge("network floor", res.floor, maxMs, barW, [90, 140, 200]));
  if (res.fcp != null) {
    L.push(gauge("actual FCP", res.fcp, maxMs, barW, color));
    L.push("");
    const tag = `PRR ${res.prr.toFixed(2)}  ${ICON[res.cls]} ${res.cls}`;
    L.push("  " + rgb(...color, "▌ " + bold(tag)));
    L.push("  " + dim(`  ${res.cls === "Floor-limited" ? "paints at the network floor — the network is the only cost left" : classifyPRR(res.prr)?.hint || ""}`));
  } else {
    L.push("  " + dim("  page never painted within the timeout"));
  }
  L.push("");
  const fit = res.fits ? "fits the first window" : "spills past the first window";
  L.push("  " + dim(`document ${(res.docBytes / 1024).toFixed(1)} KB — ${fit} · ${res.roundTrips} round-trip floor`));
  L.push("");
  L.push("  " + dim("press any key to go back"));
  return L;
}

function draw(state) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const lines = frame(state, cols, rows);
  let out = ESC + "H";
  for (const ln of lines) out += ln + ESC + "K\r\n";
  out += ESC + "J";
  process.stdout.write(out);
}

async function selftest() {
  const panel = await loadPanel();
  const cols = process.stdout.columns || 90;
  const browse = frame({ mode: "browse", panel, sel: 0, input: "" }, cols, 28);
  process.stdout.write(browse.join("\n") + "\n");
  const sample = panel[0]
    ? { url: "https://" + panel[panel.length - 1].host, host: panel[panel.length - 1].host, floor: panel[panel.length - 1].floor, fcp: panel[panel.length - 1].fcp, prr: panel[panel.length - 1].prr, cls: panel[panel.length - 1].cls, fits: true, docBytes: 2100, roundTrips: 3 }
    : null;
  if (sample) {
    process.stdout.write("\n" + dim("  ── sample result card ──") + "\n");
    process.stdout.write(frame({ mode: "result", panel, sel: 0, input: "", result: sample }, cols, 28).join("\n") + "\n");
  }
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
  if (!process.stdout.isTTY) {
    console.error("lightsout-tui needs an interactive terminal. (Try --selftest to preview a frame.)");
    process.exit(1);
  }

  const state = { mode: "browse", panel: await loadPanel(), sel: 0, input: "", status: "", spin: 0, target: "", result: null };
  let browser = null;
  let spinTimer = null;

  const enterAlt = () => process.stdout.write(ESC + "?1049h" + ESC + "?25l" + ESC + "2J");
  const exitAlt = () => process.stdout.write(ESC + "?25h" + ESC + "?1049l");

  function cleanup() {
    if (spinTimer) clearInterval(spinTimer);
    try {
      process.stdin.setRawMode(false);
    } catch {}
    exitAlt();
    if (browser) browser.close().catch(() => {});
  }
  function quit() {
    cleanup();
    process.exit(0);
  }

  enterAlt();
  draw(state);

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.on("resize", () => draw(state));

  async function runAnalyze(url) {
    state.mode = "analyzing";
    state.target = url;
    state.status = "starting…";
    state.spin = 0;
    spinTimer = setInterval(() => {
      state.spin++;
      draw(state);
    }, 80);
    try {
      if (!browser) {
        state.status = "launching Chrome…";
        const { launchBrowser } = await import("../src/cdp-fcp.mjs");
        browser = await launchBrowser();
      }
      const res = await analyzeLive(url, browser, (s) => {
        state.status = s;
      });

      const existing = state.panel.find((p) => host(p.url) === res.host);
      if (existing) Object.assign(existing, { prr: res.prr, floor: res.floor, fcp: res.fcp, cls: res.cls, live: true });
      else state.panel.push({ ...res, live: true });
      state.panel.sort((a, b) => b.prr - a.prr);
      state.result = res;
      state.mode = "result";
    } catch (e) {
      state.result = null;
      state.mode = "result";
      state.error = e.message;
    } finally {
      clearInterval(spinTimer);
      spinTimer = null;
      draw(state);
    }
  }

  process.stdin.on("keypress", (str, key) => {
    if (!key) return;
    if (key.ctrl && key.name === "c") return quit();

    if (state.mode === "analyzing") return;

    if (state.mode === "result") {
      state.mode = "browse";
      state.result = null;
      draw(state);
      return;
    }

    if (key.name === "up") state.sel = Math.max(0, state.sel - 1);
    else if (key.name === "down") state.sel = Math.min(state.panel.length - 1, state.sel + 1);
    else if (key.name === "return") {
      const url = state.input.trim() || state.panel[state.sel]?.url;
      if (url) {
        state.input = "";
        runAnalyze(url);
      }
      return;
    } else if (key.name === "escape") {
      if (state.input) state.input = "";
      else return quit();
    } else if (key.name === "backspace") state.input = state.input.slice(0, -1);
    else if (key.name === "q" && !state.input) return quit();
    else if (str && str.length === 1 && !key.ctrl && !key.meta && str >= " ") state.input += str;
    draw(state);
  });

  process.on("SIGINT", quit);
  process.on("uncaughtException", (e) => {
    cleanup();
    console.error(e);
    process.exit(1);
  });
}

main();
