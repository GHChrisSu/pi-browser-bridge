import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

const MAX_HEAP_SNAPSHOT_BYTES = 200 * 1024 * 1024;

async function launchIsolatedChrome() {
  const chromeLauncherModule = await import("chrome-launcher");
  const chromeLauncher = chromeLauncherModule.default || chromeLauncherModule;
  try {
    return await chromeLauncher.launch({
      chromeFlags: ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking"],
      logLevel: "silent",
    });
  } catch (error) {
    throw new Error(`Could not launch an isolated headless Chrome instance: ${String(error?.message || error).slice(0, 400)}`);
  }
}

async function lighthouseRun(url, { categories, form_factor = "mobile", output_path } = {}) {
  const [chrome, lighthouseModule] = await Promise.all([
    launchIsolatedChrome(),
    import("lighthouse"),
  ]);
  try {
    const lighthouse = lighthouseModule.default || lighthouseModule;
    const result = await lighthouse(url, {
      port: chrome.port,
      output: output_path ? "html" : "json",
      formFactor: form_factor,
      ...(form_factor === "desktop" ? { screenEmulation: { mobile: false, width: 1_350, height: 940, deviceScaleFactor: 1, disabled: false } } : {}),
      onlyCategories: categories?.length ? categories : ["performance", "accessibility", "best-practices", "seo"],
      logLevel: "error",
    });
    const lhr = result.lhr;
    const scores = Object.fromEntries(Object.entries(lhr.categories || {}).map(([name, category]) => [name, category.score == null ? null : Math.round(category.score * 100)]));
    const metrics = {};
    for (const id of ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]) {
      const audit = lhr.audits?.[id];
      if (audit) metrics[id] = { value: audit.displayValue ?? null, score: audit.score == null ? null : Math.round(audit.score * 100) };
    }
    const failing = [];
    for (const [categoryName, category] of Object.entries(lhr.categories || {})) {
      for (const reference of category.auditRefs || []) {
        const audit = lhr.audits?.[reference.id];
        if (!audit || audit.score == null || audit.score >= 0.9 || audit.scoreDisplayMode === "informative" || audit.scoreDisplayMode === "notApplicable") continue;
        failing.push({ category: categoryName, id: reference.id, title: String(audit.title || "").slice(0, 200), score: Math.round(audit.score * 100), ...(audit.displayValue ? { value: String(audit.displayValue).slice(0, 200) } : {}), weight: reference.weight || 0 });
      }
    }
    failing.sort((a, b) => b.weight - a.weight || a.score - b.score);
    let report_path;
    if (output_path) {
      const report = Array.isArray(result.report) ? result.report[0] : result.report;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(output_path, String(report || ""), { encoding: "utf8", flag: "wx", mode: 0o600 });
      report_path = output_path;
    }
    return {
      url: String(lhr.finalDisplayedUrl || lhr.finalUrl || url).split("?")[0],
      lighthouse_version: lhr.lighthouseVersion,
      form_factor: lhr.configSettings?.formFactor || form_factor,
      scores,
      metrics,
      failing: failing.slice(0, 20).map(({ weight: _weight, ...item }) => item),
      ...(report_path ? { report_path } : {}),
      ...(lhr.runWarnings?.length ? { warnings: lhr.runWarnings.slice(0, 3) } : {}),
    };
  } finally {
    try { await chrome.kill(); } catch { /* Ignore shutdown errors after the report is complete. */ }
  }
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
    const events = new EventEmitter();
    const pending = new Map();
    let nextId = 0;
    socket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.id && pending.has(message.id)) {
        const operation = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(operation.timer);
        if (message.error) operation.reject(new Error(`${message.error.message} (${message.error.code})`));
        else operation.resolve(message.result);
      } else if (message.method) events.emit(message.method, message.params);
    });
    socket.once("error", reject);
    socket.once("open", () => resolve({
      send(method, params = {}, timeoutMs = 120_000) {
        const id = ++nextId;
        return new Promise((resolveOperation, rejectOperation) => {
          const timer = setTimeout(() => { pending.delete(id); rejectOperation(new Error(`CDP ${method} timed out`)); }, timeoutMs);
          pending.set(id, { resolve: resolveOperation, reject: rejectOperation, timer });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      on: (method, listener) => events.on(method, listener),
      off: (method, listener) => events.off(method, listener),
      close: () => socket.close(),
    }));
  });
}

async function targetWebSocketUrl(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`Could not inspect isolated Chrome targets (${response.status})`);
  const targets = await response.json();
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("Isolated Chrome did not expose a page target");
  return target.webSocketDebuggerUrl;
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => stream.write(chunk, (error) => error ? reject(error) : resolve()));
}

async function heapSnapshot(url, outputPath) {
  const chrome = await launchIsolatedChrome();
  let cdp;
  let stream;
  let bytes = 0;
  let exceeded = false;
  let writeChain = Promise.resolve();
  try {
    cdp = await connectCdp(await targetWebSocketUrl(chrome.port));
    await cdp.send("Page.enable");
    const pageLoaded = new Promise((resolve) => {
      const listener = () => { cdp.off("Page.loadEventFired", listener); resolve(); };
      cdp.on("Page.loadEventFired", listener);
      const timer = setTimeout(() => { cdp.off("Page.loadEventFired", listener); resolve(); }, 30_000);
      void timer;
    });
    await cdp.send("Page.navigate", { url });
    await pageLoaded;
    stream = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
    const onChunk = ({ chunk }) => {
      const size = Buffer.byteLength(chunk);
      bytes += size;
      if (bytes > MAX_HEAP_SNAPSHOT_BYTES) { exceeded = true; return; }
      writeChain = writeChain.then(() => writeChunk(stream, chunk));
    };
    cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false }, 180_000);
    cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await writeChain;
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    stream = null;
    if (exceeded) {
      await rm(outputPath, { force: true });
      throw new Error(`Heap snapshot exceeded the ${MAX_HEAP_SNAPSHOT_BYTES}-byte limit and was deleted`);
    }
    return { saved: outputPath, bytes, url: url.split("?")[0], note: "Snapshot is from a fresh unauthenticated headless Chrome profile; open the file in DevTools > Memory." };
  } catch (error) {
    cdp?.off("HeapProfiler.addHeapSnapshotChunk", () => {});
    stream?.destroy();
    await rm(outputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    cdp?.close();
    try { await chrome.kill(); } catch { /* Ignore shutdown errors after the snapshot is saved. */ }
  }
}

export async function runLighthouseTool(url, options) {
  return lighthouseRun(url, options);
}

export async function runHeapSnapshotTool(url, outputPath) {
  return heapSnapshot(url, outputPath);
}
