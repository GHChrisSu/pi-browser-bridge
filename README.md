# Pi Bridge

**Chrome browser tools for the Pi coding agent.** This repository installs a bridge plugin into an existing Pi installation and provides a separate Chrome extension; it does not install Pi itself.

This is an independent community project. It is not produced, sponsored, or endorsed by Pi's maintainers or Google. “Pi” is used only to describe compatibility.

## What it does

The Pi package registers a local MCP server. A Chrome extension connects to that server over a loopback WebSocket and gives Pi a focused set of browser tools:

- Read visible page text and inspect interactive elements in the active or a specifically selected background tab.
- Create background tabs and organize them in named **Pi Bridge** tab groups; existing tabs stay where they are.
- Read up to five HTTP/HTTPS URLs in temporary background tabs, then close those tabs without changing the selected tab.
- Navigate, click, fill ordinary form fields, press keys, scroll, and wait for page changes in a selected tab.
- Capture the visible tab as an image. Screenshots of background tabs are refused rather than switching browser focus.

The bridge does not expose arbitrary page JavaScript, cookies, local storage, or browser debugging. It refuses password, one-time-code, hidden, and token-like form fields. Local file uploads are not part of the first release.

## Install into an existing Pi

1. In your existing Pi CLI installation, run:

   ```bash
   pi install git:github.com/GHChrisSu/pi-browser-bridge
   ```

2. The Chrome Web Store listing for **Pi Bridge** has been submitted for review. For development or testing the 0.2.0 update, clone this repository, open `chrome://extensions`, enable Developer mode, and load the `extension/` directory as an unpacked extension.
3. In Chrome, approve the extension's site access. Browser automation needs access to pages you ask Pi to work with.
4. Restart Pi or run `/reload`. When Pi is running, the extension connects automatically.

Use `list_tabs` to inspect IDs in the current window, `create_workspace` to create a named Pi Bridge group with a background tab, and `list_workspaces` to find its ID. Pass `workspace_id` to `create_tab` and the returned `tab_id` to page tools. `read_urls` reads and closes temporary background tabs without changing the selected tab. Screenshots require the target tab to already be active and visible; Pi Bridge will not switch focus to capture a background tab.

Open the extension popup to see whether Pi is connected. If a development extension is replaced and receives a new Chrome ID, call the `reset_pairing` browser tool once to let it pair again.

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

The Chrome extension is still required. Only one Pi or external MCP server can own the browser connection port for a Chrome profile at a time; close the existing Pi session before starting a separate Python agent.

## Name and affiliation

The extension is named **Pi Bridge**; its description identifies it as a Chrome bridge for the Pi coding agent. It uses the Pi logo from pi.dev only to identify compatibility; the mark remains Pi's property, and this independent project is not endorsed by or affiliated with Pi's maintainers. See [ATTRIBUTION.md](ATTRIBUTION.md). Google Chrome and the Chrome Web Store are products of Google.

## Security model

- The MCP server binds only to `127.0.0.1` and accepts WebSocket connections only from a Chrome extension origin.
- On first connection, the Pi server automatically pins that extension's ID in a mode-`0600` file under the Pi agent directory. It accepts reconnects from the same extension and rejects a different one. Reset this pairing only when intentionally replacing the extension.
- Pairing uses the local browser's extension-origin boundary and loopback binding.
- Page text and screenshots are returned to Pi's model context. Only run the bridge with models and Pi packages you trust.
- This design does not defend against malicious software already running as the same operating-system user; such a process can access the local account and spoof loopback traffic.
- The extension requests broad access to HTTP and HTTPS pages and the `tabGroups` permission so it can create and manage its own named workspace groups. Chrome displays these permissions, and users can narrow site access in the extension's Details page. Browser-internal pages and the Chrome Web Store remain restricted by Chrome. It does not request cookie, debugger, or user-script permissions and sends no telemetry.

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

Load `extension/` as an unpacked extension in Chrome to test it locally. The first extension ID is pinned automatically. If you replace the unpacked extension and Chrome assigns it a new ID, call `reset_pairing` in Pi and let it reconnect.

## Store publication

The extension has been submitted to the Chrome Web Store and is awaiting Google's review. The repository includes a privacy policy, permission justifications, and store assets. Approval is not yet confirmed; this 0.2.0 update adds a permission and features, so the dashboard listing and privacy disclosures must be updated with the matching package before the update is submitted.

## License

Code is MIT licensed; see [LICENSE](LICENSE). The Pi logo is a third-party asset and is not relicensed by MIT; see [ATTRIBUTION.md](ATTRIBUTION.md).
