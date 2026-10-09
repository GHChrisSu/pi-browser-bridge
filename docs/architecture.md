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

The extension retries a fixed loopback endpoint. Each Chrome profile keeps a random profile ID and a user-chosen name in that profile's local extension storage. The browser supplies a `chrome-extension://<id>` origin during its WebSocket handshake. The server pins the extension ID in `~/.pi/agent/state/pi-browser-bridge/extension.json`, accepts reconnects from that ID, and registers each profile ID to a separate WebSocket. A reconnect replaces only the socket for the same profile; other profiles remain connected. Another extension ID is rejected until the Pi tool `reset_pairing` is explicitly called.

The server listens on IPv4 loopback only. It does not expose an HTTP endpoint, and it never binds to a LAN interface.

## Browser operations

The MCP server exposes fixed browser operations; there is no tool that evaluates arbitrary JavaScript. The extension uses `chrome.scripting` with packaged functions and passes only validated parameters. Form tools reject password, hidden, file, token-like, CSRF, and one-time-code fields. Field values are not returned in tool results. Pages can still display private information, which may enter the configured model context through `read_page` or screenshots.

The browser tools can inspect and control an explicitly selected background tab without activating it. `create_workspace` makes a named Pi Bridge tab group in the current window, and only group IDs whose titles use the reserved `Pi Bridge: ` prefix can receive new tabs through the workspace tool. It never rehomes existing tabs. `read_urls` uses temporary background tabs and removes them after each read. Screenshots are limited to the selected visible tab; background screenshot requests fail without changing focus.

The extension requests all-site access because users want to automate different web apps without granting each origin separately. Chrome displays this permission to the user. The `tabGroups` permission is used for named workspaces. The `storage` permission holds a random profile ID and a user-chosen label scoped to each Chrome profile. These are sent only to the local Pi server for routing; if Pi lists profiles, the returned IDs and labels may enter the model context. The extension has no Cookie, debugger, or user-script permission and does not collect telemetry.

## Runtime limits

The broker keeps a map from profile ID to its socket. Calls with a `profile_id` go only to that socket, and the response must come from the same socket that received the call. If one profile is online, tools can use it implicitly. If multiple profiles are online, calls without an explicit ID fail rather than choosing one. Profile names are user-controlled labels, not routing authority. The ID and label are sent to the local Pi process; if Pi lists profiles, the values may enter model context.

The current bridge supports one Pi MCP server owning the fixed port across a Chrome profile set. Pi sessions in other processes can report that the port is busy. Within each profile, tools that accept `tab_id` can target any tab; if omitted, they target the selected tab in that profile's last-focused window. `list_tabs` and `list_workspaces` report the selected profile's last-focused window. Chrome-internal pages and the Chrome Web Store remain inaccessible to extension scripting.
