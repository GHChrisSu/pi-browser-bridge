# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature on the repository if it is enabled. Otherwise, open a GitHub security advisory request or contact the maintainer through the repository. Include the affected version, impact, and reproduction steps. Do not include cookies, passwords, one-time codes, or browser profile files.

## Security boundaries

Pi Bridge is a local browser-control tool for the Pi coding agent. One broker per Pi agent directory owns the loopback Chrome endpoint, and each Pi session connects through its own stdio MCP adapter. The broker accepts Chrome extension commands only from the pinned `chrome-extension://` origin. MCP adapters use an authenticated `/mcp` WebSocket path on the same loopback port; the random bearer token is stored under the Pi agent directory with mode `0600`, and the control route rejects browser `Origin` headers. Each Chrome profile stores a random routing ID and an optional user-chosen label in local extension storage. The broker routes calls by ID and accepts replies only from the socket that received the command. Profile labels are descriptive and are not security credentials.

Read operations can run concurrently. Mutations are serialized within a Chrome profile, while different profiles remain independent; Chrome download-manager operations are serialized separately. Each Pi session receives its own MCP results and upload-confirmation flow even though the broker is shared.

The bridge does not request cookie or page-script permissions by default. Those permissions can be enabled explicitly from the popup for advanced features; Pi confirms every script, cookie/storage operation, and authenticated HTTP request. `execute_js` then runs user-supplied code in the page's MAIN world, and cookie-backed requests can expose login state to the requested host. The fixed broker still exposes only named commands, never an arbitrary CDP proxy. It requests `debugger` only for packaged accessibility operations, hover, and confirmed uploads.

The extension offers optional `webRequest`, `webRequestAuthProvider`, `declarativeNetRequestWithHostAccess`, `pageCapture`, `cookies`, `userScripts`, and clipboard permissions that are off by default. Network observation collects only bounded request metadata; it strips query values and never collects request/response bodies or headers. Network-rule changes require Pi's per-call confirmation and expire within 24 hours; they are session-scoped and Chrome clears them when the browser restarts. Clipboard operations require Pi confirmation and can transfer clipboard text into the model context. Page-script, storage, authenticated-request, page-archive, session-fixture, and cookie-audit calls are separately confirmed; cookies/storage and fixtures may contain login credentials, and scripts can read or alter page data. HTTP auth credentials stay in memory and clear when permission is revoked or the service worker restarts. Visual baselines, window layouts, fixtures, and session recordings remain in local Chrome extension storage or the mode-0600 Pi state directory as described in the privacy policy.

Downloads are size-limited, returned as local paths, and never opened or executed automatically. Treat page content and downloaded files as untrusted; review any action that executes page code, reads or writes cookies/storage, sends an authenticated request, changes an account, uploads data, changes network behavior, reads clipboard contents, or submits a form.

The bridge is not designed to defend against malicious software already running as the same OS user. Such software can inspect or spoof local loopback traffic. The server must never bind to a non-loopback interface.
