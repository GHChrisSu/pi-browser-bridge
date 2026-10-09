# Chrome Web Store listing draft

**Name:** Pi Bridge

**Short description:** Chrome bridge for the Pi coding agent, with automatic local pairing and no token to copy.

**Single purpose:** Connect the Pi coding agent running on this computer to the user's active Chrome tab so Pi can inspect page content and perform user-requested browser interactions.

**Permission justification:**

- `host_permissions` for web pages: the extension needs broad HTTP/HTTPS access so Pi can work across sites without a separate permission step per domain. Chrome shows this access to users; users can narrow it in the extension's Site access settings.
- `scripting`: injects a small, fixed set of DOM inspection and interaction functions. The extension does not execute model-supplied JavaScript.
- `tabs`: identifies the active tab and captures its visible screenshot.
- `alarms`: retries the loopback connection when Pi starts after Chrome.
- WebSocket connection to `127.0.0.1`: communicates only with the local Pi MCP server.

**Data use:** Page text and screenshots are sent to the local Pi process and may be included in the configured model provider's request. The extension sends no analytics or telemetry. It does not read cookies, passwords, authentication codes, or browser storage.

**Privacy policy URL:** `https://github.com/GHChrisSu/pi-browser-bridge/blob/main/PRIVACY.md`

**Screenshot draft:** `store-assets/connected-popup-640x400.png` (captured from the extension popup connected to the local Pi MCP server).

**Affiliation:** Independent community project; not affiliated with or endorsed by the Pi maintainers or Google.

**Store status:** Draft. Do not describe the item as published until the Chrome Web Store approves it.
