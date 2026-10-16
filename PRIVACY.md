# Privacy policy

Pi Bridge is an independent local Chrome browser bridge for the Pi coding agent.

## Data processed

When you ask Pi to fill an ordinary accessible textbox, the requested text is sent to that page through Chrome input events. Pi Bridge does not return the resulting control value in accessibility results. Visible page text and screenshots can include personal or confidential information, including a verification code displayed on screen.

Each Chrome profile has a random profile ID and an optional display label stored in that profile's local Chrome extension storage. The extension sends these values to the shared local Pi Bridge broker so commands can be routed to the intended profile. A local random bearer token lets the broker distinguish its Pi MCP adapters from other loopback clients. It is stored with mode 0600 under the Pi agent directory and is never sent to Chrome; the broker binds only to 127.0.0.1. Profile IDs and labels may enter the model context when Pi lists connected profiles.

When you ask Pi to download a file, the extension waits for Chrome's download to finish and returns its local path and basic metadata to Pi. Direct HTTP/HTTPS downloads use Chrome's Downloads API; Chrome may send cookies for that download URL's host. Downloads are limited in size and are not opened or executed automatically. Pi can read the returned file if you ask it to inspect or integrate it, and may then include its contents in a request to your configured model provider.

When you request an upload, Pi displays an action-time confirmation with the canonical file path, file size, Chrome profile, tab, and website origin. Uploads are limited to one regular file no larger than 50 MiB; common credentials, key filenames, and protected key directories are blocked. After confirmation, Chrome sets that file on the selected page's `input[type=file]` and sends the file contents directly to that website. Pi Bridge and its maintainers do not receive a copy of the uploaded file contents.

Optional network observation, when enabled, stores only request metadata in memory for the current extension service-worker lifetime: redacted URL, method, resource type, status, and timing. Query values are removed; request/response headers and bodies are not collected. Optional network rules are stored by Chrome as temporary rules with an expiry of at most 24 hours, and can block, redirect, or change headers for requests. In Pi, each rule change requires a confirmation showing its action and target filter.

Optional clipboard access reads or writes plain text only after the Pi tool call is confirmed. Clipboard reads are returned to the Pi model context. Optional user-script execution, site-storage access, and authenticated HTTP requests are available only after the corresponding Chrome permission is enabled in the popup; Pi confirms each call. User scripts run in the page's MAIN world and can read or change anything available to that page. Cookie and storage reads can expose login tokens; authenticated requests can send profile cookies to the requested host. HTTP redirects are refused. Cookie audits clear the selected site's cookies and may sign the user out; they require confirmation. Session fixtures contain cookies and site storage and are saved in local Chrome extension storage after confirmation. Session recordings are mode-0600 JSONL files under the Pi agent directory; they omit typed values, credentials, scripts, uploads, network bodies, and tool results. A saved MHTML page archive is written to a new local file after confirmation and may contain confidential page content. Visual-diff baselines and saved window layouts remain in Chrome extension storage. Baselines contain page images; layouts store window bounds and tab origin/path identifiers without query strings, fragments, or page text. You can remove these through the corresponding bridge tools or Chrome's extension storage controls.

The package runs a shared local broker for Pi sessions that use the same agent directory. Each session has a separate stdio MCP adapter and receives only its own tool results and action-confirmation flow; the broker keeps the Chrome profile connections shared until its idle shutdown. It does not send profile or page data to the project maintainer or a remote broker.

## Data collection and sharing

The extension does not send page or profile data to the project maintainer, an analytics service, or a remote bridge server. It includes no analytics or advertising SDKs. It does not persist page text or a browsing history. Network metadata is held in bounded memory and is lost when Chrome restarts the extension service worker. When a user saves a visual baseline or window layout, that data remains in the local Chrome extension storage. Profile IDs and optional labels remain there too. User-requested page data and download metadata go to the initiating local Pi session and may be forwarded to the model provider configured by the user. File-upload contents travel directly from Chrome to the website named in the confirmation.

## Permissions

- **Host access:** grants access to HTTP and HTTPS pages so Pi can work across sites without a separate permission step for every domain. The extension inspects a page only when Pi requests an operation. Chrome restricts browser-internal pages and the Chrome Web Store.
- **Tabs:** identifies tabs in the last-focused window, creates background or temporary tabs, and captures the visible tab when requested. It does not access browsing history.
- **Scripting:** runs fixed packaged DOM inspection and interaction functions by default. Optional `userScripts` permission enables the separately confirmed `execute_js` tool in the page's MAIN world; Chrome may also require enabling “Allow user scripts” in extension details.
- **Tab groups:** creates and updates named Pi Bridge groups for background work; existing tabs are not moved into them.
- **Storage:** stores a random profile ID and optional display label locally for each Chrome profile. Session fixtures also store confirmed website cookie/storage snapshots in extension storage.
- **Downloads:** waits for requested downloads and returns their path and metadata. The extension does not enumerate or erase download history. Chrome may send cookies for the destination host when the Downloads API is used.
- **Optional cookies:** enables separately confirmed reads/writes of page cookies and local/session storage, authenticated requests that send cookies to the requested HTTP/HTTPS host, and session fixtures. Authenticated HTTP redirects are refused.
- **Optional userScripts:** enables confirmed arbitrary JavaScript execution in the selected page's MAIN world. This code can read or modify data available to the website.
- **Debugger:** attaches briefly for confirmed uploads, on-demand accessibility-tree reads, user-requested pointer clicks and hover, and ordinary accessible textbox fills through Chrome input events. It exposes no arbitrary CDP forwarding tool.
- **Optional pageCapture:** captures the selected page as a user-requested MHTML archive, saved to a new local output file after Pi confirmation.
- **Optional webRequestAuthProvider:** permits in-memory HTTP Basic/Digest credentials scoped to one origin. Pi confirms changes; credentials are not written to disk and clear on service-worker restart or permission revocation.
- **Optional declarativeNetRequestWithHostAccess:** permits confirmed session-scoped block, redirect, and header-modification rules. Rules expire within 24 hours and clear on browser restart.
- **Optional clipboardRead/clipboardWrite/offscreen:** reads or writes plain text through an offscreen document. Pi confirms each clipboard action; read data is returned to the model context.
- **Optional webRequest:** observes bounded request URL/method/type/status/timing metadata with query values redacted; it does not collect headers or bodies.
- **Alarms:** retries the local Pi connection and removes expired network rules.

The Pi package pins the extension ID in a mode-`0600` file under the Pi agent directory. Shared broker authentication is a random local token in a mode-`0600` file under the same agent directory and is never sent to Chrome. Each Chrome profile has a separate local profile identity.

## Contact

Report privacy or security concerns through the private vulnerability reporting feature on the GitHub repository.
