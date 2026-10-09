# Architecture

Pi Bridge has two local components. The package installs into an existing Pi CLI and registers a stdio MCP server for each Pi session. The Chrome extension named Pi Bridge reconnects to a WebSocket listener bound only to `127.0.0.1`.

```mermaid
sequenceDiagram
    participant P as Pi MCP process
    participant B as Loopback broker
    participant E as Chrome profile extensions
    participant D as Selected or background page
    participant G as Pi Bridge tab group
    E->>B: WebSocket hello with extension origin + profile ID
    B->>B: Pin extension ID; register profile-specific socket
    B-->>E: hello_ack
    P->>B: MCP tool call with profile_id
    B->>E: Fixed command + validated parameters to selected profile
    E->>G: Create task group and background tab
    E->>D: Packaged DOM/scripting operation
    D-->>E: Page result
    E-->>B: Result
    B-->>P: MCP tool result
```

## Automatic pairing

The extension retries a fixed loopback endpoint. Each Chrome profile keeps a random profile ID and an optional user-chosen label in that profile's local extension storage. The browser supplies a `chrome-extension://<id>` origin during its WebSocket handshake. The server pins the extension ID in `~/.pi/agent/state/pi-browser-bridge/extension.json`, accepts reconnects from that ID, and registers each profile ID to a separate WebSocket. A reconnect replaces only the socket for the same profile; other profiles remain connected. Another extension ID is rejected until the Pi tool `reset_pairing` is explicitly called.

The server listens on IPv4 loopback only. It does not expose an HTTP endpoint, and it never binds to a LAN interface.

## Browser operations

The MCP server exposes fixed browser operations; there is no tool that evaluates arbitrary JavaScript or arbitrary CDP. The extension uses `chrome.scripting` with packaged functions and passes validated parameters. Text form tools reject password, hidden, file, token-like, CSRF, and one-time-code fields. Field values are not returned. A separate `upload_file` operation is the only file-input path: Pi validates a local regular file and target origin, then asks the user to confirm before the extension attaches Chrome DevTools Protocol to the selected tab and calls `DOM.setFileInputFiles`. The debugger detaches immediately; file contents are sent by Chrome directly to the destination site. Pages can still display private information that may enter model context through `read_page` or screenshots.

`download_url` uses Chrome's Downloads API for an explicitly requested HTTP/HTTPS URL. Chrome may send cookies for that URL's host. `list_page_assets` inventories visible images/media with selectors; `download_media` saves HTTP(S) and page-created `blob:`/`data:` assets through Chrome's download manager, or observes a page-triggered download, then returns the local path and metadata. The extension does not enumerate download history or open downloaded files.

The browser tools can inspect and control an explicitly selected background tab without activating it. `create_workspace` makes a named Pi Bridge tab group in the current window, and only group IDs whose titles use the reserved `Pi Bridge: ` prefix can receive new tabs through the workspace tool. It never rehomes existing tabs. `read_urls` uses temporary background tabs and removes them after each read. Screenshots are limited to the selected visible tab; background screenshot requests fail without changing focus.

The extension requests all-site access because users want to automate different web apps without granting each origin separately. Chrome displays this permission to the user. The `tabGroups` permission is used for named workspaces, `storage` saves profile IDs and labels, `downloads` monitors requested downloads, and `debugger` is attached only during confirmed file input uploads. The extension has no Cookie permission or user-script permission and collects no telemetry.

## Runtime limits

The broker keeps a map from profile ID to its socket. Calls with a `profile_id` go only to that socket, and the response must come from the same socket that received the call. If one profile is online, tools can use it implicitly. If multiple profiles are online, calls without an explicit ID fail rather than choosing one. Profile names are user-controlled labels, not routing authority. The ID and label are sent to the local Pi process; if Pi lists profiles, the values may enter model context.

The current bridge supports one Pi MCP server owning the fixed port across a Chrome profile set. Pi sessions in other processes can report that the port is busy. Within each profile, tools that accept `tab_id` can target any tab; if omitted, they target the selected tab in that profile's last-focused window. `list_tabs` and `list_workspaces` report the selected profile's last-focused window. Chrome-internal pages and the Chrome Web Store remain inaccessible to extension scripting.
