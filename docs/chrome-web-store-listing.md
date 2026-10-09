# Chrome Web Store listing draft

## Listing details

**Name:** Pi Bridge

**Short description:** Chrome bridge for the Pi coding agent on this computer.

**Category:** Developer Tools

**Language:** English (United States)

**Single purpose:** Connect the Pi coding agent already running on the user's computer to the user's selected Chrome profile for on-demand page reading, browser interaction, and user-requested file transfer.

## Full description

Pi Bridge connects the Pi coding agent running on this computer to Chrome. It is an independent community project and does not install Pi.

With Pi and the Pi Bridge extension installed, you can ask Pi to:

- Read visible page text and inspect interactive elements in the active tab or a background tab you select.
- Create background tabs and organize them into named Pi Bridge tab groups without moving existing tabs or changing the selected tab.
- Read up to five web pages in temporary background tabs and close them after reading.
- List visible page images, media, and download links; download selected assets to the local Downloads folder.
- Download a file from a page control or a specific HTTP/HTTPS URL and get its local path for use in your project.
- Upload a specific local file to a page file input after Pi confirms the file and destination site with you.
- Navigate, click, fill ordinary form fields, press keys, scroll, and wait for page updates in a selected tab.
- Find controls by accessible role and name with Playwright-style locators, or inspect paginated node IDs and click with a browser-level pointer event.
- Capture the visible tab as a screenshot. Pi Bridge will not switch focus to capture a background tab.
- Control multiple Chrome profiles connected to the same Pi session, choosing a profile by ID when more than one is online.

Each Chrome profile has a stable local profile ID; the extension generates a short default label, which you can optionally change in the popup. Ask Pi to list connected profiles, then pass the chosen `profile_id` to browser tools. If multiple profiles are connected, Pi Bridge requires an explicit choice so a command cannot silently go to the wrong profile.

Privacy and safety:

- Page text, page titles and URLs, accessible labels, selected control metadata, tab metadata, Pi Bridge workspace names, and screenshots are returned to the Pi process on this computer. Pi may include that content in requests to the model provider configured by the user. Visible page content can contain personal or confidential information.
- The extension stores a random profile ID and an optional display label in that Chrome profile's local extension storage. It sends these values to the Pi process on this computer for profile routing; Pi may include them in model context when you list profiles. They are not sent to the project maintainer or a remote bridge server.
- Download results return a local path and basic metadata to Pi. Pi may include the path or file contents in model context if asked to inspect or integrate the file; downloaded files are never opened or executed automatically.
- Uploading sends one non-empty local file of up to 50 MiB directly from Chrome to the specified website. Pi asks for confirmation showing the file path, size, target origin, profile, and tab. Pi Bridge's project servers receive no copy.
- The extension does not read website cookies, a site's local or session storage, or password and hidden-input values. It uses Chrome extension storage only for the profile ID and optional display label. It refuses to fill password, hidden, file, and token-like form fields. Visible page text and screenshots may still show sensitive information.
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

**Dashboard data categories:** Declare website content, browsing activity, user activity, user-provided content, and a persistent identifier for the random profile ID. Files uploaded through the browser can contain personal or confidential categories; select any additional categories that your extension's intended use permits. Use the exact labels shown by the dashboard.

**User data handled:** On-demand page text, titles, URLs, labels, control metadata, tab and workspace metadata, screenshots, profile ID and optional label, download metadata and local paths, and files the user chooses to upload. Page and download data go to local Pi and may be forwarded to the configured model provider when requested. Upload file contents travel directly from Chrome to the specified website after confirmation. The extension does not send data to the project maintainer or a remote bridge server and includes no analytics or advertising SDKs.

**Permission justifications:**

- `host_permissions` (`<all_urls>`): permits user-requested browser operations across HTTP/HTTPS sites without a separate permission prompt for every domain. The extension inspects a page only when Pi requests an operation. Chrome restricts browser-internal and Web Store pages regardless of this permission.
- `scripting`: runs fixed, packaged DOM inspection and interaction functions on the selected page; it does not execute model-supplied JavaScript.
- `tabs`: identifies tabs in the last-focused window and creates background or temporary tabs. It captures a screenshot only when the target is the visible tab; it does not access browsing history.
- `tabGroups`: creates named Pi Bridge workspace groups for background task tabs; existing user tabs are not moved.
- `storage`: stores a random profile ID and optional display label in local extension storage scoped to this Chrome profile; the values are sent to the local Pi server for routing.
- `downloads`: tracks downloads initiated by an explicit Pi request and returns local path/metadata; it does not enumerate or erase download history. Direct URL downloads use Chrome's Downloads API and may send cookies for the destination host.
- `debugger`: attaches briefly to read the selected tab's accessibility tree, perform a node-targeted browser pointer click, fill an ordinary accessible textbox through browser input events, and set a user-confirmed file on a validated file input. It uses only fixed DevTools commands, omits form values from tree results, and detaches after each operation; the model receives no arbitrary CDP, Playwright runtime, or JavaScript tool.
- `alarms`: retries the loopback connection when Pi starts after Chrome.
- Local WebSocket: connects only to the Pi MCP server at `127.0.0.1`.

**Remote code:** No. Browser operations are packaged with the extension; no remote JavaScript is downloaded or evaluated.

**Affiliation and logo:** Independent community project, not affiliated with or endorsed by Pi's maintainers or Google. The Pi logo identifies compatibility only; its ownership remains with Pi. The repository's MIT license does not relicense the logo; see `ATTRIBUTION.md`.

**Store status:** Pi Bridge 0.6.0 is an update package. It includes the accessible role/name browser tools; the optional Playwright MCP server and Microsoft Playwright Chrome Extension are separate installations and are not bundled with this Chrome Web Store item. Do not describe 0.6.0 as available from the Chrome Web Store until Google approves the updated package and listing.
