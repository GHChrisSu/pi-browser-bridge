const NETWORK_MAX_PER_TAB = 500;
const NETWORK_RULE_BASE = 1_000_000;
const NETWORK_RULE_LIMIT = 1_999_999;
const NETWORK_RULES_STORAGE_KEY = "piBrowserBridgeNetworkRules";
const LAYOUTS_STORAGE_KEY = "piBrowserBridgeWindowLayouts";
const DIFF_STORAGE_PREFIX = "piBrowserBridgeDiff:";
const SESSION_FIXTURES_KEY = "piBrowserBridgeSessionFixtures";
const MAX_CAPTURE_PIXELS = 4_000_000;
const ADVANCED_ALARM_PREFIX = "pi-browser-bridge-rule-expiry:";

export const ADVANCED_COMMANDS = new Set([
  "get_css_styles", "read_console", "monitor_network", "network_rules", "screenshot_diff", "audit",
  "clipboard", "window_layout", "tile_windows", "move_tab", "tab_action", "hover", "get_frames",
  "extract_table", "element_screenshot", "full_page_screenshot", "query_dom", "read_form", "get_tabs",
  "dismiss_overlays", "handle_dialogs", "drag_and_drop", "execute_js", "get_storage", "set_storage", "http_request",
  "inject_css", "modify_dom", "measure_spacing", "viewport_resize", "emulate_media", "set_geolocation", "find_text", "assert",
  "manage_downloads", "extract", "track_events", "find_setting", "session_fixture", "cookie_audit", "http_auth",
  "watch_dom", "watch", "animations", "frames", "save_page", "handoff", "perf_trace", "screencast",
]);

const networkByTab = new Map();
const inFlightNetwork = new Map();
let networkListenersInstalled = false;
const networkListeners = {
  before: null,
  complete: null,
  error: null,
};
const httpAuthCredentials = new Map();
const httpAuthAttempts = new Map();
let httpAuthListener = null;

function scrubText(value, max = 1_000) {
  return String(value ?? "")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/(["']?(?:access_token|refresh_token|id_token|password|passwd|secret|api[_-]?key|authorization|cookie|sessionid)["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi, "$1[REDACTED]")
    .slice(0, max);
}

function redactedNetworkUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[REDACTED]");
    url.hash = "";
    return url.href.slice(0, 2_000);
  } catch { return String(value || "").slice(0, 2_000); }
}

function addNetworkEntry(tabId, entry) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const list = networkByTab.get(tabId) || [];
  list.push(entry);
  while (list.length > NETWORK_MAX_PER_TAB) list.shift();
  networkByTab.set(tabId, list);
}

function installNetworkListeners() {
  if (networkListenersInstalled || !globalThis.chrome?.webRequest) return;
  try {
    networkListeners.before = (details) => {
      const entry = {
        request_id: details.requestId,
        url: redactedNetworkUrl(details.url),
        method: String(details.method || "GET").slice(0, 20),
        type: String(details.type || "other").slice(0, 40),
        started_at: Number(details.timeStamp) || Date.now(),
        tab_id: details.tabId,
      };
      inFlightNetwork.set(details.requestId, entry);
      addNetworkEntry(details.tabId, entry);
      while (inFlightNetwork.size > 2_000) inFlightNetwork.delete(inFlightNetwork.keys().next().value);
    };
    networkListeners.complete = (details) => {
      const entry = inFlightNetwork.get(details.requestId);
      if (!entry) return;
      entry.status = details.statusCode;
      entry.completed_at = Number(details.timeStamp) || Date.now();
      entry.duration_ms = Math.max(0, entry.completed_at - entry.started_at);
      entry.from_cache = Boolean(details.fromCache);
      inFlightNetwork.delete(details.requestId);
    };
    networkListeners.error = (details) => {
      const entry = inFlightNetwork.get(details.requestId);
      if (!entry) return;
      entry.error = String(details.error || "network error").slice(0, 120);
      entry.completed_at = Number(details.timeStamp) || Date.now();
      inFlightNetwork.delete(details.requestId);
    };
    chrome.webRequest.onBeforeRequest.addListener(networkListeners.before, { urls: ["<all_urls>"] });
    chrome.webRequest.onCompleted.addListener(networkListeners.complete, { urls: ["<all_urls>"] });
    chrome.webRequest.onErrorOccurred.addListener(networkListeners.error, { urls: ["<all_urls>"] });
    networkListenersInstalled = true;
  } catch {
    networkListeners.before = null;
    networkListeners.complete = null;
    networkListeners.error = null;
    networkListenersInstalled = false;
  }
}

function uninstallNetworkListeners() {
  if (!networkListenersInstalled || !globalThis.chrome?.webRequest) return;
  try {
    if (networkListeners.before) chrome.webRequest.onBeforeRequest.removeListener(networkListeners.before);
    if (networkListeners.complete) chrome.webRequest.onCompleted.removeListener(networkListeners.complete);
    if (networkListeners.error) chrome.webRequest.onErrorOccurred.removeListener(networkListeners.error);
  } catch { /* Chrome may already have revoked the optional permission. */ }
  networkListeners.before = null;
  networkListeners.complete = null;
  networkListeners.error = null;
  networkListenersInstalled = false;
  networkByTab.clear();
  inFlightNetwork.clear();
}

function installHttpAuthListener() {
  if (httpAuthListener || !globalThis.chrome?.webRequest?.onAuthRequired) return;
  httpAuthListener = (details, callback) => {
    let origin;
    try { origin = new URL(details.url).origin; } catch { callback({}); return; }
    const credentials = httpAuthCredentials.get(origin);
    const previous = httpAuthAttempts.get(details.requestId);
    if (!credentials || (previous && Date.now() - previous < 30_000)) { callback({}); return; }
    httpAuthAttempts.set(details.requestId, Date.now());
    while (httpAuthAttempts.size > 2_000) httpAuthAttempts.delete(httpAuthAttempts.keys().next().value);
    callback({ authCredentials: { ...credentials } });
  };
  try { chrome.webRequest.onAuthRequired.addListener(httpAuthListener, { urls: ["<all_urls>"] }, ["asyncBlocking"]); }
  catch { httpAuthListener = null; }
}

function clearHttpAuthListener() {
  if (httpAuthListener && globalThis.chrome?.webRequest?.onAuthRequired) {
    try { chrome.webRequest.onAuthRequired.removeListener(httpAuthListener); } catch { /* Optional permission may already be gone. */ }
  }
  httpAuthListener = null;
  httpAuthCredentials.clear();
  httpAuthAttempts.clear();
}

async function setHttpAuth(params) {
  await requirePermission("webRequestAuthProvider");
  await requirePermission("webRequest");
  let url;
  if (params.origin) {
    try { url = new URL(params.origin); } catch { throw new Error("origin must be an absolute HTTP or HTTPS origin"); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP authentication supports only HTTP or HTTPS origins");
  }
  if (params.action === "clear") {
    if (url) httpAuthCredentials.delete(url.origin);
    else httpAuthCredentials.clear();
    if (!httpAuthCredentials.size) clearHttpAuthListener();
    return { cleared: true, origin: url?.origin || "all configured origins" };
  }
  if (!url) throw new Error("set requires an HTTP or HTTPS origin");
  if (!params.username || typeof params.password !== "string") throw new Error("set requires username and password");
  httpAuthCredentials.set(url.origin, { username: String(params.username).slice(0, 300), password: String(params.password).slice(0, 2_000) });
  installHttpAuthListener();
  if (!httpAuthListener) throw new Error("Chrome could not install the HTTP authentication handler");
  return { configured: true, origin: url.origin, username: String(params.username).slice(0, 300), password_stored_in_memory: true };
}

export function initAdvancedCapabilities() {
  try {
    chrome.permissions.onAdded.addListener(({ permissions = [] }) => {
      if (permissions.includes("webRequest")) installNetworkListeners();
      if (permissions.includes("webRequestAuthProvider")) installHttpAuthListener();
      if (permissions.includes("declarativeNetRequestWithHostAccess")) void clearManagedNetworkRules();
    });
    chrome.permissions.onRemoved.addListener(({ permissions = [] }) => {
      if (permissions.includes("webRequest")) uninstallNetworkListeners();
      if (permissions.includes("webRequestAuthProvider")) clearHttpAuthListener();
      if (permissions.includes("declarativeNetRequestWithHostAccess")) void clearManagedNetworkRules();
    });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name.startsWith(ADVANCED_ALARM_PREFIX)) {
        const id = Number(alarm.name.slice(ADVANCED_ALARM_PREFIX.length));
        if (Number.isInteger(id)) void removeManagedNetworkRules([id]);
      }
    });
    chrome.permissions.contains({ permissions: ["webRequest"] }).then((granted) => {
      if (granted) installNetworkListeners();
    }).catch(() => {});
    chrome.permissions.contains({ permissions: ["webRequest", "webRequestAuthProvider"] }).then((granted) => {
      if (granted) installHttpAuthListener();
    }).catch(() => {});
    installNetworkListeners();
    void clearExpiredNetworkRules().catch(() => {});
  } catch { /* Optional APIs may not be available in older Chrome builds. */ }
}

function requirePermission(name) {
  return chrome.permissions.contains({ permissions: [name] }).then((granted) => {
    if (!granted) throw new Error(`This tool needs the optional ${name} permission. Enable it in the Pi Bridge extension popup first.`);
  });
}

function requireVisibleTab(tab) {
  if (!Number.isInteger(tab?.windowId) || !Number.isInteger(tab?.id)) throw new Error("No scriptable Chrome tab is available");
  return chrome.tabs.query({ active: true, windowId: tab.windowId }).then(([active]) => {
    if (active?.id !== tab.id) throw new Error("This operation needs the selected tab to be active; Pi Bridge will not switch Chrome focus");
    return chrome.windows.get(tab.windowId).then((window) => {
      if (window.state === "minimized") throw new Error("The selected Chrome window is minimized; bring it on screen first");
      return tab;
    });
  });
}

function redactPageUrl(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`;
  } catch { return ""; }
}

function safeRule(rule) {
  const details = rule?.action?.requestHeaders || rule?.action?.responseHeaders || [];
  const safeHeaders = details.map(({ header, operation, value }) => ({
    header,
    operation,
    ...(value !== undefined ? { value: /authorization|cookie|token|secret|password/i.test(header) ? "[REDACTED]" : String(value).slice(0, 300) } : {}),
  }));
  return {
    id: rule.id,
    priority: rule.priority,
    action: rule.action.type,
    ...(rule.action.redirect?.url ? { redirect_url: redactPageUrl(rule.action.redirect.url) } : {}),
    ...(safeHeaders.length ? { headers: safeHeaders } : {}),
    condition: {
      ...(rule.condition.urlFilter ? { url_filter: rule.condition.urlFilter } : {}),
      ...(rule.condition.tabIds ? { tab_ids: rule.condition.tabIds } : {}),
      ...(rule.condition.resourceTypes ? { resource_types: rule.condition.resourceTypes } : {}),
    },
  };
}

async function managedRuleMetadata() {
  const stored = await chrome.storage.local.get(NETWORK_RULES_STORAGE_KEY);
  return stored[NETWORK_RULES_STORAGE_KEY] || {};
}

async function saveManagedRuleMetadata(metadata) {
  await chrome.storage.local.set({ [NETWORK_RULES_STORAGE_KEY]: metadata });
}

async function removeManagedNetworkRules(ids) {
  if (!globalThis.chrome?.declarativeNetRequest) return { removed: 0 };
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const managed = existing.filter((rule) => rule.id >= NETWORK_RULE_BASE && rule.id <= NETWORK_RULE_LIMIT);
  const targets = ids ? managed.filter((rule) => ids.includes(rule.id)) : managed;
  if (targets.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: targets.map((rule) => rule.id) });
  const metadata = await managedRuleMetadata();
  for (const rule of targets) {
    delete metadata[rule.id];
    await chrome.alarms.clear(`${ADVANCED_ALARM_PREFIX}${rule.id}`);
  }
  await saveManagedRuleMetadata(metadata);
  return { removed: targets.length };
}

async function clearManagedNetworkRules() {
  try { return await removeManagedNetworkRules(); } catch { return { removed: 0 }; }
}

async function clearExpiredNetworkRules() {
  if (!globalThis.chrome?.declarativeNetRequest) return;
  const granted = await chrome.permissions.contains({ permissions: ["declarativeNetRequestWithHostAccess"] }).catch(() => false);
  if (!granted) return;
  const metadata = await managedRuleMetadata();
  const active = await chrome.declarativeNetRequest.getSessionRules();
  const activeIds = new Set(active.map((rule) => rule.id));
  const expired = [];
  for (const [idText, value] of Object.entries(metadata)) {
    const id = Number(idText);
    if (!activeIds.has(id) || (value?.expires_at && value.expires_at <= Date.now())) expired.push(id);
  }
  if (expired.length) await removeManagedNetworkRules(expired);
}

async function networkRules(params) {
  await requirePermission("declarativeNetRequestWithHostAccess");
  await clearExpiredNetworkRules();
  const action = params.action;
  if (action === "list") {
    const [rules, metadata] = await Promise.all([chrome.declarativeNetRequest.getSessionRules(), managedRuleMetadata()]);
    return { rules: rules.filter((rule) => rule.id >= NETWORK_RULE_BASE && rule.id <= NETWORK_RULE_LIMIT).map((rule) => ({
      ...safeRule(rule),
      ...(metadata[rule.id]?.expires_at ? { expires_at: new Date(metadata[rule.id].expires_at).toISOString() } : {}),
    })) };
  }
  if (action === "clear") {
    return await removeManagedNetworkRules(Number.isInteger(params.rule_id) ? [params.rule_id] : undefined);
  }
  if (typeof params.url_filter !== "string" || !params.url_filter.trim()) throw new Error("url_filter is required for a network rule");
  const condition = { urlFilter: params.url_filter.trim() };
  if (Array.isArray(params.resource_types) && params.resource_types.length) condition.resourceTypes = params.resource_types;
  if (Number.isInteger(params.tab_id)) condition.tabIds = [params.tab_id];
  let ruleAction;
  if (action === "block") ruleAction = { type: "block" };
  else if (action === "redirect") {
    if (typeof params.redirect_url !== "string") throw new Error("redirect_url is required for a redirect rule");
    ruleAction = { type: "redirect", redirect: { url: params.redirect_url } };
  } else if (action === "modify_header") {
    if (typeof params.header !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(params.header)) throw new Error("header must be a valid HTTP header name");
    const target = params.header_target === "response" ? "responseHeaders" : "requestHeaders";
    const operation = params.header_value === undefined ? "remove" : "set";
    ruleAction = { type: "modifyHeaders", [target]: [{ header: params.header, operation, ...(operation === "set" ? { value: String(params.header_value).slice(0, 2_048) } : {}) }] };
  } else throw new Error("Unsupported network rule action");

  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const managed = existing.filter((rule) => rule.id >= NETWORK_RULE_BASE && rule.id <= NETWORK_RULE_LIMIT);
  if (managed.length >= 50) throw new Error("Pi Bridge limits the profile to 50 active network rules; clear one before adding another");
  const requested = Number.isInteger(params.rule_id) ? params.rule_id : undefined;
  const id = requested ?? Math.max(NETWORK_RULE_BASE, ...managed.map((rule) => rule.id + 1));
  if (id > NETWORK_RULE_LIMIT) throw new Error("Pi Bridge has reached its active network rule ID limit; clear rules first");
  if (existing.some((rule) => rule.id === id)) throw new Error(`Network rule ${id} already exists`);
  const expiresAt = Date.now() + Math.max(1_000, Math.min(Number(params.expires_ms) || 1_800_000, 24 * 60 * 60 * 1_000));
  const rule = { id, priority: 1, action: ruleAction, condition };
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
  const metadata = await managedRuleMetadata();
  metadata[id] = { expires_at: expiresAt };
  await saveManagedRuleMetadata(metadata);
  chrome.alarms.create(`${ADVANCED_ALARM_PREFIX}${id}`, { when: expiresAt });
  return { added: true, ...safeRule(rule), expires_at: new Date(expiresAt).toISOString() };
}

function getConsoleCapture(tabId, executeInTab) {
  return executeInTab(tabId, () => {
    const key = "__PI_BROWSER_BRIDGE_CONSOLE__";
    let state = window[key];
    if (!state) {
      state = { entries: [] };
      Object.defineProperty(window, key, { value: state, configurable: true });
      const capture = (level, args) => {
        const text = args.map((value) => {
          try { return typeof value === "string" ? value : JSON.stringify(value); }
          catch { return Object.prototype.toString.call(value); }
        }).join(" ").slice(0, 2_000);
        state.entries.push({ level, text, at: Date.now() });
        if (state.entries.length > 500) state.entries.splice(0, state.entries.length - 500);
      };
      for (const level of ["error", "warn", "info", "log", "debug"]) {
        const original = console[level]?.bind(console);
        if (!original) continue;
        console[level] = (...args) => { capture(level === "debug" ? "info" : level, args); return original(...args); };
      }
      addEventListener("error", (event) => capture("error", [event.message || "Unhandled page error", event.filename, event.lineno]));
      addEventListener("unhandledrejection", (event) => capture("error", ["Unhandled promise rejection", event.reason]));
    }
    return state.entries;
  }, []);
}

async function executeInMain(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return results?.[0]?.result;
}

async function readConsole(tab, params) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 50, 200));
  const entries = await getConsoleCapture(tab.id, executeInMain);
  const level = params.level || "all";
  const filtered = entries.filter((entry) => level === "all" || entry.level === level).slice(-limit).map((entry) => ({
    level: entry.level,
    text: scrubText(entry.text),
    at: entry.at,
  }));
  if (params.clear) await executeInMain(tab.id, () => { const state = window.__PI_BROWSER_BRIDGE_CONSOLE__; if (state) state.entries.length = 0; return true; });
  return { messages: filtered, count: entries.length, returned: filtered.length, cleared: params.clear === true };
}

async function monitorNetwork(tab, params) {
  await requirePermission("webRequest");
  installNetworkListeners();
  const entries = networkByTab.get(tab.id) || [];
  const limit = Math.max(1, Math.min(Number(params.limit) || 100, 500));
  const requests = entries.slice(-limit).map((entry) => ({ ...entry }));
  if (params.clear) networkByTab.set(tab.id, []);
  return { tab_id: tab.id, count: entries.length, returned: requests.length, truncated: entries.length > requests.length, requests };
}

async function getCssStyles(tab, params, executeInTab) {
  const selector = String(params.selector || "").trim();
  const properties = Array.isArray(params.properties) && params.properties.length
    ? params.properties.slice(0, 80).map(String)
    : ["display", "position", "visibility", "opacity", "color", "background-color", "font-family", "font-size", "font-weight", "line-height", "width", "height", "margin", "padding", "border", "z-index", "overflow"];
  return await executeInTab(tab.id, (sel, props, includeInherited) => {
    const element = document.querySelector(sel);
    if (!element) throw new Error(`Element not found: ${sel}`);
    const style = getComputedStyle(element);
    const computed = Object.fromEntries(props.map((property) => [property, style.getPropertyValue(property).slice(0, 500)]));
    const rect = element.getBoundingClientRect();
    const matched_rules = [];
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of [...rules]) {
        if (!rule.selectorText || !rule.style) continue;
        try {
          if (!element.matches(rule.selectorText)) continue;
          const declarations = Object.fromEntries(props.filter((property) => rule.style.getPropertyValue(property)).map((property) => [property, rule.style.getPropertyValue(property).slice(0, 300)]));
          if (Object.keys(declarations).length) matched_rules.push({ selector: rule.selectorText.slice(0, 500), declarations, source: sheet.href ? new URL(sheet.href).origin + new URL(sheet.href).pathname : "inline" });
        } catch { /* Ignore selectors unsupported by the document's CSS engine. */ }
        if (matched_rules.length >= 80) break;
      }
      if (matched_rules.length >= 80) break;
    }
    let inherited = [];
    if (includeInherited) {
      for (let parent = element.parentElement, depth = 1; parent && depth <= 5; parent = parent.parentElement, depth++) {
        const parentStyle = getComputedStyle(parent);
        inherited.push({ depth, tag: parent.tagName.toLowerCase(), properties: Object.fromEntries(["color", "font-family", "font-size", "font-weight", "line-height"].map((property) => [property, parentStyle.getPropertyValue(property).slice(0, 300)])) });
      }
    }
    return { selector: sel, tag: element.tagName.toLowerCase(), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, computed, matched_rules, ...(includeInherited ? { inherited } : {}) };
  }, [selector, properties, params.include_inherited === true]);
}

async function extractTable(tab, params, executeInTab) {
  const selector = String(params.selector || "table").trim();
  const data = await executeInTab(tab.id, (sel, index, scanRows) => {
    const tables = [...document.querySelectorAll(sel)];
    const table = tables[index];
    if (!table || !(table instanceof HTMLTableElement)) throw new Error(`HTML table not found at index ${index}: ${sel}`);
    const headerRow = table.tHead?.rows?.[0] || table.rows[0];
    const headers = [...(headerRow?.cells || [])].map((cell, i) => (cell.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200) || `column_${i + 1}`);
    const totalRows = Math.max(0, table.rows.length - (headerRow ? 1 : 0));
    const rows = [];
    let usedCells = 0;
    let charBudget = 1_500_000;
    for (const row of [...table.rows].filter((candidate) => candidate !== headerRow).slice(0, Math.min(scanRows, 2_000))) {
      const sourceCells = [...row.cells].slice(0, Math.min(headers.length, 200));
      if (usedCells + sourceCells.length > 20_000) break;
      const cells = sourceCells.map((cell) => {
        const value = (cell.textContent || "").trim().replace(/\s+/g, " ").slice(0, Math.min(300, charBudget));
        charBudget -= value.length;
        return value;
      });
      usedCells += sourceCells.length;
      rows.push(Object.fromEntries(headers.slice(0, sourceCells.length).map((header, i) => [header, cells[i] ?? ""])));
      if (charBudget <= 0) break;
    }
    return { caption: table.caption?.textContent?.trim() || null, headers, row_count: totalRows, rows, tables_found: tables.length, truncated: rows.length < totalRows };
  }, [selector, Number(params.index) || 0, Math.max(1, Math.min(Number(params.scan_rows) || 2_000, 10_000))]);
  const allRows = data.rows || [];
  const where = params.where && typeof params.where === "object" ? params.where : {};
  const columns = Array.isArray(params.columns) ? params.columns : [];
  const normalized = (value) => String(value ?? "").trim().toLowerCase();
  const matches = allRows.filter((row) => Object.entries(where).every(([column, needle]) => {
    const key = Object.keys(row).find((candidate) => normalized(candidate) === normalized(column));
    const value = key === undefined ? Object.values(row).join(" ") : row[key];
    return normalized(value).includes(normalized(needle));
  }));
  const offset = Math.max(0, Number(params.offset) || 0);
  const maxRows = Math.max(1, Math.min(Number(params.max_rows) || 100, 1_000));
  const rows = matches.slice(offset, offset + maxRows).map((row) => columns.length ? Object.fromEntries(columns.map((column) => [column, row[Object.keys(row).find((key) => normalized(key) === normalized(column))] ?? ""])) : row);
  return { ...data, rows, ...(Object.keys(where).length ? { match_count: matches.length } : {}), truncated: Boolean(data.truncated) || offset + rows.length < matches.length, ...(offset ? { offset } : {}) };
}

function captureDataUrl(tab, format = "png") {
  return requireVisibleTab(tab).then(() => chrome.tabs.captureVisibleTab(tab.windowId, format === "jpeg"
    ? { format, quality: 55 }
    : { format }));
}

async function imageFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("Could not decode the captured screenshot");
  return await createImageBitmap(await response.blob());
}

async function normalizeBitmap(bitmap) {
  if (bitmap.width * bitmap.height <= MAX_CAPTURE_PIXELS) return bitmap;
  const scale = Math.sqrt(MAX_CAPTURE_PIXELS / (bitmap.width * bitmap.height));
  const width = Math.max(1, Math.floor(bitmap.width * scale));
  const height = Math.max(1, Math.floor(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  return await createImageBitmap(await canvas.convertToBlob({ type: "image/png" }));
}

async function imageToDataUrl(bitmap, { type = "image/png", quality } = {}) {
  bitmap = await normalizeBitmap(bitmap);
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: type === "image/png" });
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type, ...(quality !== undefined ? { quality } : {}) });
  if (blob.size > 4 * 1024 * 1024) throw new Error("Screenshot exceeds Pi Bridge's 4 MiB image limit");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function captureElement(tab, selector, executeInTab) {
  const initial = await executeInTab(tab.id, () => ({ x: window.scrollX, y: window.scrollY }));
  try {
    const rect = await executeInTab(tab.id, (sel) => {
      const element = document.querySelector(sel);
      if (!element) throw new Error(`Element not found: ${sel}`);
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
    }, [selector]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dataUrl = await captureDataUrl(tab);
    const bitmap = await imageFromDataUrl(dataUrl);
    const ratioX = bitmap.width / rect.viewportWidth;
    const ratioY = bitmap.height / rect.viewportHeight;
    const x = Math.max(0, Math.floor(rect.x * ratioX));
    const y = Math.max(0, Math.floor(rect.y * ratioY));
    const width = Math.min(bitmap.width - x, Math.max(1, Math.ceil(rect.width * ratioX)));
    const height = Math.min(bitmap.height - y, Math.max(1, Math.ceil(rect.height * ratioY)));
    if (width < 1 || height < 1) throw new Error("The selected element is outside the captured viewport");
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const cropped = await createImageBitmap(await canvas.convertToBlob({ type: "image/png" }));
    return await imageToDataUrl(cropped);
  } finally {
    await executeInTab(tab.id, (x, y) => { scrollTo(x, y); return true; }, [initial.x, initial.y]).catch(() => {});
  }
}

async function screenshotDiff(tab, params, executeInTab) {
  const action = params.action;
  const name = String(params.name || "default").trim();
  if (!/^[\p{L}\p{N}_.-]{1,80}$/u.test(name)) throw new Error("name must contain 1–80 letters, numbers, dots, underscores or dashes");
  const key = `${DIFF_STORAGE_PREFIX}${name}`;
  if (action === "list") {
    const all = await chrome.storage.local.get(null);
    return { baselines: Object.keys(all).filter((item) => item.startsWith(DIFF_STORAGE_PREFIX)).map((item) => item.slice(DIFF_STORAGE_PREFIX.length)) };
  }
  if (action === "clear") {
    await chrome.storage.local.remove(key);
    return { cleared: name };
  }
  const imageUrl = params.selector
    ? await captureElement(tab, String(params.selector).trim(), executeInTab)
    : await captureDataUrl(tab);
  if (action === "baseline") {
    const bitmap = await normalizeBitmap(await imageFromDataUrl(imageUrl));
    const storedImage = await imageToDataUrl(bitmap);
    await chrome.storage.local.set({ [key]: { image: storedImage, width: bitmap.width, height: bitmap.height, saved_at: Date.now(), url: redactPageUrl(tab.url) } });
    return { baseline: name, width: bitmap.width, height: bitmap.height, saved_at: new Date().toISOString() };
  }
  if (action !== "compare") throw new Error("Unsupported screenshot_diff action");
  const stored = (await chrome.storage.local.get(key))[key];
  if (!stored?.image) throw new Error(`Baseline not found: ${name}`);
  const [baselineRaw, currentRaw] = await Promise.all([imageFromDataUrl(stored.image), imageFromDataUrl(imageUrl)]);
  const [baseline, current] = await Promise.all([normalizeBitmap(baselineRaw), normalizeBitmap(currentRaw)]);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return { reason: "size_mismatch", baseline: { width: baseline.width, height: baseline.height }, current: { width: current.width, height: current.height }, diff_percent: 100 };
  }
  const width = baseline.width;
  const height = baseline.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(baseline, 0, 0);
  const before = context.getImageData(0, 0, width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(current, 0, 0);
  const after = context.getImageData(0, 0, width, height);
  const image = context.createImageData(width, height);
  const threshold = params.threshold == null ? 10 : Math.max(0, Math.min(Number(params.threshold) || 0, 255));
  let changed = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    const delta = Math.max(Math.abs(before.data[index] - after.data[index]), Math.abs(before.data[index + 1] - after.data[index + 1]), Math.abs(before.data[index + 2] - after.data[index + 2]));
    if (delta > threshold) {
      changed++;
      image.data[index] = 255;
      image.data[index + 1] = Math.max(0, 80 - delta);
      image.data[index + 2] = Math.max(0, 80 - delta);
      image.data[index + 3] = 255;
    } else {
      const grey = Math.round((after.data[index] + after.data[index + 1] + after.data[index + 2]) / 3 * 0.35);
      image.data[index] = grey;
      image.data[index + 1] = grey;
      image.data[index + 2] = grey;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const diffBitmap = await createImageBitmap(await canvas.convertToBlob({ type: "image/png" }));
  const diffUrl = await imageToDataUrl(diffBitmap);
  return { baseline: name, width, height, changed_pixels: changed, total_pixels: width * height, diff_percent: Number((changed / (width * height) * 100).toFixed(3)), diff_image: diffUrl.slice(diffUrl.indexOf(",") + 1), mime_type: "image/png" };
}

async function auditPage(tab, params, executeInTab) {
  return await executeInTab(tab.id, (requestedKinds, scope, maxFindings) => {
    const kinds = new Set(requestedKinds?.length ? requestedKinds : ["accessibility", "seo", "security", "links", "vitals", "resources"]);
    const root = scope ? document.querySelector(scope) : document;
    if (!root) throw new Error(`Audit scope not found: ${scope}`);
    const findings = [];
    const add = (kind, severity, message, selector) => {
      if (findings.length < maxFindings) findings.push({ kind, severity, message: String(message).slice(0, 500), ...(selector ? { selector: String(selector).slice(0, 300) } : {}) });
    };
    const elementPath = (element) => element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase();
    if (kinds.has("accessibility")) {
      for (const image of root.querySelectorAll("img:not([alt])")) add("accessibility", "warning", "Image has no alt attribute", elementPath(image));
      for (const control of root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")) {
        const label = control.getAttribute("aria-label") || control.getAttribute("title") || control.labels?.[0]?.innerText || control.innerText || control.value || "";
        if (!String(label).trim()) add("accessibility", "warning", "Interactive element has no accessible name", elementPath(control));
      }
      for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) if (!heading.innerText.trim()) add("accessibility", "warning", "Heading is empty", elementPath(heading));
    }
    if (kinds.has("keyboard")) {
      for (const element of root.querySelectorAll("[tabindex]")) if (Number(element.getAttribute("tabindex")) > 0) add("keyboard", "warning", "Positive tabindex can create a confusing focus order", elementPath(element));
      const focusable = [...root.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].filter((element) => !element.disabled && element.tabIndex >= 0);
      if (focusable.length === 0) add("keyboard", "information", "No keyboard-focusable controls were found");
    }
    if (kinds.has("seo")) {
      if (!document.title.trim()) add("seo", "warning", "Document title is empty");
      if (!document.querySelector('meta[name="description"]')?.content?.trim()) add("seo", "warning", "Meta description is missing or empty");
      if (document.querySelectorAll("h1").length !== 1) add("seo", "information", `Expected one h1; found ${document.querySelectorAll("h1").length}`);
      if (!document.querySelector('link[rel="canonical"]')) add("seo", "information", "Canonical link is missing");
    }
    if (kinds.has("security")) {
      const mixed = [...document.querySelectorAll("img[src], script[src], iframe[src], link[href]")].filter((element) => {
        const attribute = element.hasAttribute("src") ? "src" : "href";
        return location.protocol === "https:" && /^http:/i.test(element.getAttribute(attribute) || "");
      });
      for (const element of mixed.slice(0, 30)) add("security", "warning", "HTTPS page loads an HTTP resource", elementPath(element));
      for (const form of root.querySelectorAll("form[action^='http:']")) add("security", "warning", "Form submits over HTTP", elementPath(form));
      if (location.protocol === "https:" && !document.querySelector('meta[http-equiv="Content-Security-Policy"]')) add("security", "information", "No page-level CSP meta element; response headers were not inspected");
    }
    if (kinds.has("links")) {
      for (const anchor of root.querySelectorAll("a")) {
        if (!anchor.getAttribute("href")) add("links", "warning", "Anchor has no href", elementPath(anchor));
        if (anchor.target === "_blank" && !/\bnoopener\b/i.test(anchor.rel)) add("links", "information", "New-tab link lacks rel=noopener", elementPath(anchor));
      }
    }
    if (kinds.has("vitals")) {
      const navigation = performance.getEntriesByType("navigation")[0];
      if (navigation) add("vitals", "information", `Navigation duration ${Math.round(navigation.duration)} ms; DOM content loaded ${Math.round(navigation.domContentLoadedEventEnd)} ms`);
      const resources = performance.getEntriesByType("resource");
      add("vitals", "information", `${resources.length} resource timing entries; live LCP/INP/CLS observation is not started by this audit`);
    }
    if (kinds.has("css")) {
      let count = 0;
      for (const sheet of [...document.styleSheets]) {
        try { count += sheet.cssRules.length; } catch { add("css", "information", "A cross-origin stylesheet could not be inspected"); }
      }
      add("css", "information", `${count} accessible CSS rules inspected at the stylesheet level`);
    }
    if (kinds.has("resources")) {
      const entries = performance.getEntriesByType("resource");
      const groups = {};
      for (const item of entries) {
        const type = item.initiatorType || "other";
        groups[type] = (groups[type] || 0) + 1;
      }
      add("resources", "information", `${entries.length} resources: ${Object.entries(groups).map(([type, count]) => `${type}=${count}`).join(", ") || "none"}`);
    }
    if (kinds.has("cache")) {
      const entries = performance.getEntriesByType("resource");
      const unknown = entries.filter((item) => !item.transferSize).length;
      add("cache", "information", `${unknown} of ${entries.length} resource timing entries report zero transferSize; this can mean cache use or unavailable timing data`);
    }
    return { url: `${location.origin}${location.pathname}`, title: document.title.slice(0, 300), findings, findings_returned: findings.length, truncated: findings.length >= maxFindings, note: "Read-only DOM audit; it does not send link checks or inspect response headers." };
  }, [params.kinds || [], params.scope || "", Math.max(1, Math.min(Number(params.max_findings) || 200, 500))]);
}

async function clipboard(params) {
  const permission = params.action === "read" ? "clipboardRead" : "clipboardWrite";
  await requirePermission(permission);
  await requirePermission("offscreen");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
  if (!contexts.length) {
    try {
      await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["CLIPBOARD"], justification: "Read or write clipboard text only after an explicit Pi confirmation." });
    } catch (error) {
      const afterRace = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
      if (!afterRace.length) throw error;
    }
  }
  const result = await chrome.runtime.sendMessage({ type: "pi-browser-bridge:clipboard", action: params.action, text: params.text || "" });
  if (result?.error) throw new Error(result.error);
  return result;
}

async function windowLayout(params) {
  const action = params.action;
  const name = String(params.name || "").trim();
  const stored = (await chrome.storage.local.get(LAYOUTS_STORAGE_KEY))[LAYOUTS_STORAGE_KEY] || {};
  if (action === "list") return { layouts: Object.keys(stored).sort() };
  if (!name || name.length > 80) throw new Error("name must contain 1–80 characters");
  if (action === "delete") {
    delete stored[name];
    await chrome.storage.local.set({ [LAYOUTS_STORAGE_KEY]: stored });
    return { deleted: name };
  }
  if (action === "save") {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal", "popup"] });
    stored[name] = {
      saved_at: Date.now(),
      windows: windows.map((window) => ({
        type: window.type,
        left: window.left,
        top: window.top,
        width: window.width,
        height: window.height,
        state: window.state === "maximized" ? "maximized" : "normal",
        tabs: (window.tabs || []).map((tab) => redactPageUrl(tab.url)).filter(Boolean),
      })),
    };
    await chrome.storage.local.set({ [LAYOUTS_STORAGE_KEY]: stored });
    return { saved: name, windows: stored[name].windows.length, saved_at: new Date(stored[name].saved_at).toISOString() };
  }
  if (action !== "restore") throw new Error("Unsupported window layout action");
  const layout = stored[name];
  if (!layout) throw new Error(`Window layout not found: ${name}`);
  const current = await chrome.windows.getAll({ populate: true, windowTypes: ["normal", "popup"] });
  const used = new Set();
  const restored = [];
  for (const target of layout.windows) {
    let best = null;
    let score = 0;
    for (const candidate of current) {
      if (used.has(candidate.id) || candidate.type !== target.type) continue;
      const candidateUrls = new Set((candidate.tabs || []).map((tab) => redactPageUrl(tab.url)).filter(Boolean));
      const overlap = target.tabs.filter((url) => candidateUrls.has(url)).length;
      if (overlap > score) { score = overlap; best = candidate; }
    }
    if (!best || score === 0) { restored.push({ matched: false, tab_paths: target.tabs.length }); continue; }
    used.add(best.id);
    const update = { left: target.left, top: target.top, width: target.width, height: target.height, state: target.state };
    await chrome.windows.update(best.id, update);
    restored.push({ matched: true, window_id: best.id, overlapping_tabs: score, bounds: { left: target.left, top: target.top, width: target.width, height: target.height } });
  }
  return { restored: name, windows: restored, unmatched: restored.filter((item) => !item.matched).length };
}

async function tileWindows(params, executeInTab) {
  const all = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const ids = Array.isArray(params.window_ids) ? new Set(params.window_ids) : null;
  const windows = all.filter((window) => !ids || ids.has(window.id));
  if (!windows.length) throw new Error("No normal Chrome windows matched the request");
  let area = params.area;
  if (!area) {
    const reference = all.find((window) => window.id === params.reference_window_id) || windows[0];
    const tab = (reference.tabs || []).find((candidate) => candidate.active) || (await chrome.tabs.query({ active: true, windowId: reference.id }))[0];
    if (!tab?.id) throw new Error("Provide area or use a normal Chrome window with an active scriptable tab");
    area = await executeInTab(tab.id, () => ({ left: screen.availLeft || 0, top: screen.availTop || 0, width: screen.availWidth, height: screen.availHeight }));
  }
  const padding = Math.max(0, Math.min(Number(params.padding) || 0, 200));
  const left = Math.round(area.left + padding);
  const top = Math.round(area.top + padding);
  const width = Math.max(320, Math.floor(area.width - padding * 2));
  const height = Math.max(240, Math.floor(area.height - padding * 2));
  const count = windows.length;
  let columns = params.layout === "columns" ? count : params.layout === "rows" ? 1 : Math.ceil(Math.sqrt(count));
  let rows = params.layout === "rows" ? count : Math.ceil(count / columns);
  const results = [];
  for (let index = 0; index < count; index++) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x0 = Math.floor(col * width / columns);
    const x1 = Math.floor((col + 1) * width / columns);
    const y0 = Math.floor(row * height / rows);
    const y1 = Math.floor((row + 1) * height / rows);
    const bounds = { left: left + x0, top: top + y0, width: x1 - x0, height: y1 - y0, state: "normal" };
    const updated = await chrome.windows.update(windows[index].id, bounds);
    results.push({ window_id: updated.id, ...bounds });
  }
  return { tiled: results.length, layout: params.layout || "grid", windows: results };
}

async function moveTab(params) {
  const tab = await chrome.tabs.get(params.tab_id);
  if (params.new_window === true) {
    const created = await chrome.windows.create({
      tabId: tab.id,
      type: "normal",
      focused: false,
      ...(Number.isInteger(params.left) ? { left: params.left } : {}),
      ...(Number.isInteger(params.top) ? { top: params.top } : {}),
      ...(Number.isInteger(params.width) ? { width: params.width } : {}),
      ...(Number.isInteger(params.height) ? { height: params.height } : {}),
    });
    return { tab_id: tab.id, window_id: created.id, moved: true, new_window: true };
  }
  if (!Number.isInteger(params.window_id)) throw new Error("Provide window_id or set new_window=true");
  const target = await chrome.windows.get(params.window_id);
  if (target.type !== "normal") throw new Error("Tabs can only be moved into normal Chrome windows");
  const moved = await chrome.tabs.move(tab.id, { windowId: target.id, index: Number.isInteger(params.index) ? params.index : -1 });
  return { tab_id: moved.id, window_id: moved.windowId, index: moved.index, moved: true };
}

async function tabAction(params) {
  const tab = await chrome.tabs.get(params.tab_id);
  if (params.action === "close") {
    await chrome.tabs.remove(tab.id);
    return { closed: true, tab_id: tab.id };
  }
  if (params.action === "activate") {
    await chrome.windows.update(tab.windowId, { focused: true });
    const active = await chrome.tabs.update(tab.id, { active: true });
    return { active: true, tab_id: active.id, window_id: active.windowId };
  }
  if (params.action === "reload") {
    await chrome.tabs.reload(tab.id, { bypassCache: params.bypass_cache === true });
    return { reloaded: true, tab_id: tab.id, bypass_cache: params.bypass_cache === true };
  }
  if (params.action === "back") {
    await chrome.tabs.goBack(tab.id);
    return { went_back: true, tab_id: tab.id };
  }
  throw new Error("Unsupported tab action");
}

async function hover(tab, params, executeInTab, withDebugger) {
  await requireVisibleTab(tab);
  const selector = String(params.selector || "").trim();
  const box = await executeInTab(tab.id, (sel) => {
    const element = document.querySelector(sel);
    if (!element) throw new Error(`Element not found: ${sel}`);
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("Element is not visible");
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  }, [selector]);
  return await withDebugger(tab.id, async (target) => {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, button: "none" });
    return { hovered: true, tab_id: tab.id, selector, point: { x: Math.round(box.x), y: Math.round(box.y) }, active_tab_unchanged: true };
  });
}

async function getFrames(tab) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      let url;
      try { url = new URL(location.href); } catch { return { url: "", title: String(document.title || "").slice(0, 300) }; }
      for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[REDACTED]");
      url.hash = "";
      return { url: url.href.slice(0, 2_000), title: String(document.title || "").slice(0, 300) };
    },
  });
  return { tab_id: tab.id, frames: results.slice(0, 100).map((item) => ({ frame_id: item.frameId, document_id: item.documentId, ...(item.result || {}) })) };
}

async function queryDom(tab, params, executeInTab) {
  const selector = String(params.selector || "*").trim();
  const scope = String(params.scope || "").trim();
  const limit = Math.max(1, Math.min(Number(params.limit) || 50, 100));
  return await executeInTab(tab.id, (sel, scopeSelector, max) => {
    const root = scopeSelector ? document.querySelector(scopeSelector) : document;
    if (!root) throw new Error(`Scope not found: ${scopeSelector}`);
    const nodes = [...root.querySelectorAll(sel)].slice(0, max).map((element) => {
      const rect = element.getBoundingClientRect();
      const attributes = {};
      for (const attribute of [...element.attributes].slice(0, 30)) {
        if (/^(value|srcdoc|nonce|integrity)$/i.test(attribute.name) || /password|secret|token|auth|csrf|cookie/i.test(attribute.name)) continue;
        attributes[attribute.name] = attribute.name === "href" || attribute.name === "src"
          ? (() => { try { const url = new URL(attribute.value, location.href); url.search = ""; url.hash = ""; return url.href; } catch { return ""; } })()
          : attribute.value.slice(0, 300);
      }
      return { tag: element.tagName.toLowerCase(), id: element.id || "", classes: [...element.classList].slice(0, 20), text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300), attributes, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, visible: rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden" };
    });
    return { selector: sel, total_returned: nodes.length, limit: max, elements: nodes };
  }, [selector, scope, limit]);
}

async function readForm(tab, params, executeInTab) {
  const selector = String(params.selector || "form").trim();
  return await executeInTab(tab.id, (sel, index) => {
    const forms = [...document.querySelectorAll(sel)];
    const form = forms[index];
    if (!form) throw new Error(`Form not found: ${sel}`);
    const controls = [...form.querySelectorAll("input,select,textarea,button")].slice(0, 100).map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: String(element.type || "").toLowerCase(),
      name: String(element.name || "").slice(0, 200),
      id: String(element.id || "").slice(0, 200),
      label: String(element.labels?.[0]?.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 300),
      required: Boolean(element.required),
      disabled: Boolean(element.disabled),
      autocomplete: String(element.autocomplete || "").slice(0, 100),
      ...(element instanceof HTMLSelectElement ? { options: [...element.options].slice(0, 50).map((option) => ({ text: option.textContent.trim().slice(0, 200), disabled: option.disabled })) } : {}),
    }));
    return { action: String(form.getAttribute("action") || location.href).split("?")[0], method: String(form.method || "get").toLowerCase(), controls, values_omitted: true };
  }, [selector, Math.max(0, Number(params.index) || 0)]);
}

async function getTabs() {
  const windows = await chrome.windows.getAll({ populate: true });
  const tabs = windows.flatMap((window) => (window.tabs || []).map((tab) => ({
    id: tab.id,
    window_id: tab.windowId,
    index: tab.index,
    title: String(tab.title || "").slice(0, 300),
    url: redactPageUrl(tab.url),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    window_type: window.type,
  })));
  return { windows: windows.map(({ id, type, state, left, top, width, height }) => ({ id, type, state, left, top, width, height })), tabs };
}

async function dismissOverlays(tab, params, executeInTab) {
  const action = params.action === "reject" ? "reject" : "close";
  return await executeInTab(tab.id, (kind) => {
    const candidates = [...document.querySelectorAll("button, [role=button], input[type=button], input[type=submit]")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden" && !element.disabled;
    });
    const label = (element) => `${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.title || ""} ${element.value || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
    const pattern = kind === "reject" ? /reject|decline|necessary only|essential only|only necessary/ : /^(close|dismiss|not now|maybe later|no thanks|×|x)$/;
    const target = candidates.find((element) => pattern.test(label(element)));
    if (!target) return { dismissed: false, reason: "No clearly labeled close or reject control was found; no page action was taken" };
    const text = label(target).slice(0, 160);
    target.click();
    return { dismissed: true, action: kind, label: text };
  }, [action]);
}

async function handleDialog(tab, params, withDebugger, handleJavaScriptDialog) {
  const action = params.action;
  if (!["accept", "dismiss"].includes(action)) throw new Error("action must be accept or dismiss");
  if (typeof handleJavaScriptDialog === "function") return await handleJavaScriptDialog(tab.id, action, params.prompt_text);
  return await withDebugger(tab.id, async (target) => {
    await chrome.debugger.sendCommand(target, "Page.handleJavaScriptDialog", {
      accept: action === "accept",
      ...(action === "accept" && params.prompt_text ? { promptText: String(params.prompt_text).slice(0, 2_000) } : {}),
    });
    return { handled: true, action, tab_id: tab.id };
  });
}

async function dragAndDrop(tab, params, executeInTab, withDebugger) {
  const source = String(params.source_selector || "").trim();
  const target = String(params.target_selector || "").trim();
  const boxes = await executeInTab(tab.id, (sourceSelector, targetSelector) => {
    const center = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Drag element not found: ${selector}`);
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error(`Drag element is not visible: ${selector}`);
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    return { source: center(sourceSelector), target: center(targetSelector) };
  }, [source, target]);
  if (params.mode === "pointer") {
    await requireVisibleTab(tab);
    return await withDebugger(tab.id, async (debugTarget) => {
      await chrome.debugger.sendCommand(debugTarget, "Input.dispatchMouseEvent", { type: "mouseMoved", ...boxes.source, button: "none" });
      await chrome.debugger.sendCommand(debugTarget, "Input.dispatchMouseEvent", { type: "mousePressed", ...boxes.source, button: "left", buttons: 1, clickCount: 1 });
      await chrome.debugger.sendCommand(debugTarget, "Input.dispatchMouseEvent", { type: "mouseMoved", ...boxes.target, button: "left", buttons: 1 });
      await chrome.debugger.sendCommand(debugTarget, "Input.dispatchMouseEvent", { type: "mouseReleased", ...boxes.target, button: "left", buttons: 0, clickCount: 1 });
      return { dragged: true, mode: "pointer", active_tab_unchanged: true };
    });
  }
  return await executeInTab(tab.id, (sourceSelector, targetSelector) => {
    const sourceElement = document.querySelector(sourceSelector);
    const targetElement = document.querySelector(targetSelector);
    if (!sourceElement || !targetElement) throw new Error("Source or target element disappeared before drop");
    const transfer = new DataTransfer();
    const emit = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    emit(sourceElement, "dragstart");
    emit(targetElement, "dragenter");
    emit(targetElement, "dragover");
    emit(targetElement, "drop");
    emit(sourceElement, "dragend");
    return { dragged: true, mode: "html5" };
  }, [source, target]);
}

async function executePageCode(tab, params) {
  await requirePermission("userScripts");
  let userScripts;
  try { userScripts = chrome.userScripts; } catch { userScripts = undefined; }
  if (!userScripts?.execute) throw new Error("Chrome userScripts.execute is unavailable; update Chrome and enable the Pi Bridge user-scripts toggle in extension details");
  const target = { tabId: tab.id, ...(Number.isInteger(params.frame_id) ? { frameIds: [params.frame_id] } : {}) };
  const results = await userScripts.execute({ target, js: [{ code: String(params.code || "") }], world: "MAIN" });
  const result = results?.[0];
  if (result?.error != null) throw new Error(String(result.error).slice(0, 500));
  let value = result?.result ?? null;
  let serialized;
  try { serialized = JSON.stringify(value); } catch { serialized = String(value); }
  if (serialized && serialized.length > 24_000) value = `${serialized.slice(0, 24_000)}…[truncated; original result was ${serialized.length} characters]`;
  return { result: value, tab_id: tab.id, frame_id: params.frame_id ?? 0 };
}

function parseTabHttpUrl(tab) {
  try {
    const url = new URL(tab.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid scheme");
    return url;
  } catch { throw new Error("Cookie and site-storage tools need the selected tab on an HTTP or HTTPS page"); }
}

async function getStorage(tab, params, executeInTab) {
  const type = params.type || "all";
  if (type === "cookies" || type === "all") await requirePermission("cookies");
  const result = {};
  if (type === "localStorage" || type === "sessionStorage" || type === "all") {
    const storageType = type === "sessionStorage" ? "sessionStorage" : "localStorage";
    const data = await executeInTab(tab.id, (kind) => {
      const storage = kind === "sessionStorage" ? sessionStorage : localStorage;
      const values = {};
      let truncated = storage.length > 200;
      for (let index = 0; index < Math.min(storage.length, 200); index++) {
        const key = storage.key(index);
        if (key != null) {
          const value = String(storage.getItem(key) || "");
          if (value.length > 1_000) truncated = true;
          values[key.slice(0, 200)] = value.slice(0, 1_000);
        }
      }
      return { values, truncated };
    }, [storageType]);
    result[storageType] = data.values;
    if (data.truncated) result[`${storageType}_truncated`] = true;
    if (type === "all") {
      const session = await executeInTab(tab.id, () => {
        const values = {};
        let truncated = sessionStorage.length > 200;
        for (let index = 0; index < Math.min(sessionStorage.length, 200); index++) {
          const key = sessionStorage.key(index);
          if (key != null) {
            const value = String(sessionStorage.getItem(key) || "");
            if (value.length > 1_000) truncated = true;
            values[key.slice(0, 200)] = value.slice(0, 1_000);
          }
        }
        return { values, truncated };
      });
      result.sessionStorage = session.values;
      if (session.truncated) result.sessionStorage_truncated = true;
    }
  }
  if (type === "cookies" || type === "all") {
    const cookies = await chrome.cookies.getAll({ url: parseTabHttpUrl(tab).href });
    result.cookies = cookies.slice(0, 200).map((cookie) => {
      if (cookie.value.length > 1_000) result.cookies_truncated = true;
      return { name: cookie.name.slice(0, 200), value: cookie.value.slice(0, 1_000), domain: cookie.domain, path: cookie.path, secure: cookie.secure, http_only: cookie.httpOnly, same_site: cookie.sameSite, expires: cookie.expirationDate ?? null };
    });
    if (cookies.length > 200) result.cookies_truncated = true;
  }
  return result;
}

async function setStorage(tab, params, executeInTab) {
  const { type, action, key, value } = params;
  if (["cookie", "cookies"].includes(type)) {
    await requirePermission("cookies");
    const pageUrl = parseTabHttpUrl(tab);
    const existing = await chrome.cookies.getAll({ url: pageUrl.href });
    if (action === "clear") {
      const removed = await Promise.all(existing.map((cookie) => chrome.cookies.remove({ url: pageUrl.href, name: cookie.name, storeId: cookie.storeId })));
      return { removed: removed.filter(Boolean).length, type: "cookies" };
    }
    if (action === "remove") {
      if (!key) throw new Error("key is required to remove a cookie");
      const removed = await chrome.cookies.remove({ url: pageUrl.href, name: key });
      return { removed: Boolean(removed), key };
    }
    if (action !== "set" || !key) throw new Error("Cookie storage needs action=set/remove/clear and a key");
    const rawPath = String(params.path || "/");
    if (!rawPath.startsWith("/") || rawPath.startsWith("//") || rawPath.includes("?") || rawPath.includes("#")) throw new Error("Cookie path must be a same-origin absolute path without query or fragment");
    let cookieUrl;
    try { cookieUrl = new URL(rawPath, pageUrl.origin).href; } catch { throw new Error("Cookie path is invalid"); }
    const cookie = await chrome.cookies.set({
      url: cookieUrl,
      name: String(key).slice(0, 300),
      value: String(value || "").slice(0, 5_000),
      ...(params.domain ? { domain: String(params.domain).slice(0, 300) } : {}),
      ...(params.secure !== undefined ? { secure: params.secure } : {}),
      ...(params.http_only !== undefined ? { httpOnly: params.http_only } : {}),
      ...(params.same_site ? { sameSite: params.same_site } : {}),
      ...(Number.isFinite(params.expires) ? { expirationDate: params.expires } : {}),
    });
    if (!cookie) throw new Error("Chrome refused to set this cookie");
    return { set: true, name: cookie.name, domain: cookie.domain, path: cookie.path };
  }
  if (!["localStorage", "sessionStorage"].includes(type)) throw new Error("type must be localStorage, sessionStorage, or cookie");
  if (!["set", "remove", "clear"].includes(action)) throw new Error("action must be set, remove, or clear");
  if (action !== "clear" && !key) throw new Error("key is required for this storage action");
  return await executeInTab(tab.id, (storageType, operation, storageKey, storageValue) => {
    const storage = storageType === "sessionStorage" ? sessionStorage : localStorage;
    if (operation === "clear") { storage.clear(); return { cleared: true, type: storageType }; }
    if (operation === "remove") { storage.removeItem(storageKey); return { removed: true, key: storageKey }; }
    storage.setItem(storageKey, storageValue);
    return { set: true, key: storageKey, value_length: storageValue.length };
  }, [type, action, String(key || "").slice(0, 300), String(value || "").slice(0, 5_000)]);
}

async function httpRequest(params) {
  await requirePermission("cookies");
  let url;
  try { url = new URL(params.url); } catch { throw new Error("url must be an absolute HTTP or HTTPS URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only HTTP or HTTPS URLs without embedded credentials are allowed");
  const method = params.method || "GET";
  if (params.body !== undefined && ["GET", "HEAD"].includes(method)) throw new Error(`${method} requests cannot include a body`);
  const init = { method, credentials: "include", redirect: "error", headers: params.headers || {} };
  if (params.body !== undefined) init.body = String(params.body).slice(0, 100_000);
  let response;
  try { response = await fetch(url.href, init); }
  catch (error) { throw new Error(`Authenticated browser request failed or redirected: ${String(error?.message || error).slice(0, 300)}`); }
  const contentType = response.headers.get("content-type") || "";
  const maxBytes = 2 * 1024 * 1024;
  let received = 0;
  let body = "";
  let truncated = false;
  if (method !== "HEAD" && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = maxBytes - received;
      const chunk = value.subarray(0, Math.max(0, remaining));
      received += chunk.length;
      body += decoder.decode(chunk, { stream: true });
      if (chunk.length < value.length || received >= maxBytes) { truncated = true; await reader.cancel().catch(() => {}); break; }
    }
    body += decoder.decode();
  }
  const maxChars = Math.max(500, Math.min(Number(params.max_length) || 12_000, 24_000));
  const text = body.slice(0, maxChars);
  return { status: response.status, ok: response.ok, content_type: contentType.slice(0, 200), url: redactPageUrl(response.url || url.href), size_bytes_read: received, body: text, truncated: truncated || body.length > text.length };
}

export async function injectCss(tab, params, executeInTab) {
  const name = String(params.name || "default").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "default";
  const id = `pi-browser-bridge-style-${name}`;
  if (params.action === "remove") return await executeInTab(tab.id, (styleId) => {
    const style = document.getElementById(styleId);
    if (style) style.remove();
    return { removed: Boolean(style), id: styleId };
  }, [id]);
  const css = String(params.css || "");
  if (!css || css.length > 20_000) throw new Error("css must contain 1–20000 characters");
  if (/@import|url\s*\(|expression\s*\(/i.test(css)) throw new Error("CSS imports and url()/expression() values are refused to prevent external data requests");
  return await executeInTab(tab.id, (styleId, text) => {
    let style = document.getElementById(styleId);
    if (!style) { style = document.createElement("style"); style.id = styleId; style.dataset.piBrowserBridge = "true"; document.documentElement.append(style); }
    style.textContent = text;
    return { injected: true, id: styleId, characters: text.length };
  }, [id, css]);
}

async function modifyDom(tab, params, executeInTab) {
  const selector = String(params.selector || "").trim();
  const action = params.action;
  const allowedAttributes = new Set(["aria-label", "aria-describedby", "aria-hidden", "title", "alt", "class", "role", "placeholder"]);
  if (["set_attribute", "remove_attribute"].includes(action) && !allowedAttributes.has(String(params.attribute || "").toLowerCase())) throw new Error("Only non-sensitive presentation/accessibility attributes can be changed");
  return await executeInTab(tab.id, (sel, operation, attribute, value) => {
    const element = document.querySelector(sel);
    if (!element) throw new Error(`Element not found: ${sel}`);
    if (operation === "set_text") { element.textContent = value; return { changed: true, action: operation, text_length: value.length }; }
    if (operation === "set_attribute") { element.setAttribute(attribute, value); return { changed: true, action: operation, attribute }; }
    if (operation === "remove_attribute") { element.removeAttribute(attribute); return { changed: true, action: operation, attribute }; }
    if (operation === "add_class") { element.classList.add(value); return { changed: true, action: operation, class_name: value }; }
    if (operation === "remove_class") { element.classList.remove(value); return { changed: true, action: operation, class_name: value }; }
    if (operation === "remove") { element.remove(); return { changed: true, action: operation }; }
    throw new Error("Unsupported DOM modification");
  }, [selector, action, String(params.attribute || "").slice(0, 100), String(params.value || "").slice(0, 5_000)]);
}

async function measureSpacing(tab, params, executeInTab) {
  const selectors = Array.isArray(params.selectors) ? params.selectors.slice(0, 20) : [];
  if (!selectors.length) throw new Error("selectors must contain at least one CSS selector");
  return await executeInTab(tab.id, (items) => items.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) return { selector, found: false };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      selector,
      found: true,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      margin: { top: style.marginTop, right: style.marginRight, bottom: style.marginBottom, left: style.marginLeft },
      padding: { top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft },
      gap_to_previous: null,
    };
  }).map((item, index, all) => {
    if (!item.found || index === 0) return item;
    const previous = all[index - 1];
    if (!previous.found) return item;
    return { ...item, gap_to_previous: { horizontal: item.rect.x - (previous.rect.x + previous.rect.width), vertical: item.rect.y - (previous.rect.y + previous.rect.height) } };
  }), [selectors]);
}

async function viewportResize(tab, params, executeInTab) {
  const key = `piBrowserBridgeViewport:${tab.windowId}`;
  const window = await chrome.windows.get(tab.windowId);
  if (params.action === "reset") {
    const saved = (await chrome.storage.local.get(key))[key];
    if (!saved) throw new Error("No previous viewport size is saved for this window");
    await chrome.windows.update(tab.windowId, { left: saved.left, top: saved.top, width: saved.width, height: saved.height, state: saved.state });
    await chrome.storage.local.remove(key);
  } else {
    if (!Number.isInteger(params.width) || !Number.isInteger(params.height)) throw new Error("set requires integer width and height");
    const existing = (await chrome.storage.local.get(key))[key];
    if (!existing) await chrome.storage.local.set({ [key]: { left: window.left, top: window.top, width: window.width, height: window.height, state: window.state } });
    await chrome.windows.update(tab.windowId, { width: Math.max(320, Math.min(params.width, 4_000)), height: Math.max(240, Math.min(params.height, 4_000)), state: "normal" });
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  const viewport = await executeInTab(tab.id, () => ({ width: innerWidth, height: innerHeight, device_pixel_ratio: devicePixelRatio }));
  return { window_id: tab.windowId, viewport, action: params.action || "set" };
}

async function emulateMedia(tab, params, withDebugger) {
  const allowed = new Set(["prefers-color-scheme", "prefers-reduced-motion", "forced-colors", "prefers-contrast"]);
  const features = (params.features || []).filter((feature) => allowed.has(feature.name)).map((feature) => ({ name: feature.name, value: feature.value }));
  return await withDebugger(tab.id, async (target) => {
    await chrome.debugger.sendCommand(target, "Emulation.setEmulatedMedia", {
      ...(params.media ? { media: params.media } : { media: "" }),
      features: params.action === "clear" ? [] : features,
    });
    return { emulated: params.action !== "clear", media: params.media || "screen", features };
  });
}

async function setGeolocation(tab, params, withDebugger) {
  if (params.action === "set" && (!Number.isFinite(params.latitude) || !Number.isFinite(params.longitude) || Math.abs(params.latitude) > 90 || Math.abs(params.longitude) > 180)) throw new Error("set requires latitude in [-90,90] and longitude in [-180,180]");
  return await withDebugger(tab.id, async (target) => {
    if (params.action === "clear") await chrome.debugger.sendCommand(target, "Emulation.clearGeolocationOverride");
    else await chrome.debugger.sendCommand(target, "Emulation.setGeolocationOverride", { latitude: params.latitude, longitude: params.longitude, accuracy: Math.max(1, Math.min(Number(params.accuracy) || 10, 10_000)) });
    return { changed: true, action: params.action || "set", ...(params.action !== "clear" ? { latitude: params.latitude, longitude: params.longitude, accuracy: params.accuracy || 10 } : {}) };
  });
}

async function findText(tab, params, executeInTab) {
  const text = String(params.text || "");
  if (!text || text.length > 2_048) throw new Error("text must contain 1–2048 characters");
  return await executeInTab(tab.id, (needle, max) => {
    const target = needle.toLocaleLowerCase();
    const matches = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && matches.length < max) {
      const node = walker.currentNode;
      const value = (node.nodeValue || "").trim().replace(/\s+/g, " ");
      const index = value.toLocaleLowerCase().indexOf(target);
      if (index < 0) continue;
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
      const rect = parent.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      matches.push({ text: value.slice(Math.max(0, index - 80), Math.min(value.length, index + needle.length + 120)), tag: parent.tagName.toLowerCase(), id: parent.id || "", x: Math.round(rect.x), y: Math.round(rect.y) });
    }
    return { matches, count: matches.length, truncated: matches.length >= max };
  }, [text, Math.max(1, Math.min(Number(params.max_results) || 20, 100))]);
}

async function assertPage(tab, params, executeInTab) {
  const result = await executeInTab(tab.id, (check) => {
    const url = `${location.origin}${location.pathname}`;
    const title = document.title || "";
    const elementCount = check.selector ? document.querySelectorAll(check.selector).length : null;
    const textFound = check.text ? (document.body?.innerText || "").includes(check.text) : null;
    const urlMatches = check.url ? url.includes(check.url) : null;
    const titleMatches = check.title ? title.includes(check.title) : null;
    const passed = (check.selector ? (check.count !== undefined || elementCount > 0) : true) && (check.count !== undefined ? elementCount === check.count : true) && (check.text ? textFound : true) && (check.url ? urlMatches : true) && (check.title ? titleMatches : true);
    return { passed, url, title, ...(elementCount !== null ? { element_count: elementCount } : {}), ...(textFound !== null ? { text_found: textFound } : {}), ...(urlMatches !== null ? { url_matches: urlMatches } : {}), ...(titleMatches !== null ? { title_matches: titleMatches } : {}) };
  }, [params]);
  if (!result.passed) throw new Error(`Page assertion failed: ${JSON.stringify(result)}`);
  return result;
}

async function sessionFixture(tab, params, executeInTab) {
  const stored = (await chrome.storage.local.get(SESSION_FIXTURES_KEY))[SESSION_FIXTURES_KEY] || {};
  const action = params.action;
  const name = String(params.name || "").trim();
  if (action === "list") return { fixtures: Object.keys(stored).sort() };
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(name)) throw new Error("name must contain 1–60 letters, numbers, underscores, or dashes");
  if (action === "delete") {
    delete stored[name];
    await chrome.storage.local.set({ [SESSION_FIXTURES_KEY]: stored });
    return { deleted: name };
  }
  await requirePermission("cookies");
  const origin = parseTabHttpUrl(tab).origin;
  if (action === "save") {
    const data = await getStorage(tab, { type: "all" }, executeInTab);
    if (data.localStorage_truncated || data.sessionStorage_truncated || data.cookies_truncated) throw new Error("Session snapshot exceeds the per-category capture limit; refusing to save an incomplete fixture");
    const fixture = { saved_at: Date.now(), origin, ...data };
    if (JSON.stringify(fixture).length > 1_500_000) throw new Error("Session fixture exceeds the 1.5 MB storage limit");
    stored[name] = fixture;
    await chrome.storage.local.set({ [SESSION_FIXTURES_KEY]: stored });
    return { saved: name, origin, local_keys: Object.keys(data.localStorage || {}).length, session_keys: Object.keys(data.sessionStorage || {}).length, cookie_count: (data.cookies || []).length };
  }
  if (action !== "restore") throw new Error("Unsupported session fixture action");
  const fixture = stored[name];
  if (!fixture) throw new Error(`Session fixture not found: ${name}`);
  if (fixture.origin !== origin) throw new Error(`Fixture origin is ${fixture.origin}; current page is ${origin}`);
  const restored = await executeInTab(tab.id, (localValues, sessionValues) => {
    for (const [key, value] of Object.entries(localValues || {})) localStorage.setItem(key, value);
    for (const [key, value] of Object.entries(sessionValues || {})) sessionStorage.setItem(key, value);
    return { local_keys: Object.keys(localValues || {}).length, session_keys: Object.keys(sessionValues || {}).length };
  }, [fixture.localStorage || {}, fixture.sessionStorage || {}]);
  let cookiesRestored = 0;
  const currentHost = parseTabHttpUrl(tab).hostname;
  for (const cookie of fixture.cookies || []) {
    const domain = String(cookie.domain || currentHost).replace(/^\./, "");
    if (currentHost !== domain && !currentHost.endsWith(`.${domain}`)) continue;
    const rawPath = String(cookie.path || "/");
    const path = rawPath.startsWith("/") && !rawPath.startsWith("//") ? rawPath : "/";
    let cookieUrl;
    try { cookieUrl = new URL(path, origin).href; } catch { continue; }
    const result = await chrome.cookies.set({
      url: cookieUrl,
      name: String(cookie.name).slice(0, 200),
      value: String(cookie.value || "").slice(0, 1_000),
      ...(cookie.domain ? { domain: cookie.domain } : {}),
      path,
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.http_only),
      ...(new Set(["no_restriction", "lax", "strict"]).has(cookie.same_site) ? { sameSite: cookie.same_site } : {}),
      ...(Number.isFinite(cookie.expires) ? { expirationDate: cookie.expires } : {}),
    });
    if (result) cookiesRestored++;
  }
  return { restored: name, origin, ...restored, cookies_restored: cookiesRestored };
}

async function waitForTabLoad(tabId, timeoutMs = 20_000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return true;
  return await new Promise((resolve) => {
    let settled = false;
    const listener = (updatedId, info) => { if (updatedId === tabId && info.status === "complete") finish(true); };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function cookieAudit(tab, params, executeInTab) {
  await requirePermission("cookies");
  await requirePermission("webRequest");
  installNetworkListeners();
  const originUrl = parseTabHttpUrl(tab);
  const before = await chrome.cookies.getAll({ url: originUrl.href });
  const removed = await Promise.all(before.map((cookie) => chrome.cookies.remove({ url: originUrl.href, name: cookie.name, storeId: cookie.storeId })));
  networkByTab.set(tab.id, []);
  await chrome.tabs.reload(tab.id);
  await waitForTabLoad(tab.id, 20_000);
  const settleMs = Math.max(250, Math.min(Number(params.settle_ms) || 1_000, 5_000));
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const afterLoad = await chrome.cookies.getAll({ url: originUrl.href });
  const requests = networkByTab.get(tab.id) || [];
  const beforeConsentCount = requests.length;
  const requestsBeforeConsent = requests.map((request) => ({ url: request.url, type: request.type, status: request.status, method: request.method }));
  let consentClicked = false;
  if (params.consent_selector) {
    const currentTab = await chrome.tabs.get(tab.id);
    if (parseTabHttpUrl(currentTab).origin !== originUrl.origin) throw new Error("The page redirected to another origin after cookie clearing; refusing to click the consent selector there");
    await executeInTab(tab.id, (selector) => {
      const button = document.querySelector(selector);
      if (!button || button.disabled) throw new Error("Consent selector did not match an enabled control");
      button.click();
      return true;
    }, [String(params.consent_selector)]);
    consentClicked = true;
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  const afterConsent = consentClicked ? await chrome.cookies.getAll({ url: originUrl.href }) : [];
  const requestsAfterConsent = consentClicked ? (networkByTab.get(tab.id) || []).slice(beforeConsentCount).map((request) => ({ url: request.url, type: request.type, status: request.status, method: request.method })) : [];
  return {
    origin: originUrl.origin,
    cookies_cleared: removed.filter(Boolean).length,
    cookies_before: before.map((cookie) => ({ name: cookie.name, domain: cookie.domain, secure: cookie.secure, http_only: cookie.httpOnly })),
    cookies_after_initial_load: afterLoad.map((cookie) => ({ name: cookie.name, domain: cookie.domain, secure: cookie.secure, http_only: cookie.httpOnly })),
    cookies_after_consent: afterConsent.map((cookie) => ({ name: cookie.name, domain: cookie.domain, secure: cookie.secure, http_only: cookie.httpOnly })),
    requests_before_consent: requestsBeforeConsent.slice(0, 200),
    requests_after_consent: requestsAfterConsent.slice(0, 200),
    consent_clicked: consentClicked,
    note: "Cookie values are omitted. Clearing site cookies may sign you out.",
  };
}

async function manageDownloads(params, waitForDownload, downloadSummary) {
  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));
  if (params.action === "list") {
    const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit });
    return { downloads: items.map((item) => ({ id: item.id, state: item.state, filename: item.filename.split(/[\\/]/).at(-1), bytes_received: item.bytesReceived, total_bytes: item.totalBytes, url: redactedNetworkUrl(item.finalUrl || item.url), danger: item.danger })) };
  }
  if (params.action === "download") {
    let url;
    try { url = new URL(params.url); } catch { throw new Error("url must be an absolute HTTP or HTTPS URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only HTTP or HTTPS download URLs without embedded credentials are allowed");
    const id = await chrome.downloads.download({ url: url.href, ...(params.filename ? { filename: String(params.filename).split(/[\\/]/).at(-1).slice(0, 120) } : {}), conflictAction: "uniquify", saveAs: false });
    return downloadSummary(await waitForDownload({ downloadId: id, timeoutMs: params.timeout_ms, maxBytes: params.max_bytes }));
  }
  if (params.action === "wait_for_complete") {
    const [item] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    if (!item) return { complete: false, reason: "no downloads" };
    const completed = await waitForDownload({ downloadId: item.id, timeoutMs: params.timeout_ms, maxBytes: params.max_bytes });
    return { complete: true, ...downloadSummary(completed) };
  }
  throw new Error("Unsupported download management action");
}

async function extractItems(tab, params, executeInTab) {
  const itemSelector = String(params.item_selector || "").trim();
  const fields = params.fields && typeof params.fields === "object" ? params.fields : {};
  const maxItems = Math.max(1, Math.min(Number(params.max_items) || 50, 100));
  return await executeInTab(tab.id, (itemsSelector, fieldMap, limit) => {
    const blocks = [...document.querySelectorAll(itemsSelector)].slice(0, limit);
    const records = blocks.map((block) => Object.fromEntries(Object.entries(fieldMap).map(([name, descriptor]) => {
      const target = descriptor.selector ? block.querySelector(descriptor.selector) : block;
      if (!target) return [name, null];
      if (descriptor.attr) {
        if (/^(value|srcdoc|nonce|integrity)$/i.test(descriptor.attr) || /password|secret|token|auth|csrf|cookie/i.test(descriptor.attr)) return [name, "[omitted]"];
        const value = target.getAttribute(descriptor.attr);
        if (value == null) return [name, null];
        if (["href", "src"].includes(descriptor.attr.toLowerCase())) {
          try { const url = new URL(value, location.href); url.search = ""; url.hash = ""; return [name, url.href.slice(0, 1_000)]; } catch { return [name, ""]; }
        }
        return [name, value.slice(0, 1_000)];
      }
      return [name, (target.textContent || "").trim().replace(/\s+/g, " ").slice(0, 1_000)];
    })));
    return { items: records, returned: records.length, limit, truncated: blocks.length >= limit };
  }, [itemSelector, fields, maxItems]);
}

async function trackEvents(tab, params) {
  await requirePermission("webRequest");
  installNetworkListeners();
  if (params.clear) networkByTab.set(tab.id, []);
  if (Number(params.wait_ms) > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(Number(params.wait_ms), 5_000)));
  const patterns = /google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|connect\.facebook|tiktok|analytics|collect|pixel|hotjar|clarity/i;
  const entries = (networkByTab.get(tab.id) || []).filter((request) => patterns.test(request.url));
  return { tab_id: tab.id, events: entries.slice(-100).map((request) => ({ url: request.url, method: request.method, type: request.type, status: request.status, error: request.error, started_at: request.started_at })), count: entries.length, truncated: entries.length > 100, note: "Metadata only; POST bodies and identifiers are not decoded." };
}

async function findSetting(tab, params, executeInTab) {
  const keyword = String(params.keyword || "").trim();
  const maxPages = Math.max(1, Math.min(Number(params.max_pages) || 25, 25));
  if (!keyword || keyword.length > 200) throw new Error("keyword must contain 1–200 characters");
  let start;
  try { start = new URL(tab.url); } catch { throw new Error("find_setting requires an HTTP or HTTPS page"); }
  if (!["http:", "https:"].includes(start.protocol) || start.username || start.password) throw new Error("find_setting requires an HTTP or HTTPS page");
  const temp = await chrome.tabs.create({ url: start.href, active: false, windowId: tab.windowId });
  const visited = new Set([start.href]);
  const queue = [];
  const menuSelector = String(params.menu_selector || "nav, aside, [role=navigation], .sidebar, .navbar, .menu").slice(0, 500);
  const scan = async () => executeInTab(temp.id, (needle, menu) => {
    const body = document.body?.innerText || "";
    const index = body.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
    const snippet = index < 0 ? null : body.slice(Math.max(0, index - 100), Math.min(body.length, index + needle.length + 200)).replace(/\s+/g, " ");
    const links = [...document.querySelectorAll(`${menu} a[href]`)].map((anchor) => ({ url: anchor.href, text: (anchor.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160) })).slice(0, 100);
    return { snippet, links };
  }, [keyword, menuSelector]);
  const enqueue = (links) => {
    for (const link of links) {
      try {
        const url = new URL(link.url);
        if (url.origin !== start.origin || /logout|logoff|sign.?out|delete|remove|purchase|checkout|cancel/i.test(`${link.text} ${url.pathname}`) || visited.has(url.href) || queue.some((entry) => entry.url === url.href)) continue;
        queue.push({ url: url.href, text: link.text });
      } catch { /* Ignore invalid menu links. */ }
    }
    queue.sort((a, b) => Number(!a.text.toLowerCase().includes(keyword.toLowerCase())) - Number(!b.text.toLowerCase().includes(keyword.toLowerCase())));
  };
  const waitForTab = async () => {
    if ((await chrome.tabs.get(temp.id)).status === "complete") return true;
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve(value);
      };
      const listener = (id, info) => { if (id === temp.id && info.status === "complete") finish(true); };
      const timer = setTimeout(() => finish(false), 15_000);
      chrome.tabs.onUpdated.addListener(listener);
    });
  };
  try {
    await waitForTab();
    let result = await scan();
    if (result.snippet) return { found: true, url: redactPageUrl(temp.url || start.href), pages_visited: 1, snippet: result.snippet };
    enqueue(result.links);
    let pagesVisited = 1;
    while (queue.length && pagesVisited < maxPages) {
      const next = queue.shift();
      if (visited.has(next.url)) continue;
      visited.add(next.url);
      await chrome.tabs.update(temp.id, { url: next.url });
      if (!await waitForTab()) continue;
      pagesVisited++;
      result = await scan();
      if (result.snippet) return { found: true, url: redactPageUrl(next.url), menu_path: next.text, pages_visited: pagesVisited, snippet: result.snippet };
      enqueue(result.links);
    }
    return { found: false, pages_visited: pagesVisited, links_left: queue.length };
  } finally {
    await chrome.tabs.remove(temp.id).catch(() => {});
  }
}

export async function watchDom(tab, params, executeInTab) {
  const selector = String(params.selector || "").trim();
  const timeout = Math.max(100, Math.min(Number(params.timeout_ms) || 10_000, 30_000));
  return await executeInTab(tab.id, (sel, limit) => new Promise((resolve) => {
    const element = sel ? document.querySelector(sel) : document.documentElement;
    if (!element) { resolve({ changed: false, reason: "selector not found", selector: sel }); return; }
    const start = Date.now();
    const observer = new MutationObserver((records) => {
      const changes = records.slice(0, 50).map((record) => ({ type: record.type, target: record.target.nodeName?.toLowerCase() || "", attribute: record.attributeName || null, added: record.addedNodes?.length || 0, removed: record.removedNodes?.length || 0 }));
      cleanup();
      resolve({ changed: true, selector: sel || "document", elapsed_ms: Date.now() - start, changes });
    });
    const timer = setTimeout(() => { cleanup(); resolve({ changed: false, reason: "timeout", selector: sel || "document", elapsed_ms: Date.now() - start }); }, limit);
    const cleanup = () => { clearTimeout(timer); observer.disconnect(); };
    observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
  }), [selector, timeout]);
}

async function watch(tab, params, executeInTab) {
  await requireVisibleTab(tab);
  const condition = params.condition;
  const value = String(params.value || "");
  const timeout = Math.max(100, Math.min(Number(params.timeout_ms) || 10_000, 30_000));
  return await executeInTab(tab.id, async (kind, needle, limit) => {
    const matches = () => kind === "text"
      ? (document.body?.innerText || "").includes(needle)
      : Boolean(document.querySelector(needle));
    if (matches()) return { changed: true, condition: kind, value: needle, already_present: true };
    const start = Date.now();
    return await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!matches()) return;
        cleanup();
        resolve({ changed: true, condition: kind, value: needle, elapsed_ms: Date.now() - start });
      });
      const timer = setTimeout(() => { cleanup(); resolve({ changed: false, condition: kind, value: needle, reason: "timeout", elapsed_ms: Date.now() - start }); }, limit);
      const cleanup = () => { clearTimeout(timer); observer.disconnect(); };
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: kind === "element" });
    });
  }, [condition, value, timeout]);
}

async function animations(tab, params, executeInTab) {
  return await executeInTab(tab.id, (action, selector, animationIndex) => {
    const root = selector ? document.querySelector(selector) : document;
    if (!root) throw new Error(`Animation scope not found: ${selector}`);
    const all = root.getAnimations({ subtree: true });
    if (action === "list") return { count: all.length, animations: all.slice(0, 200).map((animation, index) => ({ index, play_state: animation.playState, current_time: Number(animation.currentTime) || 0, playback_rate: animation.playbackRate, name: animation.id || "" })) };
    const index = Number(animationIndex);
    const target = Number.isInteger(index) ? all[index] : null;
    const chosen = target ? [target] : all;
    if (!chosen.length) return { changed: 0, action };
    for (const animation of chosen) {
      if (action === "pause") animation.pause();
      else if (action === "play") animation.play();
      else if (action === "cancel") animation.cancel();
      else throw new Error("action must be list, pause, play, or cancel");
    }
    return { changed: chosen.length, action };
  }, [params.action || "list", String(params.selector || "").trim(), Number.isInteger(params.animation_index) ? params.animation_index : -1]);
}

async function frameMetrics(tab, params, executeInTab) {
  await requireVisibleTab(tab);
  const duration = Math.max(500, Math.min(Number(params.duration_ms) || 2_000, 5_000));
  return await executeInTab(tab.id, async (limit) => {
    const intervals = [];
    let previous = null;
    const started = performance.now();
    while (performance.now() - started < limit) {
      await new Promise((resolve) => requestAnimationFrame((time) => { if (previous !== null) intervals.push(time - previous); previous = time; resolve(); }));
    }
    const sorted = intervals.slice().sort((a, b) => a - b);
    const long = intervals.filter((value) => value > 50).length;
    return { frames: intervals.length, duration_ms: Math.round(performance.now() - started), mean_interval_ms: intervals.length ? Number((intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(2)) : null, p95_interval_ms: sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2)) : null, frames_over_50ms: long, note: "Measured from requestAnimationFrame; background tabs may be throttled." };
  }, [duration]);
}

export async function savePage(tab) {
  await requirePermission("pageCapture");
  await requireVisibleTab(tab);
  const archive = await chrome.pageCapture.saveAsMHTML({ tabId: tab.id });
  if (!archive || !archive.size) throw new Error("Chrome did not return a page archive");
  if (archive.size > 5 * 1024 * 1024) throw new Error("MHTML page archive exceeds the 5 MiB size limit");
  const bytes = new Uint8Array(await archive.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return { mhtml_b64: btoa(binary), size_bytes: bytes.length, tab_id: tab.id };
}

async function handoff(tab, params, executeInTab, createHandoffWaiter) {
  await requireVisibleTab(tab);
  const message = String(params.message || "").trim();
  if (!message || message.length > 2_000) throw new Error("message must contain 1–2000 characters");
  if (typeof createHandoffWaiter !== "function") throw new Error("Handoff response bridge is unavailable");

  const timeout = Math.max(1_000, Math.min(Number(params.timeout_ms) || 60_000, 120_000));
  const handoffId = crypto.randomUUID();
  const hostId = `pi-browser-bridge-handoff-${handoffId}`;
  const waiter = createHandoffWaiter(tab.id, handoffId, timeout);
  try {
    const installed = await executeInTab(tab.id, (options) => {
      document.getElementById(options.host_id)?.remove();
      const host = document.createElement("div");
      host.id = options.host_id;
      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = ":host{all:initial;position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);font:14px/1.4 system-ui,sans-serif;color:#172033}*{box-sizing:border-box}.panel{width:min(640px,calc(100vw - 24px));padding:14px 16px;border:1px solid #aab6c8;border-radius:10px;background:#fff;box-shadow:0 8px 30px #0004}.message{white-space:pre-wrap;margin-bottom:10px}.hint{font-size:12px;color:#475569;margin-bottom:10px}textarea{display:block;width:100%;min-height:56px;margin:8px 0;padding:8px;border:1px solid #94a3b8;border-radius:6px;font:inherit}.buttons{display:flex;justify-content:flex-end;gap:8px}button{padding:6px 12px;border:0;border-radius:6px;cursor:pointer;font:inherit}.done{background:#1d4ed8;color:#fff}.cancel{background:#e2e8f0;color:#172033}";
      const panel = document.createElement("section");
      panel.className = "panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Pi Bridge user handoff");
      const messageNode = document.createElement("div");
      messageNode.className = "message";
      messageNode.textContent = options.message;
      panel.append(messageNode);
      if (options.pick_element) {
        const hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = `Click up to ${options.pick_max} element(s) on the page, then choose Done. The click will not activate the page control.`;
        panel.append(hint);
      }
      let answerInput = null;
      if (options.ask) {
        answerInput = document.createElement("textarea");
        answerInput.setAttribute("aria-label", "Reply to Pi");
        answerInput.placeholder = "Reply (do not enter passwords or one-time codes here)";
        panel.append(answerInput);
      }
      const buttons = document.createElement("div");
      buttons.className = "buttons";
      const cancel = document.createElement("button");
      cancel.className = "cancel";
      cancel.textContent = "Cancel";
      const done = document.createElement("button");
      done.className = "done";
      done.textContent = "Done";
      buttons.append(cancel, done);
      panel.append(buttons);
      shadow.append(style, panel);
      document.documentElement.append(host);

      const picked = [];
      const maxPick = Math.max(1, Math.min(Number(options.pick_max) || 1, 5));
      const selectorFor = (element) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const parts = [];
        for (let node = element; node && node !== document.body && parts.length < 6; node = node.parentElement) {
          let selector = node.tagName.toLowerCase();
          if (node.classList.length) selector += `.${[...node.classList].slice(0, 2).map((name) => CSS.escape(name)).join(".")}`;
          const parent = node.parentElement;
          if (parent) {
            const peers = [...parent.children].filter((child) => child.tagName === node.tagName);
            if (peers.length > 1) selector += `:nth-of-type(${peers.indexOf(node) + 1})`;
          }
          parts.unshift(selector);
        }
        return parts.join(" > ");
      };
      let settled = false;
      const registryKey = "__PI_BROWSER_BRIDGE_HANDOFF_CLEANUP__";
      const registry = globalThis[registryKey] || (globalThis[registryKey] = Object.create(null));
      const cleanup = () => {
        document.removeEventListener("click", onPick, true);
        host.remove();
        delete registry[options.handoff_id];
      };
      const finish = (action) => {
        if (settled) return;
        settled = true;
        const result = {
          action,
          url: `${location.origin}${location.pathname}`,
          ...(options.ask ? { answer: String(answerInput?.value || "").slice(0, 2_000) } : {}),
          ...(picked.length === 1 ? { picked: picked[0] } : {}),
          ...(picked.length > 1 ? { picked_all: picked } : {}),
        };
        cleanup();
        try {
          chrome.runtime.sendMessage({ type: "pi-browser-bridge:handoff-result", handoff_id: options.handoff_id, tab_id: options.tab_id, result }, () => { void chrome.runtime.lastError; });
        } catch { /* The broker timeout still resolves the MCP request if the worker is restarting. */ }
      };
      const onPick = (event) => {
        if (!host.isConnected) { document.removeEventListener("click", onPick, true); return; }
        if (!event.isTrusted || host.contains(event.target) || picked.length >= maxPick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const element = event.target instanceof Element ? event.target : event.target.parentElement;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        picked.push({ selector: selectorFor(element), tag: element.tagName.toLowerCase(), text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } });
        const hint = panel.querySelector(".hint");
        if (hint) hint.textContent = `Selected ${picked.length}/${maxPick}. Click another element or choose Done.`;
      };
      cancel.addEventListener("click", () => finish("cancel"));
      done.addEventListener("click", () => finish("done"));
      if (options.pick_element) document.addEventListener("click", onPick, true);
      registry[options.handoff_id] = cleanup;
      return { shown: true };
    }, [{ handoff_id: handoffId, host_id: hostId, tab_id: tab.id, message, pick_element: params.pick_element === true, ask: params.ask === true, pick_max: params.pick_max }]);
    if (!installed?.shown) throw new Error("Could not show the Pi Bridge handoff prompt");
    const result = await waiter.promise;
    if (result.action === "timeout") {
      await executeInTab(tab.id, (id) => {
        globalThis.__PI_BROWSER_BRIDGE_HANDOFF_CLEANUP__?.[id]?.();
        document.getElementById(id)?.remove();
        return true;
      }, [hostId]).catch(() => {});
    }
    return { ...result, url: result.url || redactPageUrl(tab.url) };
  } catch (error) {
    waiter.cancel();
    await executeInTab(tab.id, (id) => {
      globalThis.__PI_BROWSER_BRIDGE_HANDOFF_CLEANUP__?.[id]?.();
      document.getElementById(id)?.remove();
      return true;
    }, [hostId]).catch(() => {});
    throw error;
  }
}

async function perfTrace(tab, params, withDebugger) {
  await requireVisibleTab(tab);
  const duration = Math.max(500, Math.min(Number(params.duration_ms) || 2_000, 10_000));
  return await withDebugger(tab.id, async (target) => {
    const categoryCounts = new Map();
    const slowEvents = [];
    let eventCount = 0;
    let settled = false;
    let finishTrace;
    const completed = new Promise((resolve) => { finishTrace = resolve; });
    const listener = (source, method, payload) => {
      if (source.tabId !== tab.id) return;
      if (method === "Tracing.dataCollected") {
        for (const event of payload.value || []) {
          eventCount++;
          const category = String(event.cat || "other").split(",")[0].slice(0, 80);
          categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
          if (Number(event.dur) >= 50_000 && slowEvents.length < 500) slowEvents.push({ name: String(event.name || "").slice(0, 100), category, duration_ms: Number((event.dur / 1_000).toFixed(2)) });
        }
      }
      if (method === "Tracing.tracingComplete" && !settled) { settled = true; finishTrace(); }
    };
    chrome.debugger.onEvent.addListener(listener);
    try {
      await chrome.debugger.sendCommand(target, "Tracing.start", { categories: "devtools.timeline,v8,blink,loading,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
      await new Promise((resolve) => setTimeout(resolve, duration));
      await chrome.debugger.sendCommand(target, "Tracing.end");
      await Promise.race([completed, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      return { tab_id: tab.id, duration_ms: duration, events: eventCount, categories: Object.fromEntries(categoryCounts), slow_events: slowEvents.sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 30), truncated: eventCount > 100_000, note: "Trace events are summarized in memory; raw trace data and page contents are not returned." };
    } finally {
      chrome.debugger.onEvent.removeListener(listener);
      if (!settled) await chrome.debugger.sendCommand(target, "Tracing.end").catch(() => {});
    }
  });
}

async function screencast(tab, params, withDebugger) {
  await requireVisibleTab(tab);
  const duration = Math.max(500, Math.min(Number(params.duration_ms) || 3_000, 10_000));
  const maxFrames = Math.max(1, Math.min(Number(params.max_frames) || 10, 20));
  return await withDebugger(tab.id, async (target) => {
    const images = [];
    let imageChars = 0;
    let frameCount = 0;
    let stopped = false;
    const listener = (source, method, payload) => {
      if (source.tabId !== tab.id || method !== "Page.screencastFrame") return;
      frameCount++;
      if (images.length < maxFrames) {
        const data = String(payload.data || "");
        if (imageChars + data.length <= 5_000_000) { images.push(data); imageChars += data.length; }
      }
      chrome.debugger.sendCommand(target, "Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => {});
    };
    chrome.debugger.onEvent.addListener(listener);
    try {
      await chrome.debugger.sendCommand(target, "Page.enable");
      await chrome.debugger.sendCommand(target, "Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: 1_280, maxHeight: 800, everyNthFrame: 3 });
      await new Promise((resolve) => setTimeout(resolve, duration));
      await chrome.debugger.sendCommand(target, "Page.stopScreencast");
      stopped = true;
      return { tab_id: tab.id, duration_ms: duration, frame_count: frameCount, images, mime_type: "image/jpeg", truncated: frameCount > images.length };
    } finally {
      chrome.debugger.onEvent.removeListener(listener);
      if (!stopped) await chrome.debugger.sendCommand(target, "Page.stopScreencast").catch(() => {});
    }
  });
}

export async function executeAdvancedCommand(command, params, helpers) {
  const tabCommands = new Set(["get_css_styles", "read_console", "monitor_network", "screenshot_diff", "audit", "hover", "get_frames", "extract_table", "element_screenshot", "full_page_screenshot", "query_dom", "read_form", "dismiss_overlays", "handle_dialogs", "drag_and_drop", "execute_js", "get_storage", "set_storage", "inject_css", "modify_dom", "measure_spacing", "viewport_resize", "emulate_media", "set_geolocation", "find_text", "assert", "extract", "track_events", "find_setting", "cookie_audit", "watch_dom", "watch", "animations", "frames", "save_page", "handoff", "perf_trace", "screencast"]);
  const tab = tabCommands.has(command) || (command === "session_fixture" && ["save", "restore"].includes(params.action)) ? await helpers.getTab(params.tab_id) : null;
  switch (command) {
    case "get_css_styles": return await getCssStyles(tab, params, helpers.executeInTab);
    case "read_console": return await readConsole(tab, params);
    case "monitor_network": return await monitorNetwork(tab, params);
    case "network_rules": return await networkRules(params);
    case "screenshot_diff": return await screenshotDiff(tab, params, helpers.executeInTab);
    case "audit": return await auditPage(tab, params, helpers.executeInTab);
    case "clipboard": return await clipboard(params);
    case "window_layout": return await windowLayout(params);
    case "tile_windows": return await tileWindows(params, helpers.executeInTab);
    case "move_tab": return await moveTab(params);
    case "tab_action": return await tabAction(params);
    case "hover": return await hover(tab, params, helpers.executeInTab, helpers.withDebugger);
    case "get_frames": return await getFrames(tab);
    case "query_dom": return await queryDom(tab, params, helpers.executeInTab);
    case "read_form": return await readForm(tab, params, helpers.executeInTab);
    case "get_tabs": return await getTabs();
    case "dismiss_overlays": return await dismissOverlays(tab, params, helpers.executeInTab);
    case "handle_dialogs": return await handleDialog(tab, params, helpers.withDebugger, helpers.handleJavaScriptDialog);
    case "drag_and_drop": return await dragAndDrop(tab, params, helpers.executeInTab, helpers.withDebugger);
    case "execute_js": return await executePageCode(tab, params);
    case "get_storage": return await getStorage(tab, params, helpers.executeInTab);
    case "set_storage": return await setStorage(tab, params, helpers.executeInTab);
    case "http_request": return await httpRequest(params);
    case "inject_css": return await injectCss(tab, params, helpers.executeInTab);
    case "modify_dom": return await modifyDom(tab, params, helpers.executeInTab);
    case "measure_spacing": return await measureSpacing(tab, params, helpers.executeInTab);
    case "viewport_resize": return await viewportResize(tab, params, helpers.executeInTab);
    case "emulate_media": return await emulateMedia(tab, params, helpers.withDebugger);
    case "set_geolocation": return await setGeolocation(tab, params, helpers.withDebugger);
    case "find_text": return await findText(tab, params, helpers.executeInTab);
    case "assert": return await assertPage(tab, params, helpers.executeInTab);
    case "manage_downloads": return await manageDownloads(params, helpers.waitForDownload, helpers.downloadSummary);
    case "extract": return await extractItems(tab, params, helpers.executeInTab);
    case "track_events": return await trackEvents(tab, params);
    case "find_setting": return await findSetting(tab, params, helpers.executeInTab);
    case "session_fixture": return await sessionFixture(tab, params, helpers.executeInTab);
    case "cookie_audit": return await cookieAudit(tab, params, helpers.executeInTab);
    case "http_auth": return await setHttpAuth(params);
    case "save_page": return await savePage(tab);
    case "handoff": return await handoff(tab, params, helpers.executeInTab, helpers.createHandoffWaiter);
    case "perf_trace": return await perfTrace(tab, params, helpers.withDebugger);
    case "screencast": return await screencast(tab, params, helpers.withDebugger);
    case "watch_dom": return await watchDom(tab, params, helpers.executeInTab);
    case "watch": return await watch(tab, params, helpers.executeInTab);
    case "animations": return await animations(tab, params, helpers.executeInTab);
    case "frames": return await frameMetrics(tab, params, helpers.executeInTab);
    case "extract_table": return await extractTable(tab, params, helpers.executeInTab);
    case "element_screenshot": {
      await requireVisibleTab(tab);
      const image = await captureElement(tab, String(params.selector || "").trim(), helpers.executeInTab);
      return { image: image.slice(image.indexOf(",") + 1), mime_type: "image/png", tab_id: tab.id };
    }
    case "full_page_screenshot": {
      await requireVisibleTab(tab);
      const limit = Math.max(1, Math.min(Number(params.max_segments) || 6, 8));
      const page = await helpers.executeInTab(tab.id, () => ({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, fullHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) }));
      const count = Math.min(limit, Math.max(1, Math.ceil(page.fullHeight / page.height)));
      const images = [];
      let imageChars = 0;
      let hitOutputLimit = false;
      try {
        for (let index = 0; index < count; index++) {
          const y = Math.min(index * page.height, Math.max(0, page.fullHeight - page.height));
          await helpers.executeInTab(tab.id, (offset) => { scrollTo(0, offset); return true; }, [y]);
          // Chrome limits captureVisibleTab to two calls per second.
          await new Promise((resolve) => setTimeout(resolve, 600));
          const dataUrl = await captureDataUrl(tab, "jpeg");
          const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
          if (imageChars + encoded.length > 5_500_000) { hitOutputLimit = true; break; }
          imageChars += encoded.length;
          images.push(encoded);
        }
      } finally {
        await helpers.executeInTab(tab.id, (x, y) => { scrollTo(x, y); return true; }, [page.x, page.y]).catch(() => {});
      }
      return { images, mime_type: "image/jpeg", width: page.width, full_height: page.fullHeight, truncated: hitOutputLimit || count < Math.ceil(page.fullHeight / page.height), segment_height: page.height, tab_id: tab.id };
    }
    default: throw new Error(`Unknown advanced browser command: ${String(command).slice(0, 80)}`);
  }
}
