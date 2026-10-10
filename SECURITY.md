# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature on the repository if it is enabled. Otherwise, open a GitHub security advisory request or contact the maintainer through the repository. Include the affected version, impact, and reproduction steps. Do not include cookies, passwords, one-time codes, or browser profile files.

## Security boundaries

Pi Bridge is a local browser-control tool for the Pi coding agent. One broker per Pi agent directory owns the loopback Chrome endpoint, and each Pi session connects through its own stdio MCP adapter. The broker accepts Chrome extension commands only from the pinned `chrome-extension://` origin. MCP adapters use an authenticated `/mcp` WebSocket path on the same loopback port; the random bearer token is stored under the Pi agent directory with mode `0600`, and the control route rejects browser `Origin` headers. Each Chrome profile stores a random routing ID and an optional user-chosen label in local extension storage. The broker routes calls by ID and accepts replies only from the socket that received the command. Profile labels are descriptive and are not security credentials.

Read operations can run concurrently. Mutations are serialized within a Chrome profile, while different profiles remain independent; Chrome download-manager operations are serialized separately. Each Pi session receives its own MCP results and upload-confirmation flow even though the broker is shared.

The bridge does not request the Chrome `cookies` or `userScripts` permissions and does not expose arbitrary JavaScript or arbitrary CDP. It requests `debugger` only for fixed accessibility-tree snapshots, revalidated user-requested pointer clicks, ordinary accessible textbox fills, and confirmed file uploads, and detaches after each operation. Accessibility results omit form/control values. Pi blocks uploads without an interactive confirmation dialog; the confirmation shows the canonical local path, size, target origin, profile ID, and tab. Uploads are limited to regular files up to 50 MiB. Downloads are size-limited, returned as local paths, and never opened or executed automatically. Treat page content and downloaded files as untrusted; review any action that changes an account, uploads data, or submits a form.

The bridge is not designed to defend against malicious software already running as the same OS user. Such software can inspect or spoof local loopback traffic. The server must never bind to a non-loopback interface.
