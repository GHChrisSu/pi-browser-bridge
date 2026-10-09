# Browser Bridge for Pi

**Browser automation tools for Pi, with no token or port to enter.** Install the Pi package and the Chrome extension; the extension reconnects to Pi automatically whenever a Pi session is running.

This is an independent community project. It is not produced, sponsored, or endorsed by Pi's maintainers or Google. “Pi” is used only to describe compatibility.

## What it does

The Pi package registers a local MCP server. A Chrome extension connects to that server over a loopback WebSocket and gives Pi a focused set of browser tools:

- inspect the active tab and read visible page text;
- find interactive elements and inspect page structure;
- navigate, click, fill ordinary form fields, press keys, scroll, and wait for page changes;
- capture the visible tab as an image.

The bridge does not expose arbitrary page JavaScript, cookies, local storage, or browser debugging. It refuses password, one-time-code, hidden, and token-like form fields. Local file uploads are not part of the first release.

## Install

1. Install the Pi package:

   ```bash
   pi install git:github.com/GHChrisSu/pi-browser-bridge
   ```

2. Install **Pi Browser Bridge** from the Chrome Web Store. The store listing will be linked here after review.
3. In Chrome, approve the extension's site access. Browser automation needs access to pages you ask Pi to work with.
4. Restart Pi or run `/reload`. When Pi is running, the extension connects automatically. No pairing token or port entry is required.

Open the extension popup to see whether Pi is connected. If a development extension is replaced and receives a new Chrome ID, call the `reset_pairing` browser tool once to let it pair again.

## Name and affiliation

The package and extension are named **Pi Browser Bridge** to identify the Pi integration. They use no Pi logo or official styling and do not claim to be an official Pi product. Pi is a product name of its respective owner. Google Chrome and the Chrome Web Store are products of Google.

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

The extension is being prepared for Chrome Web Store review. Store submission requires a developer account, a privacy disclosure, a permission justification, screenshots, and Google's review. This repository does not claim that store review is complete.

## License

MIT. See [LICENSE](LICENSE).
