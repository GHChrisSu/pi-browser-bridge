const BRIDGE_URL = "ws://127.0.0.1:43177/bridge";
const RECONNECT_ALARM = "pi-browser-bridge-reconnect";
const MAX_TEXT = 24_000;
const MAX_INTERACTIVES = 100;
const WORKSPACE_PREFIX = "Pi Bridge: ";
const WORKSPACE_COLORS = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);
const MAX_BACKGROUND_READS = 5;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_INLINE_BLOB_BYTES = 20 * 1024 * 1024;
const MAX_DOWNLOAD_TIMEOUT_MS = 120_000;
const PROFILE_STORAGE_KEY = "piBrowserBridgeProfile";
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_NAME = /password|passcode|secret|token|csrf|authenticity|one.?time|otp|2fa|verification.?code|recovery.?code|private.?key/i;
const SAFE_KEYS = new Set(["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "]);

let socket = null;
let connectionState = "disconnected";
let reconnectTimer = null;
let reconnectDelay = 800;
let connectLock = null;
let refused = false;
let profileIdentity = null;
const profileIdentityReady = loadProfileIdentity().then((identity) => {
  profileIdentity = identity;
  return identity;
});

async function loadProfileIdentity() {
  const stored = (await chrome.storage.local.get(PROFILE_STORAGE_KEY))[PROFILE_STORAGE_KEY];
  const storedName = normalizeProfileName(stored?.name);
  if (typeof stored?.id === "string" && PROFILE_ID_PATTERN.test(stored.id) && storedName) {
    return { id: stored.id, name: storedName };
  }
  const id = crypto.randomUUID();
  const identity = { id, name: `Chrome profile ${id.slice(0, 4)}` };
  await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: identity });
  return identity;
}

function normalizeProfileName(value) {
  return String(value || "").normalize("NFC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

async function saveProfileName(value) {
  const identity = await profileIdentityReady;
  const name = normalizeProfileName(value) || `Chrome profile ${identity.id.slice(0, 4)}`;
  identity.name = name;
  await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: identity });
  if (socket && socket.readyState < WebSocket.CLOSING) {
    const previous = socket;
    socket = null;
    previous.close(1000, "Profile name changed");
  }
  refused = false;
  connect();
  return { profile_id: identity.id, profile_name: identity.name };
}

function status() {
  return {
    connected: connectionState === "connected",
    state: connectionState,
    extension_version: chrome.runtime.getManifest().version,
    profile_id: profileIdentity?.id || null,
    profile_name: profileIdentity?.name || "Loading profile…",
    note: connectionState === "connected" ? "Local connection to Pi is active." : "Start Pi; the extension reconnects automatically.",
  };
}

function setState(next) {
  connectionState = next;
  try {
    chrome.runtime.sendMessage({ type: "pi-browser-bridge:state", status: status() }, () => void chrome.runtime.lastError);
  } catch {
    // The popup is usually closed; service worker state remains authoritative.
  }
}

function scheduleReconnect(delay = reconnectDelay) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, delay + Math.floor(Math.random() * 250));
  reconnectDelay = Math.min(Math.round(reconnectDelay * 1.7), 15_000);
}

function connect() {
  if (connectLock) return connectLock;
  connectLock = (async () => {
    await profileIdentityReady;
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

    setState(refused ? "refused" : "connecting");
    let ws;
    try {
      ws = new WebSocket(BRIDGE_URL);
    } catch {
      setState("disconnected");
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: "hello",
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        profileId: profileIdentity.id,
        profileName: profileIdentity.name,
      }));
    };

    ws.onmessage = async (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "hello_ack") {
        refused = false;
        reconnectDelay = 800;
        setState("connected");
        return;
      }
      if (message.type === "hello_refused") {
        refused = true;
        setState("refused");
        try { ws.close(4409, "Bridge pairing refused"); } catch {}
        return;
      }
      if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
        return;
      }
      if (message.type !== "command" || typeof message.id !== "string") return;

      try {
        const data = await executeCommand(message.command, message.params || {});
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "result", id: message.id, data }));
      } catch (error) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", id: message.id, error: safeError(error) }));
        }
      }
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      setState(refused || event.code === 4409 ? "refused" : "disconnected");
      scheduleReconnect(refused ? 15_000 : reconnectDelay);
    };
    ws.onerror = () => {
      // onclose owns reconnect scheduling.
    };
  })().finally(() => { connectLock = null; });
  return connectLock;
}

function safeError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}

async function getTab(tabId) {
  if (Number.isInteger(tabId)) return chrome.tabs.get(tabId);
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs[0]?.id) throw new Error("No active Chrome tab is available");
  return tabs[0];
}

function redactedUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_NAME.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    url.hash = "";
    return url.href;
  } catch { return String(value || "").slice(0, 500); }
}

function isSafeWebUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Use an absolute HTTP or HTTPS URL"); }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Only HTTP and HTTPS pages can be opened");
  if (url.username || url.password) throw new Error("URLs with embedded usernames or passwords are refused");
  return url.href;
}

function targetFor(tabId) {
  return { tabId };
}

async function executeInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: targetFor(tabId), func, args });
  const result = results?.[0]?.result;
  if (result && typeof result === "object" && typeof result.__piBrowserBridgeError === "string") {
    throw new Error(result.__piBrowserBridgeError);
  }
  return result;
}

function textLimit(value, fallback = 12_000, maximum = MAX_TEXT) {
  return Math.max(500, Math.min(Number(value) || fallback, maximum));
}

async function readPage(tabId, limit) {
  return executeInTab(tabId, (max) => {
    const text = document.body?.innerText || "";
    return {
      title: document.title,
      url: `${location.origin}${location.pathname}`,
      text: text.slice(0, max),
      truncated: text.length > max,
    };
  }, [limit]);
}

async function getPiWorkspace(workspaceId) {
  let group;
  try { group = await chrome.tabGroups.get(workspaceId); } catch { throw new Error("Pi Bridge workspace not found"); }
  if (!group.title?.startsWith(WORKSPACE_PREFIX)) throw new Error("Only Pi Bridge workspaces can be changed by this tool");
  return group;
}

function tabSummary(tab, groupsById) {
  const group = groupsById.get(tab.groupId);
  return {
    id: tab.id,
    title: tab.title || "",
    url: redactedUrl(tab.url),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    window_id: tab.windowId,
    index: tab.index,
    workspace_id: group?.title?.startsWith(WORKSPACE_PREFIX) ? group.id : null,
    group_title: group?.title?.startsWith(WORKSPACE_PREFIX) ? group.title : null,
    group_color: group?.title?.startsWith(WORKSPACE_PREFIX) ? group.color : null,
    group_collapsed: group?.title?.startsWith(WORKSPACE_PREFIX) ? Boolean(group.collapsed) : null,
  };
}

function downloadSummary(item) {
  if (item.state !== "complete") throw new Error(`Chrome download is not complete: ${item.state}`);
  return {
    download_id: item.id,
    file_path: item.filename,
    file_name: item.filename.split(/[\\/]/).at(-1) || item.filename,
    source_url: redactedUrl(item.finalUrl || item.url),
    mime_type: item.mime || null,
    size_bytes: Number(item.totalBytes) >= 0 ? Number(item.totalBytes) : Number(item.bytesReceived) || 0,
    danger: item.danger || "unknown",
    state: item.state,
  };
}

function downloadUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Use an absolute HTTP or HTTPS download URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Direct downloads support only HTTP or HTTPS URLs; use download_media for page-created files");
  if (url.username || url.password) throw new Error("URLs with embedded usernames or passwords are refused");
  return url.href;
}

function waitForDownload({ downloadId: requestedId, tabId, startedAt = Date.now(), timeoutMs, maxBytes }) {
  const boundedTimeout = Math.max(1_000, Math.min(Number(timeoutMs) || 60_000, MAX_DOWNLOAD_TIMEOUT_MS));
  const boundedBytes = Math.max(1_024, Math.min(Number(maxBytes) || MAX_DOWNLOAD_BYTES, 100 * 1024 * 1024));
  return new Promise((resolve, reject) => {
    let downloadId = requestedId;
    let settled = false;
    let checking = false;
    let inspectAgain = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
    };
    const finish = (error, item) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(item);
    };
    const inspect = async () => {
      if (settled || !Number.isInteger(downloadId)) return;
      if (checking) { inspectAgain = true; return; }
      checking = true;
      do {
        inspectAgain = false;
        try {
          const [item] = await chrome.downloads.search({ id: downloadId });
          if (!item) throw new Error("Chrome did not report the requested download");
          const received = Number(item.bytesReceived) || 0;
          const total = Number(item.totalBytes);
          if (received > boundedBytes || (Number.isFinite(total) && total > boundedBytes)) {
            await chrome.downloads.cancel(downloadId).catch(() => {});
            throw new Error(`Download exceeded the ${boundedBytes}-byte limit and was cancelled`);
          }
          if (item.state === "interrupted") throw new Error(`Chrome download was interrupted: ${item.error || "unknown reason"}`);
          if (item.state === "complete") finish(null, item);
        } catch (error) {
          finish(error);
        }
      } while (inspectAgain && !settled);
      checking = false;
    };
    const onCreated = (item) => {
      if (downloadId !== undefined || !Number.isInteger(tabId) || item.tabId !== tabId) return;
      const createdAt = Date.parse(item.startTime || "");
      if (Number.isFinite(createdAt) && createdAt + 2_000 < startedAt) return;
      downloadId = item.id;
      void inspect();
    };
    const onChanged = (delta) => {
      if (downloadId !== undefined && delta.id === downloadId) void inspect();
    };
    const timer = setTimeout(() => finish(new Error(`Download did not finish within ${boundedTimeout} ms`)), boundedTimeout);
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
    void inspect();
  });
}

async function uploadFile(tab, params) {
  const selector = String(params.selector || "").trim();
  const targetOrigin = new URL(params.target_origin).origin;
  const filePath = String(params.file_path || "");
  if (!selector || selector.length > 2_048) throw new Error("selector must be set and under 2048 characters");
  if (!filePath || filePath.length > 8_192) throw new Error("file_path must be set and under 8192 characters");
  const page = await executeInTab(tab.id, (sel) => {
    const input = document.querySelector(sel);
    if (!input) throw new Error(`File input not found: ${sel}`);
    if (!(input instanceof HTMLInputElement) || input.type !== "file") throw new Error("Upload target must be an input[type=file]");
    if (input.disabled) throw new Error("File input is disabled");
    return { origin: location.origin, accept: input.accept || "", multiple: input.multiple };
  }, [selector]);
  if (page.origin !== targetOrigin) throw new Error(`Upload origin changed: expected ${targetOrigin}, current page is ${page.origin}`);

  const target = { tabId: tab.id };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "DOM.enable");
    const { root } = await chrome.debugger.sendCommand(target, "DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await chrome.debugger.sendCommand(target, "DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error("File input is not present in the top-level document");
    const description = await chrome.debugger.sendCommand(target, "DOM.describeNode", { nodeId });
    const node = description.node;
    const attributes = Object.fromEntries(Array.from({ length: (node.attributes || []).length / 2 }, (_, index) => [node.attributes[index * 2], node.attributes[index * 2 + 1]]));
    if (String(node.nodeName).toLowerCase() !== "input" || String(attributes.type || "").toLowerCase() !== "file") {
      throw new Error("Upload target must be an input[type=file]");
    }
    await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", { files: [filePath], nodeId });
    return {
      uploaded: true,
      tab_id: tab.id,
      origin: page.origin,
      file_name: filePath.split(/[\\/]/).at(-1),
      accept: page.accept,
      multiple: page.multiple,
    };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

function safeDownloadFilename(value, mimeType = "") {
  const extension = String(mimeType || "").toLowerCase() === "image/png" ? "png"
    : String(mimeType || "").toLowerCase() === "image/jpeg" ? "jpg"
      : String(mimeType || "").toLowerCase() === "image/webp" ? "webp"
        : String(mimeType || "").toLowerCase() === "image/gif" ? "gif" : "bin";
  let candidate = String(value || "").split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f<>:\"|?*]/g, "_").trim().replace(/^\.+|\.+$/g, "").slice(0, 120);
  if (!candidate || candidate === "..") candidate = "download";
  if (!/\.[A-Za-z0-9]{1,10}$/.test(candidate)) candidate = `${candidate}.${extension}`;
  return candidate;
}

async function downloadDataUrl(dataUrl, filename, mimeType, timeoutMs, maxBytes) {
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: safeDownloadFilename(filename, mimeType),
    conflictAction: "uniquify",
    saveAs: false,
  });
  return downloadSummary(await waitForDownload({ downloadId, timeoutMs, maxBytes }));
}

async function executeCommand(command, params) {
  switch (command) {
    case "get_status":
      return status();
    case "upload_file": {
      const tab = await getTab(params.tab_id);
      return await uploadFile(tab, params);
    }
    case "download_url": {
      const url = downloadUrl(params.url);
      const downloadId = await chrome.downloads.download({ url, conflictAction: "uniquify", saveAs: false });
      const item = await waitForDownload({ downloadId, timeoutMs: params.timeout_ms, maxBytes: params.max_bytes });
      return downloadSummary(item);
    }
    case "download_media": {
      const tab = await getTab(params.tab_id);
      const selector = String(params.selector || "").trim();
      if (!selector || selector.length > 2_048) throw new Error("selector must be a non-empty selector under 2048 characters");
      const timeoutMs = Math.max(1_000, Math.min(Number(params.timeout_ms) || 60_000, MAX_DOWNLOAD_TIMEOUT_MS));
      const maxBytes = Math.max(1_024, Math.min(Number(params.max_bytes) || MAX_DOWNLOAD_BYTES, 100 * 1024 * 1024));
      const target = await executeInTab(tab.id, (sel) => {
        const element = document.querySelector(sel);
        if (!element) throw new Error(`Download control not found: ${sel}`);
        if (element.disabled || element.getAttribute("aria-disabled") === "true") throw new Error("Download control is disabled");
        if (element instanceof HTMLInputElement && String(element.type).toLowerCase() === "file") throw new Error("This is an upload input, not a download control");
        const hrefAttribute = element instanceof HTMLAnchorElement ? element.getAttribute("href") || "" : "";
        if (/^javascript:/i.test(hrefAttribute)) throw new Error("Script links are refused as download targets");
        const url = element instanceof HTMLAnchorElement ? element.href
          : element instanceof HTMLImageElement ? element.currentSrc || element.src
            : element instanceof HTMLVideoElement ? element.currentSrc || element.src || element.poster
              : element instanceof HTMLAudioElement ? element.currentSrc || element.src
                : "";
        return {
          url,
          filename: element.getAttribute("download") || element.getAttribute("alt") || element.getAttribute("title") || "",
        };
      }, [selector]);
      if (target.url && /^https?:/i.test(target.url)) {
        const downloadId = await chrome.downloads.download({ url: downloadUrl(target.url), conflictAction: "uniquify", saveAs: false });
        return downloadSummary(await waitForDownload({ downloadId, timeoutMs, maxBytes }));
      }
      if (target.url && /^(?:blob:|data:)/i.test(target.url)) {
        const inlineLimit = Math.min(maxBytes, MAX_INLINE_BLOB_BYTES);
        if (target.url.startsWith("data:") && target.url.length > Math.ceil(inlineLimit * 1.5) + 4_096) throw new Error("Selected data URL exceeds the inline asset limit");
        const extracted = await executeInTab(tab.id, async (url, max) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Could not read selected page asset (${response.status})`);
          const blob = await response.blob();
          if (!blob.size) throw new Error("Selected page asset is empty");
          if (blob.size > max) throw new Error(`Selected page asset exceeds the ${max}-byte limit`);
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Could not encode selected page asset"));
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(blob);
          });
          return { data_url: dataUrl, mime_type: blob.type };
        }, [target.url, inlineLimit]);
        return await downloadDataUrl(extracted.data_url, target.filename, extracted.mime_type, timeoutMs, inlineLimit);
      }

      const downloadPromise = waitForDownload({ tabId: tab.id, startedAt: Date.now(), timeoutMs, maxBytes });
      try {
        await executeInTab(tab.id, (sel) => {
          const element = document.querySelector(sel);
          if (!element) throw new Error(`Download control not found: ${sel}`);
          element.scrollIntoView({ block: "center", behavior: "instant" });
          element.click();
          return { clicked: true };
        }, [selector]);
      } catch (error) {
        downloadPromise.catch(() => {});
        throw error;
      }
      return downloadSummary(await downloadPromise);
    }
    case "get_active_tab": {
      const tab = await getTab(params.tab_id);
      return { id: tab.id, title: tab.title || "", url: redactedUrl(tab.url), active: Boolean(tab.active) };
    }
    case "list_tabs": {
      const current = await getTab();
      const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId: current.windowId }),
        chrome.tabGroups.query({ windowId: current.windowId }),
      ]);
      const groupsById = new Map(groups.map((group) => [group.id, group]));
      return { window_id: current.windowId, tabs: tabs.map((tab) => tabSummary(tab, groupsById)) };
    }
    case "list_workspaces": {
      const current = await getTab();
      const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId: current.windowId }),
        chrome.tabGroups.query({ windowId: current.windowId }),
      ]);
      return {
        window_id: current.windowId,
        workspaces: groups.filter((group) => group.title?.startsWith(WORKSPACE_PREFIX)).map((group) => ({
          workspace_id: group.id,
          name: group.title.slice(WORKSPACE_PREFIX.length),
          color: group.color,
          collapsed: Boolean(group.collapsed),
          tabs: tabs.filter((tab) => tab.groupId === group.id).map((tab) => ({
            id: tab.id,
            title: tab.title || "",
            url: redactedUrl(tab.url),
            active: Boolean(tab.active),
          })),
        })),
      };
    }
    case "create_workspace": {
      const url = isSafeWebUrl(params.url);
      const name = String(params.name || "").trim().replace(/\s+/g, " ");
      if (!name || name.length > 40) throw new Error("Workspace name must contain 1–40 characters");
      const color = params.color || "blue";
      if (!WORKSPACE_COLORS.has(color)) throw new Error("Unsupported workspace color");
      const current = await getTab();
      const tab = await chrome.tabs.create({ url, active: false, windowId: current.windowId });
      try {
        const workspaceId = await chrome.tabs.group({ tabIds: [tab.id] });
        const group = await chrome.tabGroups.update(workspaceId, { title: `${WORKSPACE_PREFIX}${name}`, color, collapsed: false });
        const created = await chrome.tabs.get(tab.id);
        return {
          workspace_id: group.id,
          name,
          color: group.color,
          tab: tabSummary(created, new Map([[group.id, group]])),
          selected_tab_unchanged: true,
        };
      } catch (error) {
        await chrome.tabs.remove(tab.id).catch(() => {});
        throw error;
      }
    }
    case "create_tab": {
      const url = isSafeWebUrl(params.url);
      const workspaceId = params.workspace_id;
      if (Number.isInteger(workspaceId) && params.active === true) {
        throw new Error("Tabs added to a Pi Bridge workspace are always created in the background");
      }
      const workspace = Number.isInteger(workspaceId) ? await getPiWorkspace(workspaceId) : null;
      const current = await getTab();
      let tab = await chrome.tabs.create({
        url,
        active: params.active === true,
        windowId: workspace?.windowId ?? current.windowId,
      });
      try {
        if (workspace) {
          await chrome.tabs.group({ tabIds: [tab.id], groupId: workspace.id });
          tab = await chrome.tabs.get(tab.id);
        }
        const groups = workspace ? new Map([[workspace.id, workspace]]) : new Map();
        return { ...tabSummary(tab, groups), url: redactedUrl(tab.url || url), selected_tab_unchanged: params.active !== true };
      } catch (error) {
        await chrome.tabs.remove(tab.id).catch(() => {});
        throw error;
      }
    }
    case "read_urls": {
      if (!Array.isArray(params.urls) || params.urls.length < 1 || params.urls.length > MAX_BACKGROUND_READS) {
        throw new Error(`urls must contain 1–${MAX_BACKGROUND_READS} HTTP or HTTPS URLs`);
      }
      const urls = params.urls.map(isSafeWebUrl);
      const current = await getTab();
      const limit = textLimit(params.max_length, 8_000, 12_000);
      const results = await Promise.all(urls.map(async (url) => {
        let tab;
        try {
          tab = await chrome.tabs.create({ url, active: false, windowId: current.windowId });
          await waitForComplete(tab.id, 20_000);
          const loaded = await chrome.tabs.get(tab.id);
          isSafeWebUrl(loaded.url || url);
          return { ok: true, requested_url: redactedUrl(url), ...(await readPage(tab.id, limit)) };
        } catch (error) {
          return { ok: false, requested_url: redactedUrl(url), error: safeError(error) };
        } finally {
          if (Number.isInteger(tab?.id)) await chrome.tabs.remove(tab.id).catch(() => {});
        }
      }));
      return { selected_tab_unchanged: true, results };
    }
    case "navigate": {
      const url = isSafeWebUrl(params.url);
      const tab = await getTab(params.tab_id);
      const updated = await chrome.tabs.update(tab.id, { url });
      await waitForComplete(tab.id, 20_000);
      const current = await chrome.tabs.get(tab.id);
      return { id: current.id, title: current.title || "", url: redactedUrl(current.url || updated.url || url) };
    }
    case "read_page": {
      const tab = await getTab(params.tab_id);
      return await readPage(tab.id, textLimit(params.max_length));
    }
    case "list_page_assets": {
      const tab = await getTab(params.tab_id);
      const limit = Math.max(1, Math.min(Number(params.limit) || 60, 100));
      return await executeInTab(tab.id, (max) => {
        const selectorFor = (el) => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const testId = el.getAttribute("data-testid");
          if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
          const parts = [];
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && parts.length < 6) {
            const parent = node.parentElement;
            if (!parent) break;
            const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
            const ordinal = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : "";
            parts.unshift(`${node.tagName.toLowerCase()}${ordinal}`);
            node = parent;
          }
          return `body > ${parts.join(" > ")}`;
        };
        const visible = (el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const assets = [];
        const add = (element, kind, url, label) => {
          if (!url || assets.length >= max) return;
          assets.push({ selector: selectorFor(element), kind, url, label: String(label || "").trim().replace(/\s+/g, " ").slice(0, 160) });
        };
        for (const element of document.querySelectorAll("img, video, audio, source, a[download]")) {
          if (!visible(element)) continue;
          const tag = element.tagName.toLowerCase();
          const url = element instanceof HTMLAnchorElement ? element.href
            : element instanceof HTMLImageElement ? element.currentSrc || element.src
              : element instanceof HTMLVideoElement ? element.currentSrc || element.src || element.poster
                : element.src;
          const kind = tag === "video" || tag === "audio" ? "media" : tag === "a" ? "download-link" : "image";
          add(element, kind, url, element.getAttribute("alt") || element.getAttribute("title") || element.getAttribute("download") || element.getAttribute("aria-label") || "");
        }
        const safeUrl = (value) => {
          try {
            const url = new URL(value, location.href);
            if (["http:", "https:"].includes(url.protocol)) return `${url.origin}${url.pathname}`;
            if (url.protocol === "blob:") return `blob:${new URL(url.pathname).origin}/[object]`;
            if (url.protocol === "data:") return "data:[content omitted]";
            return `${url.protocol}[content omitted]`;
          } catch { return ""; }
        };
        return {
          title: document.title,
          page_url: `${location.origin}${location.pathname}`,
          assets: assets.map((asset) => ({ ...asset, url: safeUrl(asset.url) })),
          inline_svg_count: Math.min(document.querySelectorAll("svg").length, 500),
        };
      }, [limit]);
    }
    case "get_page_info": {
      const tab = await getTab(params.tab_id);
      return await executeInTab(tab.id, () => ({
        title: document.title,
        url: `${location.origin}${location.pathname}`,
        ready_state: document.readyState,
        visibility: document.visibilityState,
        forms: [...document.forms].slice(0, 50).map((form) => ({
          action: form.action ? `${new URL(form.action, location.href).origin}${new URL(form.action, location.href).pathname}` : "",
          method: (form.method || "get").toUpperCase(),
          fields: [...form.elements].filter((el) => el instanceof HTMLElement).slice(0, 100).map((el) => ({
            tag: el.tagName.toLowerCase(),
            type: String(el.type || ""),
            name: String(el.name || ""),
            label: el.labels?.[0]?.innerText?.trim().slice(0, 160) || el.getAttribute("aria-label") || "",
            required: Boolean(el.required),
            disabled: Boolean(el.disabled),
          })),
        })),
      }));
    }
    case "get_interactives": {
      const tab = await getTab(params.tab_id);
      const limit = Math.max(1, Math.min(Number(params.limit) || 60, MAX_INTERACTIVES));
      return await executeInTab(tab.id, (max) => {
        const selectorFor = (el) => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const testId = el.getAttribute("data-testid");
          if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
          const parts = [];
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && parts.length < 5) {
            const parent = node.parentElement;
            if (!parent) break;
            const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
            const ordinal = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : "";
            parts.unshift(`${node.tagName.toLowerCase()}${ordinal}`);
            node = parent;
          }
          return `body > ${parts.join(" > ")}`;
        };
        const isVisible = (el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const labelFor = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.labels?.[0]?.innerText || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180);
        const selector = 'a[href],button,input:not([type="hidden"]):not([type="password"]),textarea,select,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
        const elements = [...document.querySelectorAll(selector)].filter(isVisible).slice(0, max).map((el) => ({
          selector: selectorFor(el),
          tag: el.tagName.toLowerCase(),
          type: String(el.type || ""),
          label: labelFor(el),
          disabled: Boolean(el.disabled),
          rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),
        }));
        return { count: elements.length, elements };
      }, [limit]);
    }
    case "click": {
      const tab = await getTab(params.tab_id);
      const selector = String(params.selector || "").trim();
      if (!selector || selector.length > 2_048) throw new Error("selector must be a non-empty CSS selector under 2048 characters");
      return await executeInTab(tab.id, (sel) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`Element not found: ${sel}`);
        if (el.disabled || el.getAttribute("aria-disabled") === "true") throw new Error("Element is disabled");
        if (el instanceof HTMLInputElement && String(el.type).toLowerCase() === "file") throw new Error("File-picker inputs are not supported by this version");
        if (el instanceof HTMLAnchorElement && /^(javascript|data):/i.test(el.getAttribute("href") || "")) throw new Error("Script and data links are refused");
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const label = (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180);
        el.click();
        return { clicked: true, tag: el.tagName.toLowerCase(), label };
      }, [selector]);
    }
    case "fill_form": {
      const tab = await getTab(params.tab_id);
      if (!Array.isArray(params.fields) || params.fields.length < 1 || params.fields.length > 40) throw new Error("fields must contain 1–40 entries");
      const fields = params.fields.map((field) => {
        const selector = String(field?.selector || "").trim();
        const hasValue = typeof field?.value === "string";
        const hasChecked = typeof field?.checked === "boolean";
        if (!selector || selector.length > 2_048 || hasValue === hasChecked || (hasValue && field.value.length > 10_000)) {
          throw new Error("Each field needs a selector and exactly one of value or checked");
        }
        return { selector, ...(hasValue ? { value: field.value } : { checked: field.checked }) };
      });
      return await executeInTab(tab.id, (items) => {
        const fail = (error) => ({ __piBrowserBridgeError: error instanceof Error ? error.message : String(error) });
        const planned = [];
        try {
          for (const item of items) {
            const el = document.querySelector(item.selector);
            if (!el) return fail(`Element not found: ${item.selector}`);
            const type = String(el.type || "").toLowerCase();
            const details = [el.name, el.id, el.autocomplete, el.getAttribute("aria-label"), el.placeholder].join(" ").toLowerCase();
            if (["password", "hidden", "file"].includes(type) || /password|passcode|secret|token|csrf|authenticity|one.?time|otp|2fa|verification.?code|recovery.?code|private.?key/.test(details)) {
              return fail(`Refusing to fill a sensitive field: ${item.selector}`);
            }
            if (el.disabled || el.readOnly) return fail(`Element is not editable: ${item.selector}`);
            if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(type)) {
              if (item.checked === undefined) return fail(`Checkbox/radio needs checked=true or false: ${item.selector}`);
              if (type === "radio" && item.checked === false) return fail("A radio choice cannot be unchecked");
              planned.push({ item, el, type });
              continue;
            }
            if (item.checked !== undefined) return fail(`checked can only target a checkbox or radio: ${item.selector}`);
            if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
              return fail(`Element is not an editable form field: ${item.selector}`);
            }
            if (el instanceof HTMLInputElement && !["text", "email", "search", "tel", "url", "number", "date", "time", "datetime-local", "month", "week", "color"].includes(type)) {
              return fail(`Input type ${type || "unknown"} is not supported by fill_form`);
            }
            let selectValue;
            if (el instanceof HTMLSelectElement) {
              const option = [...el.options].find((candidate) => candidate.value === item.value || candidate.textContent.trim() === item.value);
              if (!option) return fail(`Option not found for ${item.selector}`);
              selectValue = option.value;
            }
            planned.push({ item, el, type, selectValue });
          }

          const done = [];
          for (const { item, el, type, selectValue } of planned) {
            if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(type)) {
              if (el.checked !== item.checked) el.click();
              done.push({ selector: item.selector, checked: el.checked });
              continue;
            }
            if (el instanceof HTMLSelectElement) {
              el.value = selectValue;
            } else {
              const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
              setter ? setter.call(el, item.value) : (el.value = item.value);
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            done.push({ selector: item.selector, filled: true, value_length: item.value.length });
          }
          return { filled: done.length, fields: done };
        } catch (error) {
          return fail(error);
        }
      }, [fields]);
    }
    case "type_text": {
      const tab = await getTab(params.tab_id);
      const selector = String(params.selector || "").trim();
      const text = String(params.text ?? "");
      if (!selector || selector.length > 2_048 || text.length > 10_000) throw new Error("selector must be set and text must be under 10000 characters");
      return await executeInTab(tab.id, (sel, value) => {
        const fail = (error) => ({ __piBrowserBridgeError: error instanceof Error ? error.message : String(error) });
        try {
          const el = document.querySelector(sel);
          if (!el) return fail(`Element not found: ${sel}`);
          const type = String(el.type || "").toLowerCase();
          const details = [el.name, el.id, el.autocomplete, el.getAttribute("aria-label"), el.placeholder].join(" ").toLowerCase();
          if (["password", "hidden", "file"].includes(type) || /password|passcode|secret|token|csrf|authenticity|one.?time|otp|2fa|verification.?code|recovery.?code|private.?key/.test(details)) {
            return fail("Refusing to type into a sensitive field");
          }
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) || el.disabled || el.readOnly) return fail("Element is not an editable field");
          el.focus();
          if (el.isContentEditable) el.textContent = value;
          else {
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            setter ? setter.call(el, value) : (el.value = value);
          }
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { typed: true, value_length: value.length };
        } catch (error) {
          return fail(error);
        }
      }, [selector, text]);
    }
    case "press_key": {
      const tab = await getTab(params.tab_id);
      const allowed = new Set(["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "]);
      if (typeof params.key !== "string" || (!allowed.has(params.key) && params.key.length !== 1)) throw new Error("key must be a named navigation key or a single character");
      return await executeInTab(tab.id, (key) => {
        const target = document.activeElement || document.body;
        for (const type of ["keydown", "keypress", "keyup"]) target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
        return { key, target: target.tagName?.toLowerCase() || "body" };
      }, [params.key]);
    }
    case "scroll": {
      const tab = await getTab(params.tab_id);
      const x = Math.max(-2_000, Math.min(Number(params.x) || 0, 2_000));
      const y = Math.max(-2_000, Math.min(Number(params.y) || 0, 2_000));
      return await executeInTab(tab.id, (dx, dy) => {
        window.scrollBy({ left: dx, top: dy, behavior: "instant" });
        return { x: window.scrollX, y: window.scrollY };
      }, [x, y]);
    }
    case "wait_for": {
      const tab = await getTab(params.tab_id);
      const condition = params.condition;
      const value = String(params.value || "");
      if (!new Set(["text", "element"]).has(condition) || !value || value.length > 2_048) throw new Error("Use condition text or element with a non-empty value");
      const timeoutMs = Math.max(100, Math.min(Number(params.timeout_ms) || 10_000, 30_000));
      return await executeInTab(tab.id, async (kind, needle, timeout) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const found = kind === "text" ? (document.body?.innerText || "").includes(needle) : Boolean(document.querySelector(needle));
          if (found) return { found: true, condition: kind, value: needle };
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return { found: false, condition: kind, value: needle, reason: "timeout" };
      }, [condition, value, timeoutMs]);
    }
    case "screenshot": {
      const tab = await getTab(params.tab_id);
      const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (active?.id !== tab.id) throw new Error("Screenshots are available only for the active visible tab; Pi Bridge will not switch focus to a background tab");
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
      const image = dataUrl.slice(dataUrl.indexOf(",") + 1);
      return { image, mime_type: "image/jpeg", tab_id: tab.id };
    }
    default:
      throw new Error(`Unknown browser command: ${String(command).slice(0, 80)}`);
  }
}

async function waitForComplete(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Navigation did not complete before timeout");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "pi-browser-bridge:get-status") {
    sendResponse(status());
    return false;
  }
  if (message?.type === "pi-browser-bridge:get-profile") {
    profileIdentityReady.then(sendResponse, (error) => sendResponse({ error: safeError(error) }));
    return true;
  }
  if (message?.type === "pi-browser-bridge:set-profile-name") {
    saveProfileName(message.name).then(sendResponse, (error) => sendResponse({ error: safeError(error) }));
    return true;
  }
  if (message?.type === "pi-browser-bridge:reconnect") {
    refused = false;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Reconnect requested");
    socket = null;
    connect();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connect();
});
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
connect();
