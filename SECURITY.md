# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature on the repository if it is enabled. Otherwise, open a GitHub security advisory request or contact the maintainer through the repository. Include the affected version, impact, and reproduction steps. Do not include cookies, passwords, one-time codes, or browser profile files.

## Security boundaries

Pi Bridge is a local browser-control tool for the Pi coding agent. The Pi MCP server binds to loopback, and the Chrome extension accepts commands only from that local endpoint after validating its extension origin. The first extension ID is pinned automatically for subsequent reconnects. Each Chrome profile stores a random routing ID and an optional user-chosen label in local extension storage. One Pi Bridge server can accept several profiles; calls are routed by ID and replies are accepted only from the socket that received the command. Profile labels are descriptive and are not security credentials.

The bridge does not request the Chrome `cookies` or `userScripts` permissions and does not expose arbitrary JavaScript or arbitrary CDP. It requests `debugger` only for fixed accessibility-tree snapshots, revalidated user-requested pointer clicks, ordinary accessible textbox fills, and confirmed file uploads, and detaches after each operation. Accessibility results omit form/control values. Pi blocks uploads without an interactive confirmation dialog; the confirmation shows the canonical local path, size, target origin, profile ID, and tab. Uploads are limited to regular files up to 50 MiB. Downloads are size-limited, returned as local paths, and never opened or executed automatically. Treat page content and downloaded files as untrusted; review any action that changes an account, uploads data, or submits a form.

The bridge is not designed to defend against malicious software already running as the same OS user. Such software can inspect or spoof local loopback traffic. The server must never bind to a non-loopback interface.
