# Pi Bridge

**Chrome browser tools for the Pi coding agent.** This repository installs a bridge plugin into an existing Pi installation and provides a separate Chrome extension; it does not install Pi itself.

This is an independent community project. It is not produced, sponsored, or endorsed by Pi's maintainers or Google. “Pi” is used only to describe compatibility.

## What it does

The Pi package registers and starts a stdio MCP server for each Pi session. That server authenticates to one shared broker per Pi agent directory (user-level by default); the Chrome extension connects to the broker over a loopback WebSocket. Multiple Pi sessions and Chrome profiles can therefore use one broker without opening another browser port per session.

- Read visible page text and inspect interactive elements in the active or a specifically selected background tab.
- Read the complete Chrome accessibility tree in pages, including roles, accessible names, hierarchy, and safe control state; text entry/control values are omitted.
- Read an interactable-only `get_visible_dom` snapshot with snapshot-scoped node IDs, then click by node ID with a real browser pointer event. Pi Bridge revalidates the page and node before clicking.
- Use Playwright-style `get_by_role`, `fill_by_role`, and `click_by_role` locators by accessible role/name; they resolve through Chrome's accessibility tree and fixed browser events. Pi Bridge does not bundle the Playwright runtime or expose arbitrary CDP through these locators. Page code execution is a separate, opt-in `execute_js` tool with per-call confirmation.
- Delegate a multi-step browser task to the `pi-browser-operator` Pi subagent. It uses Pi Bridge's own Chrome extension with Playwright-style accessible locators; no separate Microsoft Playwright extension is required. See [Pi Browser agent setup](docs/playwright-agent.md).
- Create background tabs and organize them in named **Pi Bridge** tab groups; existing tabs stay where they are.
- Read up to five HTTP/HTTPS URLs in temporary background tabs, then close those tabs without changing the selected tab.
- Inventory visible page images, media, and download links by selector.
- Navigate, click, fill ordinary form fields, press keys, scroll, and wait for page changes in a selected tab.
- Capture the visible tab as an image. Screenshots of background tabs are refused rather than switching browser focus.
- Connect multiple Chrome profiles and multiple Pi sessions through one shared broker. Each profile receives an automatic profile ID; optional popup labels help you recognize them.
- Download files through a page control or an explicitly requested HTTP/HTTPS URL, wait for Chrome to finish, and return the local path to Pi.
- Upload one local file up to 50 MiB into a page file input after Pi confirms the canonical file path, size, profile, tab, and destination website.
- Save a visible page as an MHTML archive to a new local output path after Pi confirmation, or record/replay a bounded subset of safe browser commands.
- Run Lighthouse audits and heap snapshots in a separate temporary headless Chrome profile without the user's signed-in cookies.
- Save and restore same-origin site session fixtures after explicit confirmation; cookie audits clear site cookies only after confirmation and may sign the user out.

- Read and inspect page CSS and bounded console messages; no request/response bodies or credential headers are collected.
- Observe network request metadata only after enabling the optional permission. URLs have query values redacted and the in-memory buffer is capped per tab.
- Add, expire, list, or clear tab-scoped Chrome rules that block, redirect, or modify HTTP headers after enabling optional network-control permission and confirming each change in Pi.
- Compare named visual baselines, run read-only local page audits, and save/restore window layouts using origin and path only.
- Read or write plain text on the system clipboard after enabling optional clipboard permission and confirming the operation in Pi.
- Enable advanced site access only when needed: confirmed `execute_js` runs user-supplied code in the page, `get_storage`/`set_storage` access site storage and cookies, and `http_request` uses the selected profile's cookies for one explicitly requested URL without following redirects.
- Move tabs, arrange windows, capture element/full-page images, inspect frames, and extract bounded HTML tables.

For supported browser tasks and known limits, see [the browser capability matrix](docs/browser-capabilities.md).

Pi Bridge keeps arbitrary page JavaScript, cookies, and site storage disabled by default. Optional `userScripts` and `cookies` permissions add separately confirmed `execute_js`, storage, and authenticated-request tools; user scripts run in the page's MAIN world and cookie-backed requests send the selected profile's cookies to the explicitly requested host. Optional HTTP-auth permission enables separately confirmed, in-memory credentials scoped to one origin. HTTP redirects are refused. The broker exposes only named commands, never arbitrary CDP. `debugger` remains limited to packaged accessibility operations, hover, and confirmed uploads. Optional network, clipboard, cookies, userScripts, HTTP-auth, and page-capture permissions are separate from default browser access.

## Install into an existing Pi

1. In your existing Pi CLI installation, run:

   ```bash
   pi install git:github.com/GHChrisSu/pi-browser-bridge
   ```

2. This checkout builds extension version 0.9.0. For local development or testing, run `npm ci && npm run package:extension`, open `chrome://extensions`, enable Developer mode, and load `dist/pi-browser-bridge-extension/` as an unpacked extension.
3. In Chrome, approve the extension's site access. Browser automation needs access to pages you ask Pi to work with.
4. Restart Pi or run `/reload`. Each Pi session starts its own stdio MCP server, which connects to the shared broker. The broker starts once per Pi agent directory and remains available while sessions use it.

When `pi-mcp-adapter` is active, Pi Bridge supplies its server through the Pi package MCP manifest instead of runtime registration. The adapter and `pi-subagents` can then resolve the same configured server and its browser operator keeps its narrow tool allowlist. The `upload_file` call still validates the canonical file and requests adapter approval before it can run. Without the adapter, Pi Bridge keeps its native direct-tool registration and upload confirmation behavior. Discover parent-session tools with `mcp({ search: "pi-browser-bridge browser" })`.

Each Chrome profile gets its own stable local profile ID and an autogenerated short label. The label is optional and can be changed in the Pi Bridge popup. Pi routes calls using `profile_id`, not the label; if multiple profiles are connected, it requires an explicit ID. Use `list_profiles` to see the IDs.

Use `download_media` on a page's download control or `download_url` for a specific HTTP/HTTPS URL; both return the local file path for Pi to inspect or integrate. Direct URL downloads use Chrome's download API and may send the profile's cookies to the host. To upload, call `upload_file` with an absolute path, exact `target_origin`, `profile_id`, `tab_id`, and the CSS selector for `input[type=file]`. Pi validates a regular file up to 50 MiB and shows an action-time confirmation with its canonical path, size, profile, tab, and destination origin. The selected site receives the file directly from Chrome.

## Use from a Python Agent or another MCP client

Pi users do not edit MCP configuration: the Pi package registers its local stdio server automatically. Other agents can launch the same MCP server directly. After cloning this repository and running `npm ci`, print a portable JSON entry:

```bash
node ./bin/pi-browser-bridge.js mcp-config --format json
```

For an MCP client that reads a JSON `mcpServers` file, merge the entry into the file without changing other servers:

```bash
node ./bin/pi-browser-bridge.js mcp-config --write ./my-agent-mcp.json
```

For a Python agent built with the official MCP SDK, print a `StdioServerParameters` example:

```bash
node ./bin/pi-browser-bridge.js mcp-config --format python
```

The Chrome extension is still required. Pi sessions and external MCP clients attach to the same broker; only the broker owns the fixed loopback port. Each MCP client keeps its own tool session and approval policy. The Pi package asks for confirmation before uploads, clipboard operations, network-rule changes, accepting JavaScript dialogs, user-script execution, storage reads/writes, and authenticated HTTP requests. Other MCP clients do not inherit Pi's confirmation UI; configure equivalent confirmations before exposing those tools. Optional network, clipboard, cookie, and userScripts permissions must first be enabled from the Chrome extension popup; userScripts may also require Chrome's “Allow user scripts” toggle.

## Name and affiliation

The extension is named **Pi Bridge**; its description identifies it as a Chrome bridge for the Pi coding agent. It uses the Pi logo from pi.dev only to identify compatibility; the mark remains Pi's property, and this independent project is not endorsed by or affiliated with Pi's maintainers. See [ATTRIBUTION.md](ATTRIBUTION.md). Google Chrome and the Chrome Web Store are products of Google.

## Security model

- One shared broker binds only to `127.0.0.1` on the fixed bridge port. Chrome extensions authenticate with their `chrome-extension://` origin. Per-session MCP adapters use a separate authenticated WebSocket path on that same port; their random bearer token is stored with mode `0600` under the Pi agent directory.
- On first connection, the Pi server automatically pins that extension's ID in a mode-`0600` file under the Pi agent directory. It accepts reconnects from the same extension and rejects a different one. Reset this pairing only when intentionally replacing the extension.
- Each Chrome profile stores a random profile ID and optional display label locally. The broker accepts commands only from the socket registered to the requested ID, and refuses implicit routing when multiple profiles are connected.
- Page text and screenshots are returned to Pi's model context. Only run the bridge with models and Pi packages you trust.
- This design does not defend against malicious software already running as the same operating-system user; such a process can access the local account and spoof loopback traffic.
- The extension requests broad access to HTTP and HTTPS pages, `tabGroups` for task groups, `storage` for profile IDs and explicitly requested visual baselines/layouts, `downloads` to track user-requested downloads, and `debugger` only for packaged accessibility snapshots, validated pointer clicks, accessible textbox fills, confirmed file uploads, and fixed pointer-hover events. Optional `webRequest`, `declarativeNetRequestWithHostAccess`, and clipboard permissions are off until enabled from the popup. Network observation collects metadata only, and session-scoped network rules expire automatically and clear on Chrome restart. Pi confirms each clipboard operation and network-rule change before dispatch. The bridge still exposes no arbitrary CDP or model-supplied JavaScript.

See [SECURITY.md](SECURITY.md) for reporting and the full threat boundaries.

## Development

Requirements: Node.js 20+ and Pi.

```bash
npm ci
npm test
npm run check
npm run package:extension
pi --extension ./extensions/index.js
```

Run `npm run package:extension` to export both the Chrome Web Store ZIP and the unpacked extension directory. Load `dist/pi-browser-bridge-extension/` as an unpacked extension in Chrome. The first extension ID is pinned automatically. If you replace the unpacked extension and Chrome assigns it a new ID, call `reset_pairing` in Pi and let it reconnect.

## Store publication

The 0.9.0 development update adds the advanced browser tools listed above, with sensitive capabilities disabled until optional permissions are enabled and Pi confirms each call. The version bump does not publish the extension to the Chrome Web Store. Do not describe 0.9.0 as available there until that package is submitted and approved.

## License

Code is MIT licensed; see [LICENSE](LICENSE). The Pi logo is a third-party asset and is not relicensed by MIT; see [ATTRIBUTION.md](ATTRIBUTION.md).
