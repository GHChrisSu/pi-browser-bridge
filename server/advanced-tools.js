import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { normalizeSelector, parseWebUrl } from "./security.js";
import { parseHttpOrigin, validateNewOutputFile } from "./local-files.js";
import { runHeapSnapshotTool, runLighthouseTool } from "./local-browser-tools.js";

function text(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function readonlyAnnotations({ openWorld = false } = {}) {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: openWorld };
}

function actionAnnotations({ destructive = false, idempotent = false, openWorld = false } = {}) {
  return { readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: openWorld };
}

const withProfile = (fields = {}) => ({ ...fields, profile_id: z.string().min(1).max(80).optional() });
const tabId = z.number().int().optional();

function browserRequest(broker, command, args = {}, options = {}) {
  const { profile_id, ...params } = args;
  return broker.request(command, params, { ...options, profileId: profile_id });
}

export function registerAdvancedBrowserTools(server, broker, sessionRecorder) {
  server.registerTool("get_css_styles", {
    description: "Inspect computed CSS for one selected element. Returns a bounded set of computed properties and matched rules; it does not read cookies, form values, or arbitrary page scripts.",
    inputSchema: withProfile({
      selector: z.string().min(1).max(2_048),
      properties: z.array(z.string().min(1).max(80)).max(80).optional(),
      include_inherited: z.boolean().optional(),
      tab_id: tabId,
    }),
    annotations: readonlyAnnotations(),
  }, async ({ selector, ...args }) => text(await browserRequest(broker, "get_css_styles", {
    ...args, selector: normalizeSelector(selector),
  })));

  server.registerTool("read_console", {
    description: "Read a bounded buffer of console messages and page errors captured after instrumentation is installed. Text is untrusted page data; query-string credentials are redacted.",
    inputSchema: withProfile({
      level: z.enum(["all", "error", "warn", "info", "log"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      clear: z.boolean().optional(),
      tab_id: tabId,
    }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "read_console", args)));

  server.registerTool("monitor_network", {
    description: "Read bounded request metadata captured by Chrome for the selected tab. Requires the user to enable optional network-observation permission. Request and response bodies and credential headers are never collected.",
    inputSchema: withProfile({
      limit: z.number().int().min(1).max(500).optional(),
      clear: z.boolean().optional(),
      tab_id: tabId,
    }),
    annotations: actionAnnotations(),
  }, async (args) => text(await browserRequest(broker, "monitor_network", args)));

  server.registerTool("network_rules", {
    description: "Install, list, or clear time-limited Chrome network rules for block, redirect, or header changes. Requires optional network-control permission. Rules are scoped to a tab when tab_id is supplied and expire within 24 hours.",
    inputSchema: withProfile({
      action: z.enum(["block", "redirect", "modify_header", "list", "clear"]),
      url_filter: z.string().min(1).max(500).optional(),
      redirect_url: z.string().url().max(8_192).optional(),
      header: z.string().min(1).max(100).optional(),
      header_value: z.string().max(2_048).optional(),
      header_target: z.enum(["request", "response"]).optional(),
      resource_types: z.array(z.enum(["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"])).max(14).optional(),
      tab_id: tabId,
      rule_id: z.number().int().min(1_000_000).max(1_999_999).optional(),
      expires_ms: z.number().int().min(1_000).max(24 * 60 * 60 * 1_000).optional(),
    }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async ({ redirect_url, ...args }) => {
    if (redirect_url !== undefined) redirect_url = parseWebUrl(redirect_url);
    return text(await browserRequest(broker, "network_rules", {
      ...args, ...(redirect_url !== undefined ? { redirect_url } : {}),
    }));
  });

  server.registerTool("screenshot_diff", {
    description: "Save, compare, list, or clear named viewport/element visual baselines in this Chrome profile. Returns changed-pixel percentage and a red diff image. Captures only the already-visible selected tab and never changes focus.",
    inputSchema: withProfile({
      action: z.enum(["baseline", "compare", "list", "clear"]),
      name: z.string().trim().min(1).max(80).optional(),
      selector: z.string().min(1).max(2_048).optional(),
      threshold: z.number().min(0).max(255).optional(),
      tab_id: tabId,
    }),
    annotations: actionAnnotations({ destructive: true, idempotent: true }),
  }, async ({ selector, ...args }) => {
    const result = await browserRequest(broker, "screenshot_diff", {
      ...args, ...(selector ? { selector: normalizeSelector(selector) } : {}),
    });
    const content = [{ type: "text", text: JSON.stringify({ ...result, diff_image: undefined }) }];
    if (typeof result?.diff_image === "string") content.push({ type: "image", data: result.diff_image, mimeType: "image/png" });
    return { content };
  });

  server.registerTool("audit", {
    description: "Run a bounded, read-only local page audit for accessibility, keyboard use, SEO, security indicators, links, performance metrics, CSS, and resources. It does not submit forms or send test requests.",
    inputSchema: withProfile({
      kinds: z.array(z.enum(["accessibility", "keyboard", "seo", "security", "links", "vitals", "css", "resources", "cache"])).max(9).optional(),
      scope: z.string().min(1).max(2_048).optional(),
      max_findings: z.number().int().min(1).max(500).optional(),
      tab_id: tabId,
    }),
    annotations: readonlyAnnotations(),
  }, async ({ scope, ...args }) => text(await browserRequest(broker, "audit", {
    ...args, ...(scope ? { scope: normalizeSelector(scope) } : {}),
  })));

  server.registerTool("clipboard", {
    description: "Read or write plain text on the system clipboard. Requires optional clipboard permission and an explicit Pi confirmation for each operation. Reading sends clipboard contents into the model context; writing replaces the current clipboard.",
    inputSchema: withProfile({
      action: z.enum(["read", "write"]),
      text: z.string().max(10_000).optional(),
      tab_id: tabId,
    }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "clipboard", args)));

  server.registerTool("execute_js", {
    description: "Execute user-supplied JavaScript in the selected page's MAIN world. Requires the optional userScripts permission and Chrome's Allow user scripts toggle. Pi confirms the code and target before execution; page scripts can read or change anything available to that page.",
    inputSchema: withProfile({ code: z.string().min(1).max(10_000), frame_id: z.number().int().min(0).optional(), tab_id: z.number().int() }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async (args) => text(await browserRequest(broker, "execute_js", args)));

  server.registerTool("get_storage", {
    description: "Read localStorage, sessionStorage, and/or cookies for the selected page. Requires optional cookie permission for cookies. This may expose login tokens and secrets, so Pi confirms every call before returning values.",
    inputSchema: withProfile({ type: z.enum(["all", "localStorage", "sessionStorage", "cookies"]).optional(), tab_id: z.number().int() }),
    annotations: readonlyAnnotations(),
  }, async (args) => text(await browserRequest(broker, "get_storage", args)));

  server.registerTool("set_storage", {
    description: "Set, remove, or clear localStorage, sessionStorage, or a cookie for the selected page. Cookie operations require optional cookie permission. Pi confirms every state change.",
    inputSchema: withProfile({
      type: z.enum(["localStorage", "sessionStorage", "cookie"]),
      action: z.enum(["set", "remove", "clear"]),
      key: z.string().max(300).optional(),
      value: z.string().max(5_000).optional(),
      path: z.string().max(2_000).optional(),
      domain: z.string().max(300).optional(),
      expires: z.number().optional(),
      secure: z.boolean().optional(),
      same_site: z.enum(["no_restriction", "lax", "strict"]).optional(),
      http_only: z.boolean().optional(),
      tab_id: z.number().int(),
    }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async (args) => text(await browserRequest(broker, "set_storage", args)));

  server.registerTool("http_request", {
    description: "Send an HTTP request through the selected Chrome profile with that host's browser cookies. Requires optional cookie permission and Pi confirmation. Redirects are refused; request and response bodies are bounded, and response headers/cookies are omitted.",
    inputSchema: withProfile({
      url: z.string().url().max(8_192),
      method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).optional(),
      headers: z.record(z.string(), z.string().max(2_000)).optional(),
      body: z.string().max(100_000).optional(),
      max_length: z.number().int().min(500).max(24_000).optional(),
    }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async ({ url, ...args }) => text(await browserRequest(broker, "http_request", {
    ...args, url: parseWebUrl(url),
  }, { timeoutMs: 60_000 })));

  server.registerTool("window_layout", {
    description: "Save, restore, list, or delete named Chrome window arrangements for this profile. Saved tab identifiers use origin and path only; query strings and fragments are omitted.",
    inputSchema: withProfile({
      action: z.enum(["save", "restore", "list", "delete"]),
      name: z.string().trim().min(1).max(80).optional(),
    }),
    annotations: actionAnnotations({ destructive: true, idempotent: true }),
  }, async (args) => text(await browserRequest(broker, "window_layout", args)));

  server.registerTool("tile_windows", {
    description: "Arrange selected Chrome windows in a grid, columns, or rows within the screen work area. Window movement is visible to the user.",
    inputSchema: withProfile({
      window_ids: z.array(z.number().int()).max(32).optional(),
      reference_window_id: z.number().int().optional(),
      layout: z.enum(["grid", "columns", "rows"]).optional(),
      padding: z.number().int().min(0).max(200).optional(),
      area: z.object({ left: z.number(), top: z.number(), width: z.number().min(320), height: z.number().min(240) }).optional(),
    }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "tile_windows", args)));

  server.registerTool("move_tab", {
    description: "Move one existing tab into a selected normal window or a new normal window. This changes the user's Chrome window layout but does not navigate or close the tab.",
    inputSchema: withProfile({
      tab_id: z.number().int(),
      window_id: z.number().int().optional(),
      new_window: z.boolean().optional(),
      left: z.number().int().optional(),
      top: z.number().int().optional(),
      width: z.number().int().min(320).max(4_000).optional(),
      height: z.number().int().min(240).max(4_000).optional(),
      index: z.number().int().min(-1).optional(),
    }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "move_tab", args)));

  server.registerTool("tab_action", {
    description: "Activate, reload, go back, or close a specific tab. Closing is irreversible for that tab's current state; inspect the tab first.",
    inputSchema: withProfile({
      action: z.enum(["activate", "reload", "back", "close"]),
      tab_id: z.number().int(),
      bypass_cache: z.boolean().optional(),
    }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async (args) => text(await browserRequest(broker, "tab_action", args)));

  server.registerTool("hover", {
    description: "Move the pointer over one page element using fixed browser input events. Does not read or transmit credentials and does not evaluate model-provided code.",
    inputSchema: withProfile({ selector: z.string().min(1).max(2_048), tab_id: tabId }),
    annotations: actionAnnotations({ idempotent: true }),
  }, async ({ selector, ...args }) => text(await browserRequest(broker, "hover", {
    ...args, selector: normalizeSelector(selector),
  })));

  server.registerTool("get_frames", {
    description: "List frame identifiers and their URL/title metadata for one tab. URLs are redacted and values from the page are not returned.",
    inputSchema: withProfile({ tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async (args) => text(await browserRequest(broker, "get_frames", args)));

  server.registerTool("query_dom", {
    description: "Inspect bounded DOM matches by CSS selector. Omits form values and strips query strings from URL attributes.",
    inputSchema: withProfile({ selector: z.string().min(1).max(2_048).optional(), scope: z.string().min(1).max(2_048).optional(), limit: z.number().int().min(1).max(100).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async ({ selector, scope, ...args }) => text(await browserRequest(broker, "query_dom", {
    ...args,
    ...(selector ? { selector: normalizeSelector(selector) } : {}),
    ...(scope ? { scope: normalizeSelector(scope) } : {}),
  })));

  server.registerTool("read_form", {
    description: "Inspect form structure, labels, required state, and select option labels without returning any current field values.",
    inputSchema: withProfile({ selector: z.string().min(1).max(2_048).optional(), index: z.number().int().min(0).max(100).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async ({ selector, ...args }) => text(await browserRequest(broker, "read_form", {
    ...args, ...(selector ? { selector: normalizeSelector(selector) } : {}),
  })));

  server.registerTool("get_tabs", {
    description: "List tabs and window bounds across the selected Chrome profile. URLs omit query strings and fragments.",
    inputSchema: withProfile(),
    annotations: readonlyAnnotations(),
  }, async (args) => text(await browserRequest(broker, "get_tabs", args)));

  server.registerTool("dismiss_overlays", {
    description: "Dismiss only a clearly labeled close/dismiss control, or reject a clearly labeled consent choice. It will not click accept/agree controls.",
    inputSchema: withProfile({ action: z.enum(["close", "reject"]).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async (args) => text(await browserRequest(broker, "dismiss_overlays", args)));

  server.registerTool("handle_dialogs", {
    description: "Accept or dismiss an already-open JavaScript alert/confirm/prompt. Accepting can trigger a page action and requires confirmation in Pi.",
    inputSchema: withProfile({ action: z.enum(["accept", "dismiss"]), prompt_text: z.string().max(2_000).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "handle_dialogs", args)));

  server.registerTool("drag_and_drop", {
    description: "Drag one selected element to another using HTML5 drag events or fixed Chrome pointer events.",
    inputSchema: withProfile({ source_selector: z.string().min(1).max(2_048), target_selector: z.string().min(1).max(2_048), mode: z.enum(["html5", "pointer"]).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async ({ source_selector, target_selector, ...args }) => text(await browserRequest(broker, "drag_and_drop", {
    ...args,
    source_selector: normalizeSelector(source_selector),
    target_selector: normalizeSelector(target_selector),
  })));

  server.registerTool("extract_table", {
    description: "Extract rows from a real HTML table with bounded output, server-side column selection, and case-insensitive substring filters.",
    inputSchema: withProfile({
      selector: z.string().min(1).max(2_048).optional(),
      index: z.number().int().min(0).max(100).optional(),
      max_rows: z.number().int().min(1).max(1_000).optional(),
      where: z.record(z.string(), z.string().max(500)).optional(),
      columns: z.array(z.string().max(200)).max(100).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
      scan_rows: z.number().int().min(1).max(10_000).optional(),
      tab_id: tabId,
    }),
    annotations: readonlyAnnotations(),
  }, async ({ selector, ...args }) => text(await browserRequest(broker, "extract_table", {
    ...args, ...(selector ? { selector: normalizeSelector(selector) } : {}),
  })));

  server.registerTool("element_screenshot", {
    description: "Capture a selected element within the already-visible tab and return a cropped image. Does not switch Chrome focus.",
    inputSchema: withProfile({ selector: z.string().min(1).max(2_048), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async ({ selector, ...args }) => {
    const result = await browserRequest(broker, "element_screenshot", {
      ...args, selector: normalizeSelector(selector),
    });
    return { content: [{ type: "image", data: result.image, mimeType: result.mime_type || "image/png" }] };
  });

  server.registerTool("full_page_screenshot", {
    description: "Capture a long page as a bounded sequence of viewport images. The selected tab must already be visible; Pi Bridge will restore the original scroll position and will not change focus.",
    inputSchema: withProfile({
      max_segments: z.number().int().min(1).max(12).optional(),
      tab_id: tabId,
    }),
    annotations: readonlyAnnotations(),
  }, async (args) => {
    const result = await browserRequest(broker, "full_page_screenshot", args, { timeoutMs: 120_000 });
    return {
      content: [
        { type: "text", text: JSON.stringify({ segments: result.images?.length ?? 0, truncated: result.truncated, width: result.width, full_height: result.full_height }) },
        ...(result.images || []).map((image) => ({ type: "image", data: image, mimeType: result.mime_type || "image/jpeg" })),
      ],
    };
  });

  server.registerTool("inject_css", {
    description: "Insert or remove a named temporary stylesheet in the selected page. External url(), @import, and expression() rules are refused.",
    inputSchema: withProfile({ action: z.enum(["insert", "remove"]).optional(), name: z.string().max(60).optional(), css: z.string().max(20_000).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "inject_css", args)));

  server.registerTool("modify_dom", {
    description: "Apply a bounded DOM text, presentation, or accessibility change. It cannot set event handlers, input values, or executable HTML.",
    inputSchema: withProfile({ action: z.enum(["set_text", "set_attribute", "remove_attribute", "add_class", "remove_class", "remove"]), selector: z.string().min(1).max(2_048), attribute: z.string().max(100).optional(), value: z.string().max(5_000).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async ({ selector, ...args }) => text(await browserRequest(broker, "modify_dom", { ...args, selector: normalizeSelector(selector) })));

  server.registerTool("measure_spacing", {
    description: "Measure element rectangles, computed margins/padding, and the gap between selected elements.",
    inputSchema: withProfile({ selectors: z.array(z.string().min(1).max(2_048)).min(1).max(20), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async ({ selectors, ...args }) => text(await browserRequest(broker, "measure_spacing", { ...args, selectors: selectors.map(normalizeSelector) })));

  server.registerTool("viewport_resize", {
    description: "Resize the selected Chrome window to a viewport size and restore its saved bounds later. Window size changes are visible to the user.",
    inputSchema: withProfile({ action: z.enum(["set", "reset"]).optional(), width: z.number().int().min(320).max(4_000).optional(), height: z.number().int().min(240).max(4_000).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "viewport_resize", args)));

  server.registerTool("emulate_media", {
    description: "Emulate screen/print media and selected accessibility preferences through fixed Chrome DevTools commands. Reset returns media emulation to the default.",
    inputSchema: withProfile({ action: z.enum(["set", "clear"]).optional(), media: z.enum(["screen", "print"]).optional(), features: z.array(z.object({ name: z.enum(["prefers-color-scheme", "prefers-reduced-motion", "forced-colors", "prefers-contrast"]), value: z.string().max(40) })).max(4).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "emulate_media", args)));

  server.registerTool("set_geolocation", {
    description: "Override or clear the selected tab's geolocation through a fixed Chrome DevTools command. Pi confirms each change.",
    inputSchema: withProfile({ action: z.enum(["set", "clear"]).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), accuracy: z.number().min(1).max(10_000).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => text(await browserRequest(broker, "set_geolocation", args)));

  server.registerTool("find_text", {
    description: "Find visible text-node matches in the selected page and return short snippets with element metadata.",
    inputSchema: withProfile({ text: z.string().min(1).max(2_048), max_results: z.number().int().min(1).max(100).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async (args) => text(await browserRequest(broker, "find_text", args)));

  server.registerTool("assert", {
    description: "Assert that selected page text, selector, URL, title, or element count matches expectations. A failed assertion returns an error.",
    inputSchema: withProfile({ selector: z.string().min(1).max(2_048).optional(), text: z.string().max(2_048).optional(), url: z.string().max(2_048).optional(), title: z.string().max(300).optional(), count: z.number().int().min(0).max(100_000).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async (args) => {
    if (args.count !== undefined && !args.selector) throw new Error("count requires selector");
    if (![args.selector, args.text, args.url, args.title, args.count !== undefined].some(Boolean)) throw new Error("Provide at least one assertion condition");
    return text(await browserRequest(broker, "assert", args));
  });

  server.registerTool("extract", {
    description: "Extract bounded repeated records by item selector and field selectors/attributes. Form values and credential-like attributes are omitted.",
    inputSchema: withProfile({ item_selector: z.string().min(1).max(2_048), fields: z.record(z.string().max(100), z.object({ selector: z.string().max(2_048).optional(), attr: z.string().max(100).optional() })).optional(), max_items: z.number().int().min(1).max(100).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async ({ item_selector, fields, ...args }) => text(await browserRequest(broker, "extract", { ...args, item_selector: normalizeSelector(item_selector), fields: fields || {} })));

  server.registerTool("track_events", {
    description: "Summarize known analytics/tracking request metadata for the selected tab. Query values are redacted; request bodies are not read.",
    inputSchema: withProfile({ clear: z.boolean().optional(), wait_ms: z.number().int().min(0).max(5_000).optional(), tab_id: z.number().int() }),
    annotations: actionAnnotations({ openWorld: true }),
  }, async (args) => text(await browserRequest(broker, "track_events", args)));

  server.registerTool("find_setting", {
    description: "Search same-origin links in the selected page's navigation menus for a setting keyword. Uses a temporary background tab and closes it without changing the selected tab.",
    inputSchema: withProfile({ keyword: z.string().trim().min(1).max(200), max_pages: z.number().int().min(1).max(25).optional(), menu_selector: z.string().min(1).max(500).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations({ openWorld: true }),
  }, async (args) => text(await browserRequest(broker, "find_setting", args, { timeoutMs: 120_000 })));

  server.registerTool("manage_downloads", {
    description: "List recent Chrome downloads, start an explicitly requested download, or wait for the newest download to finish.",
    inputSchema: withProfile({ action: z.enum(["list", "wait_for_complete", "download"]), url: z.string().url().max(8_192).optional(), filename: z.string().max(120).optional(), timeout_ms: z.number().int().min(1_000).max(60_000).optional(), max_bytes: z.number().int().min(1_024).max(100 * 1024 * 1024).optional(), limit: z.number().int().min(1).max(50).optional() }),
    annotations: actionAnnotations({ openWorld: true }),
  }, async ({ url, timeout_ms, ...args }) => text(await browserRequest(broker, "manage_downloads", {
    ...args, timeout_ms, ...(url ? { url: parseWebUrl(url) } : {}),
  }, { timeoutMs: timeout_ms ?? 60_000 })));

  server.registerTool("session_fixture", {
    description: "Save, restore, list, or delete a localStorage/sessionStorage/cookie snapshot for one origin. Fixtures are stored in this Chrome profile's extension storage and contain login credentials; Pi confirms save, restore, and delete operations.",
    inputSchema: withProfile({ action: z.enum(["save", "restore", "list", "delete"]), name: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/).optional(), tab_id: z.number().int().optional() }),
    annotations: actionAnnotations({ destructive: true }),
  }, async (args) => {
    if (["save", "restore"].includes(args.action) && !Number.isInteger(args.tab_id)) throw new Error(`${args.action} requires tab_id`);
    if (["save", "restore", "delete"].includes(args.action) && !args.name) throw new Error(`${args.action} requires name`);
    return text(await browserRequest(broker, "session_fixture", args, { timeoutMs: 120_000 }));
  });

  server.registerTool("cookie_audit", {
    description: "Clear cookies for the selected page, reload it, and compare cookie/request metadata before and after initial load. This may log the user out. Optionally click a user-selected consent control after reload. Requires optional cookies and network-observation permissions and Pi confirmation.",
    inputSchema: withProfile({ consent_selector: z.string().min(1).max(2_048).optional(), settle_ms: z.number().int().min(250).max(5_000).optional(), tab_id: z.number().int() }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async ({ consent_selector, ...args }) => text(await browserRequest(broker, "cookie_audit", {
    ...args, ...(consent_selector ? { consent_selector: normalizeSelector(consent_selector) } : {}),
  }, { timeoutMs: (args.settle_ms ?? 1_000) * 2 + 30_000 })));

  server.registerTool("save_page", {
    description: "Save the selected visible page as a bounded MHTML archive. Requires optional pageCapture permission, an existing destination directory, a new output path, and Pi confirmation; existing files are never overwritten.",
    inputSchema: withProfile({ output_path: z.string().min(1).max(8_192), tab_id: z.number().int() }),
    annotations: actionAnnotations({ destructive: true }),
  }, async ({ output_path, ...args }) => {
    const validated = await validateNewOutputFile(output_path);
    const result = await browserRequest(broker, "save_page", args);
    const bytes = Buffer.from(result.mhtml_b64 || "", "base64");
    if (!bytes.length || bytes.length !== result.size_bytes || bytes.length > 5 * 1024 * 1024) throw new Error("Page archive was empty or exceeded its 5 MiB limit");
    await writeFile(validated.output_path, bytes, { flag: "wx", mode: 0o600 });
    return text({ saved: validated.output_path, size_bytes: bytes.length, tab_id: result.tab_id });
  });

  server.registerTool("http_auth", {
    description: "Set or clear in-memory HTTP Basic/Digest authentication credentials for one origin. Requires optional webRequest/auth-provider permissions. Pi confirms changes; credentials are not persisted and never returned by the tool.",
    inputSchema: withProfile({ action: z.enum(["set", "clear"]), origin: z.string().url().max(2_048).optional(), username: z.string().max(300).optional(), password: z.string().max(2_000).optional() }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async ({ origin, ...args }) => {
    if (origin) args.origin = parseHttpOrigin(origin);
    if (args.action === "set" && (!args.origin || !args.username || args.password === undefined)) throw new Error("set requires origin, username, and password");
    return text(await browserRequest(broker, "http_auth", args));
  });

  server.registerTool("watch_dom", {
    description: "Wait for the next DOM mutation in a selected subtree or the whole document, returning a bounded mutation summary.",
    inputSchema: withProfile({ selector: z.string().min(1).max(2_048).optional(), timeout_ms: z.number().int().min(100).max(30_000).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async ({ selector, ...args }) => text(await browserRequest(broker, "watch_dom", { ...args, ...(selector ? { selector: normalizeSelector(selector) } : {}) })));

  server.registerTool("watch", {
    description: "Wait for text to appear or an element to exist in the selected visible tab, up to 30 seconds.",
    inputSchema: withProfile({ condition: z.enum(["text", "element"]), value: z.string().min(1).max(2_048), timeout_ms: z.number().int().min(100).max(30_000).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async (args) => text(await browserRequest(broker, "watch", args)));

  server.registerTool("animations", {
    description: "List, pause, play, or cancel Web Animations API animations in a page subtree.",
    inputSchema: withProfile({ action: z.enum(["list", "pause", "play", "cancel"]), selector: z.string().min(1).max(2_048).optional(), animation_index: z.number().int().min(0).max(1_000).optional(), tab_id: tabId }),
    annotations: actionAnnotations({ destructive: true }),
  }, async ({ selector, ...args }) => text(await browserRequest(broker, "animations", { ...args, ...(selector ? { selector: normalizeSelector(selector) } : {}) })));

  server.registerTool("frames", {
    description: "Sample requestAnimationFrame intervals in a visible tab for up to five seconds and report frame count and slow-frame timing.",
    inputSchema: withProfile({ duration_ms: z.number().int().min(500).max(5_000).optional(), tab_id: tabId }),
    annotations: readonlyAnnotations(),
  }, async (args) => text(await browserRequest(broker, "frames", args, { timeoutMs: 15_000 })));

  server.registerTool("handoff", {
    description: "Pause for the user to complete an action in the selected visible page. The page banner can optionally accept a short non-secret reply or collect clicked element selectors. Never ask the user to enter passwords or one-time codes in the banner; they should enter those directly on the website.",
    inputSchema: withProfile({ message: z.string().min(1).max(2_000), pick_element: z.boolean().optional(), ask: z.boolean().optional(), pick_max: z.number().int().min(1).max(5).optional(), timeout_ms: z.number().int().min(1_000).max(120_000).optional(), tab_id: z.number().int() }),
    annotations: actionAnnotations({ idempotent: true, openWorld: true }),
  }, async (args) => text(await browserRequest(broker, "handoff", args, { timeoutMs: Math.min((args.timeout_ms ?? 60_000) + 5_000, 120_000) })));

  server.registerTool("perf_trace", {
    description: "Capture a short Chrome DevTools performance trace and return aggregated event counts and slow events. The trace remains in memory and raw page data is not returned.",
    inputSchema: withProfile({ duration_ms: z.number().int().min(500).max(10_000).optional(), tab_id: z.number().int() }),
    annotations: readonlyAnnotations(),
  }, async (args) => text(await browserRequest(broker, "perf_trace", args, { timeoutMs: (args.duration_ms ?? 2_000) + 15_000 })));

  server.registerTool("screencast", {
    description: "Capture a short sequence of JPEG frames from the selected visible tab. Pi confirms first because frames may include confidential page content.",
    inputSchema: withProfile({ duration_ms: z.number().int().min(500).max(10_000).optional(), max_frames: z.number().int().min(1).max(20).optional(), tab_id: z.number().int() }),
    annotations: readonlyAnnotations(),
  }, async (args) => {
    const result = await browserRequest(broker, "screencast", args, { timeoutMs: (args.duration_ms ?? 3_000) + 15_000 });
    return { content: [{ type: "text", text: JSON.stringify({ tab_id: result.tab_id, duration_ms: result.duration_ms, frame_count: result.frame_count, truncated: result.truncated }) }, ...(result.images || []).map((image) => ({ type: "image", data: image, mimeType: result.mime_type || "image/jpeg" }))] };
  });

  server.registerTool("lighthouse", {
    description: "Run Lighthouse against a URL in a fresh isolated headless Chrome profile. It does not reuse the signed-in Chrome profile or cookies. Optional output_path saves a new HTML report after Pi confirmation.",
    inputSchema: withProfile({ url: z.string().url().max(8_192), categories: z.array(z.enum(["performance", "accessibility", "best-practices", "seo"])).max(4).optional(), form_factor: z.enum(["mobile", "desktop"]).optional(), output_path: z.string().max(8_192).optional() }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async ({ url, output_path, ...args }) => {
    const safeUrl = parseWebUrl(url);
    const target = output_path ? await validateNewOutputFile(output_path) : {};
    return text(await runLighthouseTool(safeUrl, { ...args, output_path: target.output_path }));
  });

  server.registerTool("heap_snapshot", {
    description: "Launch a fresh isolated headless Chrome profile, navigate to the requested URL, and save a raw DevTools-compatible heap snapshot. It does not reuse signed-in Chrome cookies. Pi confirms the new local output path.",
    inputSchema: withProfile({ url: z.string().url().max(8_192), output_path: z.string().min(1).max(8_192) }),
    annotations: actionAnnotations({ destructive: true, openWorld: true }),
  }, async ({ url, output_path }) => {
    const safeUrl = parseWebUrl(url);
    const target = await validateNewOutputFile(output_path);
    return text(await runHeapSnapshotTool(safeUrl, target.output_path));
  });

  server.registerTool("session_record", {
    description: "Record and replay a bounded safe subset of browser operations. Recordings are local mode-0600 JSONL files under the Pi agent directory; typed values, passwords, scripts, cookies, storage, uploads, network bodies, and tool results are never recorded. Replay can navigate and click; Pi confirms replay first.",
    inputSchema: withProfile({ action: z.enum(["start", "stop", "list", "replay", "delete"]), name: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/).optional() }),
    annotations: actionAnnotations({ destructive: true }),
  }, async ({ action, name, profile_id }) => {
    if (!sessionRecorder) throw new Error("Session recording is unavailable in this MCP client");
    if (["start", "replay", "delete"].includes(action) && !name) throw new Error(`${action} requires a recording name`);
    return text(await sessionRecorder.control(action, { name, profile_id }));
  });
}
