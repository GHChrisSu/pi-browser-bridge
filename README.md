# Pi Bridge

**Chrome browser tools for the Pi coding agent—no token or port to enter.** This repository installs a bridge plugin into an existing Pi installation and provides a separate Chrome extension; it does not install Pi itself.

This is an independent community project. It is not produced, sponsored, or endorsed by Pi's maintainers or Google. “Pi” is used only to describe compatibility.

## What it does

The Pi package registers a local MCP server. A Chrome extension connects to that server over a loopback WebSocket and gives Pi a focused set of browser tools:

- inspect the active tab and read visible page text;
- find interactive elements and inspect page structure;
- navigate, click, fill ordinary form fields, press keys, scroll, and wait for page changes;
- capture the visible tab as an image.

The bridge does not expose arbitrary page JavaScript, cookies, local storage, or browser debugging. It refuses password, one-time-code, hidden, and token-like form fields. Local file uploads are not part of the first release.

## Install into an existing Pi

1. In your existing Pi CLI installation, run:

   ```bash
   pi install git:github.com/GHChrisSu/pi-browser-bridge
   ```

2. The Chrome Web Store listing for **Pi Bridge** is not published yet. For development, clone this repository, open `chrome://extensions`, enable Developer mode, and load the `extension/` directory as an unpacked extension.
3. In Chrome, approve the extension's site access. Browser automation needs access to pages you ask Pi to work with.
4. Restart Pi or run `/reload`. When Pi is running, the extension connects automatically. No pairing token or port entry is required.

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

The extension is named **Pi Bridge**; its description identifies it as a Chrome bridge for the Pi coding agent. It uses no Pi logo or official styling and does not claim to be an official Pi product. Pi is a product name of its respective owner. Google Chrome and the Chrome Web Store are products of Google.

## Security model

- The MCP server binds only to `127.0.0.1` and accepts WebSocket connections only from a Chrome extension origin.
- On first connection, the Pi server automatically pins that extension's ID in a mode-`0600` file under the Pi agent directory. It accepts reconnects from the same extension and rejects a different one. Reset this pairing only when intentionally replacing the extension.
- No token is displayed, copied, or typed by the user. The bridge uses the local browser's extension-origin boundary and loopback binding instead.
- Page text and screenshots are returned to Pi's model context. Only run the bridge with models and Pi packages you trust.
- This design does not defend against malicious software already running as the same operating-system user; such a process can access the local account and spoof loopback traffic.
- The extension requests broad access to web pages so Pi can work across sites without a separate permission step for every domain. Chrome displays this permission, and users can narrow site access in the extension's Details page. It does not request cookie, debugger, or user-script permissions and sends no telemetry.

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

The extension is being prepared for Chrome Web Store review. The repository includes a privacy policy, permission justification, and a draft popup screenshot under `store-assets/`. Store submission still requires a signed-in developer account and Google's review; this repository does not claim that store review is complete.

## License

MIT. See [LICENSE](LICENSE).
