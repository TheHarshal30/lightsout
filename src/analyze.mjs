
import { gzipSync } from "node:zlib";

export const DEFAULT_BUDGET = 14 * 1024;

export const DEFAULT_RTT_MS = 150;

export function paintReadiness(networkFloorMs, fcpMs) {
  if (!(networkFloorMs > 0) || !(fcpMs > 0)) return null;
  return Math.min(1, networkFloorMs / fcpMs);
}

export const PRR_CLASSES = [
  { min: 0.8, label: "Floor-limited", hint: "paints at the network floor — the network is the only cost left" },
  { min: 0.5, label: "Efficient", hint: "paints close to the floor; little JS in the way" },
  { min: 0.2, label: "Moderately delayed", hint: "real paint runs a few× past the floor" },
  { min: 0.1, label: "JS-taxed", hint: "the browser waits 5–10× the floor — JavaScript is the bottleneck" },
  { min: 0, label: "JS-bound", hint: "paint waits 10×+ the floor; the HTML budget is irrelevant here" },
];

export function classifyPRR(prr) {
  if (prr == null || Number.isNaN(prr)) return null;
  return PRR_CLASSES.find((c) => prr >= c.min) ?? PRR_CLASSES[PRR_CLASSES.length - 1];
}

const gzipLen = (str) => gzipSync(Buffer.from(str, "utf8"), { level: 9 }).length;

function headRegion(html) {
  const lower = html.toLowerCase();
  const end = lower.indexOf("</head>");
  const bodyStart = lower.indexOf("<body");
  const cut = [end, bodyStart].filter((i) => i !== -1).sort((a, b) => a - b)[0];
  const region = cut === undefined ? html : html.slice(0, cut);

  return region.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}

function resolve(href, baseUrl) {
  if (!href || href.startsWith("data:") || href.startsWith("#")) return null;
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};
const hasAttr = (tag, name) => new RegExp(`(^|\\s)${name}(\\s|=|>|$)`, "i").test(tag);

export function findBlocking(html, baseUrl) {
  const head = headRegion(html);
  const out = [];

  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, "rel") || "").toLowerCase();
    if (!rel.split(/\s+/).includes("stylesheet")) continue;
    const media = (attr(tag, "media") || "").toLowerCase();
    if (media && media.includes("print") && !media.includes("screen")) continue;
    const url = resolve(attr(tag, "href"), baseUrl);
    if (url) out.push({ type: "css", url });
  }

  for (const m of head.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "src");
    if (!src) continue;
    if (hasAttr(tag, "async") || hasAttr(tag, "defer") || (attr(tag, "type") || "").toLowerCase() === "module") {
      continue;
    }
    const url = resolve(src, baseUrl);
    if (url) out.push({ type: "js", url });
  }

  return out;
}

export function measureResponse(headers, text) {
  const encoding = (headers.get?.("content-encoding") || "").split(",")[0].trim().toLowerCase() || "identity";
  const cl = Number(headers.get?.("content-length"));
  if (Number.isFinite(cl) && cl > 0) {

    return { wire: cl, encoding, estimated: false };
  }

  const wire = encoding === "identity" ? Buffer.byteLength(text) : gzipLen(text);
  return { wire, encoding: encoding === "identity" ? "identity" : "gzip~", estimated: true };
}

const wireBytes = (r) => r.wire ?? r.gzip ?? r.raw ?? 0;

export function classifyScript(text) {
  if (!text || typeof text !== "string") return { kind: "unknown", risk: "unknown", signals: [] };
  const sig = [];
  const has = (re, label) => re.test(text) && sig.push(label);

  has(/display\s*:\s*none[^;}"']*!important/i, "injects display:none!important");
  has(/visibility\s*:\s*hidden/i, "injects visibility:hidden");

  has(/\bReactDOM\b|React\.createElement|\bcreateRoot\b|\bhydrateRoot\b|\b_jsx\b/, "React");
  has(/\bVue\b|createApp\s*\(|__vue__/, "Vue");
  has(/platformBrowserDynamic|ɵɵ|\bNgModule\b/, "Angular");
  has(/\bSvelteComponent\b|\$\$invalidate\b/, "Svelte");
  has(/\bhydrate\w*\s*\(/i, "hydration");
  has(/document\.write\s*\(/, "document.write");

  const hides = sig.some((s) => s.startsWith("injects"));
  const framework = sig.some((s) => ["React", "Vue", "Angular", "Svelte", "hydration"].includes(s));
  const docWrite = sig.includes("document.write");

  if (hides) return { kind: "renderer", risk: "architectural", signals: sig };
  if (framework && docWrite) return { kind: "renderer", risk: "architectural", signals: sig };
  if (framework || docWrite) return { kind: "framework", risk: "caution", signals: sig };
  return { kind: "enhancement", risk: "safe", signals: sig };
}

async function weighResource(res) {
  try {
    const r = await fetch(res.url, { redirect: "follow" });
    if (!r.ok) return { ...res, error: `HTTP ${r.status}` };
    const text = await r.text();
    const m = measureResponse(r.headers, text);
    const cls = res.type === "js" ? classifyScript(text) : {};
    return { ...res, wire: m.wire, encoding: m.encoding, estimated: m.estimated, gzip: gzipLen(text), raw: Buffer.byteLength(text), ...cls };
  } catch (e) {
    return { ...res, error: e.message };
  }
}

export function findResourceHints(html) {
  const head = headRegion(html);
  const preconnect = new Set(), preload = new Set();
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], "rel") || "").toLowerCase();
    const href = attr(m[0], "href");
    if (!href) continue;
    if (rel.includes("preconnect") || rel.includes("dns-prefetch")) {
      try { preconnect.add(new URL(href).origin); } catch {}
    }
    if (rel.includes("preload") || rel.includes("modulepreload")) preload.add(href);
  }
  return { preconnect: [...preconnect], preload: [...preload] };
}

export function buildAdvice(report) {
  const out = [];
  const d = report.document;
  const ok = report.blocking.filter((b) => !b.error);
  const hints = report.hints || { preconnect: [], preload: [] };
  const baseOrigin = report.baseOrigin || null;
  const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

  if (!d.fits) {
    out.push({ risk: "safe", title: `Trim the HTML document — ${kb(d.wire)} > ${kb(report.budget)}`, detail: `it needs ${report.criticalPath.htmlTrips} round-trips just to arrive. Move below-the-fold markup out of the initial response or cut inline CSS.` });
  }

  const seenPreconnect = new Set();
  for (const b of ok) {
    let origin = null;
    try { origin = new URL(b.url).origin; } catch {}
    const crossOrigin = origin && origin !== baseOrigin;

    if (b.type === "css") {
      out.push({ risk: "safe", title: `Inline the critical CSS from ${b.url}`, detail: "removes a render-blocking request from the critical path (the rest can load async)." });
    } else if (b.type === "js") {
      if (b.risk === "architectural") {
        out.push({ risk: "architectural", title: `${b.url} appears to RENDER the page — do not just \`defer\` it`, detail: `signals: ${b.signals?.join(", ") || "hides content until the script runs"}. Deferring a script that hides or creates the page paints raw/blank content first, then re-renders — a flash (FOUC). The real fix is to pre-render to static HTML (or server-render) so first paint doesn't wait on JS. Only defer true enhancements.` });
      } else if (b.risk === "caution") {
        out.push({ risk: "caution", title: `${b.url} looks like a framework/runtime`, detail: `signals: ${b.signals?.join(", ")}. If it renders any initial content, deferring it will flash. Confirm it's a pure enhancement before adding \`defer\`.` });
      } else {
        out.push({ risk: "safe", title: `Add \`defer\` (or \`async\`) to ${b.url}`, detail: "no render/framework signals found — likely a true enhancement, so deferring it should stop it blocking first paint. Confirm the page still renders without it." });
      }
    }

    if (origin && !hints.preconnect.includes(origin) && !seenPreconnect.has(origin)) {
      seenPreconnect.add(origin);
      out.push({ risk: "safe", title: `Add <link rel="preconnect" href="${origin}"${crossOrigin ? " crossorigin" : ""}> to <head>`, detail: `${crossOrigin ? "cross-origin " : ""}blocking resource with no preconnect — warming the connection first saves a round-trip on the critical chain, especially on high-latency links.` });
    }
  }
  return out;
}

export function criticalPath(docBytes, blockingBytes, firstWindow = DEFAULT_BUDGET, hasBlocking = false) {
  let window = firstWindow;
  const run = (bytes) => {
    if (bytes <= 0) return 0;
    let delivered = 0, trips = 0;
    do {
      delivered += window;
      window *= 2;
      trips++;
    } while (delivered < bytes && trips < 64);
    return trips;
  };
  const htmlTrips = run(docBytes);

  const blockingTrips = hasBlocking ? Math.max(1, run(blockingBytes)) : 0;
  return { roundTrips: htmlTrips + blockingTrips, htmlTrips, blockingTrips };
}

export async function analyze(html, { baseUrl = null, budget = DEFAULT_BUDGET, fetchBlocking = true, documentWire = null, rtt = DEFAULT_RTT_MS } = {}) {
  const docGzip = gzipLen(html);
  const docRaw = Buffer.byteLength(html);
  const docWire = documentWire?.wire ?? docGzip;
  const docEncoding = documentWire?.encoding ?? "gzip~";

  let blocking = findBlocking(html, baseUrl);

  if (fetchBlocking && baseUrl) {
    blocking = await Promise.all(blocking.map(weighResource));
  }

  const blockingBytes = blocking.reduce((sum, b) => sum + (b.error ? 0 : wireBytes(b)), 0);
  const hasBlocking = blocking.some((b) => !b.error);
  const path = criticalPath(docWire, blockingBytes, budget, hasBlocking);

  path.networkFloorMs = path.roundTrips * rtt;

  const report = {
    budget,
    document: {
      gzip: docGzip,
      raw: docRaw,
      wire: docWire,
      encoding: docEncoding,
      estimated: documentWire?.estimated ?? true,
      fits: docWire <= budget,
      pct: docWire / budget,
    },
    blocking,
    criticalPath: path,
    baseOrigin: baseUrl ? safeOrigin(baseUrl) : null,
    hints: findResourceHints(html),
  };

  report.advice = buildAdvice(report);
  return report;
}

const safeOrigin = (u) => {
  try { return new URL(u).origin; } catch { return null; }
};
