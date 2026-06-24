
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

async function findChrome() {
  const { access } = await import("node:fs/promises");
  for (const c of CHROME_CANDIDATES) {
    try {
      await access(c);
      return c;
    } catch {}
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

export async function launchBrowser({ headless = true } = {}) {
  const bin = await findChrome();
  if (!bin) {
    throw new Error("no Chrome/Chromium found — set CHROME_PATH to a browser binary");
  }
  const userDataDir = await mkdtemp(join(tmpdir(), "lightsout-cdp-"));
  const args = [
    headless ? "--headless=new" : "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ];
  const child = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });

  let port = null;
  for (let i = 0; i < 100 && port === null; i++) {
    try {
      const txt = await readFile(join(userDataDir, "DevToolsActivePort"), "utf8");
      port = Number(txt.split("\n")[0].trim());
    } catch {
      await sleep(100);
    }
  }
  if (!port) {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw new Error("Chrome did not expose a debugging port in time");
  }

  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
  });
  const cdp = new CdpConnection(ws);

  return {
    async measureFcp(url, { timeout = 25000, throttle = null, cache = true } = {}) {
      let targetId, sessionId;
      try {
        ({ targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }));
        ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }));
        await cdp.send("Page.enable", {}, sessionId);
        if (throttle || cache === false) await cdp.send("Network.enable", {}, sessionId);

        if (cache === false) await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);

        if (throttle) {
          await cdp.send(
            "Network.emulateNetworkConditions",
            {
              offline: false,
              latency: throttle.latencyMs ?? 150,
              downloadThroughput: ((throttle.downloadKbps ?? 1600) * 1024) / 8,
              uploadThroughput: ((throttle.uploadKbps ?? 750) * 1024) / 8,
            },
            sessionId,
          );
        }
        await cdp.send("Page.navigate", { url }, sessionId);

        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const { result } = await cdp.send(
            "Runtime.evaluate",
            {
              expression:
                "(()=>{const e=performance.getEntriesByName('first-contentful-paint')[0];return e?e.startTime:null;})()",
              returnByValue: true,
            },
            sessionId,
          );
          if (typeof result?.value === "number") return Math.round(result.value);
          await sleep(250);
        }
        return null;
      } catch {
        return null;
      } finally {
        if (targetId) await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      }
    },
    async close() {
      try {
        ws.close();
      } catch {}
      child.kill("SIGKILL");
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
