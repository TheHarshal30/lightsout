
import { readFile, stat, access } from "node:fs/promises";
import { join, dirname, resolve as resolvePath, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { findBlocking, classifyScript, criticalPath, DEFAULT_BUDGET, DEFAULT_RTT_MS } from "./analyze.mjs";

const gzipLen = (s) => gzipSync(Buffer.from(s, "utf8"), { level: 9 }).length;
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const readJsonSafe = async (p) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } };

export function detectProject(pkg) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);

  const meta = [
    ["next", "Next.js"], ["nuxt", "Nuxt"], ["@remix-run/react", "Remix"],
    ["gatsby", "Gatsby"], ["astro", "Astro"], ["@sveltejs/kit", "SvelteKit"],
    ["@redwoodjs/core", "RedwoodJS"], ["@builder.io/qwik", "Qwik"],
  ].find(([d]) => has(d));

  const uiLib = [
    ["next", "React"], ["react", "React"], ["preact", "Preact"], ["vue", "Vue"],
    ["nuxt", "Vue"], ["svelte", "Svelte"], ["@angular/core", "Angular"],
    ["solid-js", "Solid"], ["lit", "Lit"],
  ].find(([d]) => has(d));

  const bundler = [
    ["next", "Next"], ["vite", "Vite"], ["react-scripts", "CRA"],
    ["@parcel/core", "Parcel"], ["parcel", "Parcel"], ["webpack", "webpack"],
  ].find(([d]) => has(d));

  let strategy, strategyRisk;
  if (meta) { strategy = `${meta[1]} — can server-render / pre-render`; strategyRisk = "good"; }
  else if (uiLib) { strategy = `${uiLib[1]} SPA — likely client-rendered`; strategyRisk = "csr-likely"; }
  else { strategy = "no UI framework — static / multi-page"; strategyRisk = "static"; }

  return {
    name: pkg?.name || null,
    framework: meta?.[1] || uiLib?.[1] || null,
    metaFramework: meta?.[1] || null,
    uiLib: uiLib?.[1] || null,
    bundler: bundler?.[1] || null,
    strategy,
    strategyRisk,
  };
}

async function findHtmlEntry(root) {
  const candidates = [
    ["dist/index.html", "built"], ["build/index.html", "built"], ["out/index.html", "built"],
    [".output/public/index.html", "built"], ["public/index.html", "source"],
    ["index.html", "source"], ["src/index.html", "source"],
  ];
  for (const [rel, kind] of candidates) {
    const p = join(root, rel);
    if (await exists(p)) return { path: p, kind, rel };
  }
  return null;
}

function localPathFor(href, htmlDir) {
  if (!href || /^(https?:)?\/\//i.test(href) || href.startsWith("data:")) return null;
  const clean = href.split(/[?#]/)[0];
  return clean.startsWith("/") ? join(htmlDir, clean.slice(1)) : join(htmlDir, clean);
}

function detectCsrShell(html) {
  const lower = html.toLowerCase();
  const bodyStart = lower.indexOf("<body");
  const body = bodyStart === -1 ? html : html.slice(bodyStart);
  const visible = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const mount = /\bid=["'](root|app|__next|__nuxt|q-app|svelte|gatsby-focus-wrapper)["']/i.test(body);
  const hasScript = /<script\b[^>]*\bsrc=/i.test(body) || /<script\b[^>]*\bsrc=/i.test(html);
  return { isCsr: mount && hasScript && visible.length < 200, visibleChars: visible.length, mount };
}

function buildScanAdvice({ project, csr, doc, resources, jsWeight }) {
  const out = [];
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

  if (csr.isCsr) {

    const bundleKb = jsWeight || 0;
    const fix = {
      "Next.js": "you already use Next — make sure these routes are SSG/SSR, not `ssr:false`/client-only.",
      React: project.bundler === "CRA"
        ? "CRA is client-only — prerender with `react-snap`, or migrate to Next.js / Astro for real SSG."
        : "add a prerender/SSG step (vite-plugin-ssr, vite-react-ssg) or move to Next.js / Astro.",
      Vue: "use `vite-ssg` (or Nuxt) to pre-render the routes.",
      Svelte: "use SvelteKit with `export const prerender = true`.",
      Solid: "use SolidStart with SSR/SSG.",
      Preact: "use Preact + `preact-cli`/`@preact/preset-vite` prerendering, or Astro.",
    }[project.uiLib || project.framework] || "pre-render the page to static HTML so first paint doesn't wait on JS.";
    out.push({
      risk: "architectural",
      title: `client-rendered SPA — first paint waits on the JS bundle (${kb(bundleKb)} gzip), not on bytes`,
      detail: `the HTML ships an empty mount node, so the browser paints nothing until the bundle downloads, parses and renders. No 14 KB tweak changes that — the floor is unreachable while rendering is client-side. Fix: ${fix}`,
    });
  } else if (project.metaFramework) {
    out.push({ risk: "safe", title: `${project.metaFramework} can server-render — you're set up to reach the floor`, detail: "ensure the critical routes are actually pre-rendered/SSR'd (not opted into client-only), and keep above-the-fold content in the initial HTML." });
  }

  for (const r of resources) {
    if (r.external) {
      out.push({ risk: "safe", title: `Add <link rel="preconnect"> for ${r.origin || r.url}`, detail: "render-blocking resource on another origin — warm the connection before the request to save a round-trip." });
      continue;
    }
    if (r.type === "css") {
      out.push({ risk: "safe", title: `Inline the critical CSS from ${r.rel} (${kb(r.gzip || 0)})`, detail: "a render-blocking stylesheet — inline the above-the-fold rules and load the rest async." });
    } else if (r.type === "js") {
      if (r.risk === "architectural") {
        out.push({ risk: "architectural", title: `${r.rel} renders/hides the page — don't just \`defer\` it`, detail: `signals: ${r.signals?.join(", ") || "hides content until it runs"}. Deferring it flashes raw content. Pre-render instead.` });
      } else if (r.risk === "caution") {
        out.push({ risk: "caution", title: `${r.rel} looks like a framework/runtime`, detail: `signals: ${r.signals?.join(", ")}. Verify it isn't rendering initial content before deferring.` });
      } else {
        out.push({ risk: "safe", title: `Add \`defer\` to ${r.rel} (${kb(r.gzip || 0)})`, detail: "no render/framework signals in the source — likely a true enhancement, safe to defer off the critical path." });
      }
    }
  }

  if (!doc.fits) out.push({ risk: "safe", title: `HTML is ${kb(doc.gzip)} gzipped — over the ~14 KB window`, detail: "it needs a second round-trip just to arrive; trim inline markup/CSS or split below-the-fold content." });
  return out;
}

export async function scanProject(root = ".", { rtt = DEFAULT_RTT_MS, budget = DEFAULT_BUDGET } = {}) {
  root = resolvePath(root);
  const pkg = await readJsonSafe(join(root, "package.json"));
  const project = detectProject(pkg);
  const entry = await findHtmlEntry(root);
  if (!entry) {
    return { root, project, error: "no HTML entry found (looked for dist/build/out/public/index.html and index.html)" };
  }

  const html = await readFile(entry.path, "utf8");
  const htmlDir = dirname(entry.path);
  const docGzip = gzipLen(html);

  const resources = [];
  for (const b of findBlocking(html, null)) {
    const local = localPathFor(b.url, htmlDir);
    if (local && (await exists(local))) {
      const text = await readFile(local, "utf8").catch(() => null);
      const gzip = text == null ? null : gzipLen(text);
      const cls = b.type === "js" && text != null ? classifyScript(text) : {};
      resources.push({ ...b, rel: relative(root, local), gzip, external: false, ...cls });
    } else {
      let origin = null;
      try { origin = new URL(b.url).origin; } catch {}
      resources.push({ ...b, external: true, origin });
    }
  }

  const blockingBytes = resources.reduce((s, r) => s + (r.external ? 0 : r.gzip || 0), 0);
  const hasBlocking = resources.length > 0;
  const path = criticalPath(docGzip, blockingBytes, budget, hasBlocking);
  path.networkFloorMs = path.roundTrips * rtt;

  let jsWeight = 0;
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const src = m[2] ?? m[3] ?? m[4];
    const local = localPathFor(src, htmlDir);
    if (local && (await exists(local))) {
      const text = await readFile(local, "utf8").catch(() => null);
      if (text != null) jsWeight += gzipLen(text);
    }
  }

  const csr = detectCsrShell(html);
  const doc = { gzip: docGzip, fits: docGzip <= budget };
  const advice = buildScanAdvice({ project, csr, doc, resources, jsWeight });

  return { root, project, entry, document: doc, resources, jsWeightGzip: jsWeight, criticalPath: path, csr, advice, rtt };
}
