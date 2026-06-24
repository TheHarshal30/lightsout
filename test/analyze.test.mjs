
import assert from "node:assert/strict";
import { analyze, findBlocking, criticalPath, measureResponse, classifyScript, findResourceHints, buildAdvice, DEFAULT_BUDGET } from "../src/analyze.mjs";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✅ ${name}`);
};

await test("small document fits", async () => {
  const r = await analyze("<!doctype html><title>hi</title><p>hello</p>");
  assert.equal(r.document.fits, true);
  assert.ok(r.document.gzip < DEFAULT_BUDGET);
});

await test("oversized document busts the budget", async () => {
  const big = "<!doctype html>" + "<p>padding padding padding</p>".repeat(5000);
  const r = await analyze(big, { budget: 200 });
  assert.equal(r.document.fits, false);
});

await test("detects only render-blocking resources", async () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="/a.css">
    <link rel="stylesheet" href="/print.css" media="print">
    <link rel="preload" href="/x.woff2" as="font">
    <script src="/blocking.js"></script>
    <script src="/deferred.js" defer></script>
    <script src="/async.js" async></script>
    <script type="module" src="/mod.js"></script>
  </head><body></body></html>`;
  const blocking = findBlocking(html, "https://example.com/");
  const urls = blocking.map((b) => b.url);
  assert.deepEqual(urls, [
    "https://example.com/a.css",
    "https://example.com/blocking.js",
  ]);
});

await test("ignores resources below the head", async () => {
  const html = `<head><title>t</title></head><body><script src="/late.js"></script></body>`;
  assert.equal(findBlocking(html, "https://x.com/").length, 0);
});

await test("criticalPath counts slow-start round-trips", async () => {
  const W = DEFAULT_BUDGET;
  assert.equal(criticalPath(1000, 0, W).roundTrips, 1);

  assert.equal(criticalPath(W + 1, 0, W).htmlTrips, 2);

  const withBlocking = criticalPath(1000, 5000, W, true);
  assert.equal(withBlocking.htmlTrips, 1);
  assert.equal(withBlocking.blockingTrips, 1);
  assert.equal(withBlocking.roundTrips, 2);

  assert.equal(criticalPath(1000, 0, W, true).blockingTrips, 1);

  assert.equal(criticalPath(1000, 0, W, false).blockingTrips, 0);
});

await test("analyze reports a critical path", async () => {
  const r = await analyze("<!doctype html><title>hi</title>");
  assert.equal(r.criticalPath.roundTrips, 1);
  assert.equal(r.document.fits, true);
});

await test("measureResponse prefers real wire bytes", async () => {
  const headers = new Map([["content-encoding", "br"], ["content-length", "1234"]]);
  const m = measureResponse(headers, "the decoded body is irrelevant to wire size");
  assert.equal(m.wire, 1234);
  assert.equal(m.encoding, "br");
  assert.equal(m.estimated, false);

  const est = measureResponse(new Map(), "x".repeat(100));
  assert.equal(est.estimated, true);
});

await test("classifyScript flags renderers as architectural, enhancements as safe", async () => {
  const renderer = classifyScript('s.textContent=".x{display:none !important}";ReactDOM.createRoot(e).render(a)');
  assert.equal(renderer.risk, "architectural");
  assert.equal(classifyScript("document.write('<b>x</b>')").risk, "caution");
  assert.equal(classifyScript('document.querySelectorAll(".btn").forEach(f)').risk, "safe");
  assert.equal(classifyScript("").risk, "unknown");
});

await test("findResourceHints picks up preconnect + preload", async () => {
  const html = '<head><link rel="preconnect" href="https://cdn.example.com/x"><link rel="preload" href="/app.js" as="script"></head>';
  const h = findResourceHints(html);
  assert.ok(h.preconnect.includes("https://cdn.example.com"));
  assert.ok(h.preload.includes("/app.js"));
});

await test("buildAdvice grades a renderer architectural + flags missing preconnect", () => {
  const report = {
    budget: DEFAULT_BUDGET,
    document: { wire: 5000, fits: true },
    criticalPath: { htmlTrips: 1 },
    baseOrigin: "https://site.test",
    hints: { preconnect: [], preload: [] },
    blocking: [{ type: "js", url: "https://site.test/support.js", risk: "architectural", signals: ["React"] }],
  };
  const advice = buildAdvice(report);
  const arch = advice.find((a) => a.risk === "architectural");
  assert.ok(arch && /do not just `defer`/.test(arch.title));
  assert.ok(advice.some((a) => a.risk === "safe" && /preconnect/.test(a.title)));
});

await test("detectProject distinguishes CSR SPA from a meta-framework", async () => {
  const { detectProject } = await import("../src/scan.mjs");
  const spa = detectProject({ dependencies: { react: "18", "react-dom": "18" }, devDependencies: { vite: "5" } });
  assert.equal(spa.uiLib, "React");
  assert.equal(spa.strategyRisk, "csr-likely");
  const ssg = detectProject({ dependencies: { astro: "4" } });
  assert.equal(ssg.metaFramework, "Astro");
  assert.equal(ssg.strategyRisk, "good");
});

console.log(`\n  ${passed} passed\n`);
