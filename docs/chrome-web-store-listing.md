# Chrome Web Store listing draft

## Listing details

**Name:** Pi Bridge

**Short description:** Chrome bridge for the Pi coding agent on this computer; no token to enter.

**Category:** Developer Tools

**Language:** English (United States)

**Single purpose:** Connect the Pi coding agent already running on the user's computer to the active Chrome tab for user-requested page reading and browser interaction.

## Full description

Pi Bridge connects the Pi coding agent running on this computer to Chrome. It is an independent community project and does not install Pi.

With Pi and the Pi Bridge extension installed, you can ask Pi to:

- Read visible page text and inspect interactive elements on the active tab.
- Navigate, click, fill ordinary form fields, press keys, scroll, and wait for page updates.
- Capture the visible tab as a screenshot.

Pairing happens automatically over a local connection. No token or port needs to be entered.

Privacy and safety:

- Page text, the page title and URL, accessible labels, control metadata, and screenshots are returned to the Pi process on this computer. Pi may include that content in requests to the model provider configured by the user. Visible page content can contain personal or confidential information.
- The extension does not send browsing data to the project maintainers, an analytics service, an advertising service, or a remote bridge server.
- The extension does not read cookies, browser storage, or password and hidden-input values. It refuses to fill password, hidden, file, and token-like fields. Visible page text or a screenshot may still contain a code or other sensitive information displayed on the page.
- It uses fixed, packaged browser operations and does not execute model-supplied JavaScript.
- Chrome restricts extensions on some pages, including browser-internal pages and the Chrome Web Store; those pages cannot be controlled by Pi Bridge.

Pi CLI must already be installed. Install the Pi package and this Chrome extension separately; this extension does not install Pi.

Pi Bridge is an independent community project and is not affiliated with, sponsored by, or endorsed by Pi's maintainers or Google. Pi and the Pi logo remain the property of their respective owners.

## Store assets

- **Store icon:** `extension/icons/icon-128.png` — PNG, 128 × 128.
- **Screenshot:** `store-assets/connected-popup-640x400.png` — PNG, 640 × 400, no alpha channel; meets the screenshot size shown in the dashboard. At least one screenshot is required.
- **Promotional video:** leave blank (optional).
- **Small promotional tile, 440 × 280:** leave blank (optional).
- **Marquee promotional tile, 1400 × 560:** leave blank (optional).

## Additional fields

- **Official URL:** None, unless a separately verified domain is available.
- **Homepage URL:** `https://github.com/GHChrisSu/pi-browser-bridge`
- **Support URL:** `https://github.com/GHChrisSu/pi-browser-bridge/issues`
- **Adult content:** No.
- **Item support settings:** keep the current public default.

## Privacy and permission disclosures

**Privacy policy URL:** `https://github.com/GHChrisSu/pi-browser-bridge/blob/main/PRIVACY.md`

**User data handled:** On-demand visible page text, page title and URL, accessible labels, selected control metadata, and screenshots. These are sent to the local Pi process and may be forwarded by Pi to the model provider selected by the user. The extension does not send data to the project maintainer or a remote bridge server, and does not include analytics or advertising SDKs. Do not claim that user-requested visible page content is never shared with a provider.

**Permission justifications:**

- `host_permissions` (`<all_urls>`): permits user-requested browser operations across HTTP/HTTPS sites without a separate permission prompt for every domain. The extension inspects a page only when Pi requests an operation. Chrome restricts browser-internal and Web Store pages regardless of this permission.
- `scripting`: runs fixed, packaged DOM inspection and interaction functions on the selected page; it does not execute model-supplied JavaScript.
- `tabs`: identifies the active tab and captures a visible-tab screenshot when requested.
- `alarms`: retries the loopback connection when Pi starts after Chrome.
- Local WebSocket: connects only to the Pi MCP server at `127.0.0.1`.

**Remote code:** No. Browser operations are packaged with the extension; no remote JavaScript is downloaded or evaluated.

**Affiliation and logo:** Independent community project, not affiliated with or endorsed by Pi's maintainers or Google. The Pi logo identifies compatibility only; its ownership remains with Pi. The repository's MIT license does not relicense the logo; see `ATTRIBUTION.md`.

**Store status:** Do not describe the extension as published until Google approves the listing.
