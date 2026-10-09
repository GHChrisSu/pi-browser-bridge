const BRIDGE_URL = "ws://127.0.0.1:43177/bridge";
const RECONNECT_ALARM = "pi-browser-bridge-reconnect";
const MAX_TEXT = 24_000;
const MAX_INTERACTIVES = 100;
const SENSITIVE_NAME = /password|passcode|secret|token|csrf|authenticity|one.?time|otp|2fa|verification.?code|recovery.?code|private.?key/i;
const SAFE_KEYS = new Set(["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "]);

let socket = null;
let connectionState = "disconnected";
let reconnectTimer = null;
let reconnectDelay = 800;
let refused = false;

function status() {
  return {
    connected: connectionState === "connected",
    state: connectionState,
    extension_version: chrome.runtime.getManifest().version,
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
  return results?.[0]?.result;
}

async function executeCommand(command, params) {
  switch (command) {
    case "get_status":
      return status();
    case "get_active_tab": {
      const tab = await getTab(params.tab_id);
      return { id: tab.id, title: tab.title || "", url: redactedUrl(tab.url), active: Boolean(tab.active) };
    }
    case "create_tab": {
      const url = isSafeWebUrl(params.url);
      const tab = await chrome.tabs.create({ url, active: params.active !== false });
      return { id: tab.id, title: tab.title || "", url: redactedUrl(tab.url || url) };
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
      const max = Math.max(500, Math.min(Number(params.max_length) || 12_000, MAX_TEXT));
      return await executeInTab(tab.id, (limit) => ({
        title: document.title,
        url: `${location.origin}${location.pathname}`,
        text: (document.body?.innerText || "").slice(0, limit),
        truncated: (document.body?.innerText || "").length > limit,
      }), [max]);
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
        const done = [];
        for (const item of items) {
          const el = document.querySelector(item.selector);
          if (!el) throw new Error(`Element not found: ${item.selector}`);
          const type = String(el.type || "").toLowerCase();
          const details = [el.name, el.id, el.autocomplete, el.getAttribute("aria-label"), el.placeholder].join(" ").toLowerCase();
          if (["password", "hidden", "file"].includes(type) || /password|passcode|secret|token|csrf|authenticity|one.?time|otp|2fa|verification.?code|recovery.?code|private.?key/.test(details)) {
            throw new Error(`Refusing to fill a sensitive field: ${item.selector}`);
          }
          if (el.disabled || el.readOnly) throw new Error(`Element is not editable: ${item.selector}`);
          if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(type)) {
            if (item.checked === undefined) throw new Error(`Checkbox/radio needs checked=true or false: ${item.selector}`);
            if (type === "radio" && item.checked === false) throw new Error("A radio choice cannot be unchecked");
            if (el.checked !== item.checked) el.click();
            done.push({ selector: item.selector, checked: el.checked });
            continue;
          }
          if (item.checked !== undefined) throw new Error(`checked can only target a checkbox or radio: ${item.selector}`);
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
            throw new Error(`Element is not an editable form field: ${item.selector}`);
          }
          if (el instanceof HTMLSelectElement) {
            const option = [...el.options].find((candidate) => candidate.value === item.value || candidate.textContent.trim() === item.value);
            if (!option) throw new Error(`Option not found for ${item.selector}`);
            el.value = option.value;
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
      }, [fields]);
    }
    case "type_text": {
      const tab = await getTab(params.tab_id);
      const selector = String(params.selector || "").trim();
      const text = String(params.text ?? "");
      if (!selector || selector.length > 2_048 || text.length > 10_000) throw new Error("selector must be set and text must be under 10000 characters");
      return await executeInTab(tab.id, (sel, value) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`Element not found: ${sel}`);
        const type = String(el.type || "").toLowerCase();
        const details = [el.name, el.id, el.autocomplete, el.getAttribute("aria-label"), el.placeholder].join(" ").toLowerCase();
        if (["password", "hidden", "file"].includes(type) || /password|passcode|secret|token|csrf|authenticity|one.?time|otp|2fa|verification.?code|recovery.?code|private.?key/.test(details)) {
          throw new Error("Refusing to type into a sensitive field");
        }
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) || el.disabled || el.readOnly) throw new Error("Element is not an editable field");
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
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
      const image = dataUrl.slice(dataUrl.indexOf(",") + 1);
      return { image, mime_type: "image/jpeg", tab_id: tab.id };
    }
    default:
      throw new Error(`Unknown browser command: ${String(command).slice(0, 80)}`);
  }
}

async function waitForComplete(tabId, timeoutMs) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Navigation did not complete before timeout"));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "pi-browser-bridge:get-status") {
    sendResponse(status());
    return false;
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
