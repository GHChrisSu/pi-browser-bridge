# Chrome Web Store listing draft

## Listing details

**Name:** Pi Bridge

**Short description:** Chrome bridge for the Pi coding agent on this computer.

**Category:** Developer Tools

**Language:** English (United States)

**Single purpose:** Connect the Pi coding agent already running on the user's computer to the active Chrome tab for user-requested page reading and browser interaction.

## Full description

Pi Bridge connects the Pi coding agent running on this computer to Chrome. It is an independent community project and does not install Pi.

With Pi and the Pi Bridge extension installed, you can ask Pi to:

- Read visible page text and inspect interactive elements in the active tab or a background tab you select.
- Create background tabs and organize them into named Pi Bridge tab groups without moving existing tabs or changing the selected tab.
- Read up to five web pages in temporary background tabs and close them after reading.
- Navigate, click, fill ordinary form fields, press keys, scroll, and wait for page updates in a selected tab.
- Capture the visible tab as a screenshot. Pi Bridge will not switch focus to capture a background tab.
- Control multiple Chrome profiles connected to the same Pi session, choosing a profile by ID when more than one is online.

Each Chrome profile has a stable local profile ID; the extension generates a short default label, which you can optionally change in the popup. Ask Pi to list connected profiles, then pass the chosen `profile_id` to browser tools. If multiple profiles are connected, Pi Bridge requires an explicit choice so a command cannot silently go to the wrong profile.

Privacy and safety:

- Page text, page titles and URLs, accessible labels, selected control metadata, tab metadata, Pi Bridge workspace names, and screenshots are returned to the Pi process on this computer. Pi may include that content in requests to the model provider configured by the user. Visible page content can contain personal or confidential information.
- The extension stores a random profile ID and an optional display label in that Chrome profile's local extension storage. It sends these values to the Pi process on this computer for profile routing; Pi may include them in model context when you list profiles. They are not sent to the project maintainer or a remote bridge server.
- The extension does not read website cookies, a site's local or session storage, or password and hidden-input values. It uses Chrome's extension storage only for the profile ID and display name described above. It refuses to fill password, hidden, file, and token-like fields. Visible page text or screenshots may still show sensitive information.
- It uses fixed, packaged browser operations and does not execute model-supplied JavaScript.
- Chrome restricts extensions on some pages, including browser-internal pages and the Chrome Web Store; those pages cannot be controlled by Pi Bridge.

Pi CLI must already be installed. Install Pi Bridge in Chrome and install its Pi package separately:

1. Install this extension from the Chrome Web Store in every Chrome profile you want Pi to control.
2. In the existing Pi CLI, run `pi install git:github.com/GHChrisSu/pi-browser-bridge`.
3. Restart Pi or run `/reload` so Pi starts the local browser tools.
4. Use `list_profiles` to see connected profiles. Browser tools automatically use the only connected profile; if several are connected, pass the chosen `profile_id`.

The Pi package does not install this Chrome extension, and this Chrome extension does not install Pi.

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

**Dashboard data categories:** Declare website content, browsing activity, and user activity because Pi can read requested pages, list tabs, and perform requested interactions; declare a persistent identifier category for the random profile ID. The optional profile label is user supplied. Follow the exact labels shown by the dashboard.

**User data handled:** On-demand visible page text, page titles and URLs, accessible labels, selected control metadata, tab IDs and state, workspace names, screenshots, and a random Chrome profile ID plus an optional display label. These go to the local Pi process; page content and profile metadata may be forwarded to your configured model provider when requested. The extension sends no data to the project maintainer or a remote bridge server and includes no analytics or advertising SDKs.

**Permission justifications:**

- `host_permissions` (`<all_urls>`): permits user-requested browser operations across HTTP/HTTPS sites without a separate permission prompt for every domain. The extension inspects a page only when Pi requests an operation. Chrome restricts browser-internal and Web Store pages regardless of this permission.
- `scripting`: runs fixed, packaged DOM inspection and interaction functions on the selected page; it does not execute model-supplied JavaScript.
- `tabs`: identifies tabs in the last-focused window and creates background or temporary tabs. It captures a screenshot only when the target is the visible tab; it does not access browsing history.
- `tabGroups`: creates named Pi Bridge workspace groups for background task tabs; existing user tabs are not moved.
- `storage`: stores a random profile ID and optional display label in local extension storage scoped to this Chrome profile; the values are sent to the local Pi server for routing.
- `alarms`: retries the loopback connection when Pi starts after Chrome.
- Local WebSocket: connects only to the Pi MCP server at `127.0.0.1`.

**Remote code:** No. Browser operations are packaged with the extension; no remote JavaScript is downloaded or evaluated.

**Affiliation and logo:** Independent community project, not affiliated with or endorsed by Pi's maintainers or Google. The Pi logo identifies compatibility only; its ownership remains with Pi. The repository's MIT license does not relicense the logo; see `ATTRIBUTION.md`.

**Store status:** Do not describe the extension as published until Google approves the listing.
