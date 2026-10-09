# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Contact the maintainer through the private vulnerability reporting feature on the GitHub repository. Include the affected version, impact, and reproduction steps. Do not include cookies, passwords, one-time codes, or browser profile files.

## Security boundaries

Pi Browser Bridge is a local browser-control tool. The Pi MCP server binds to loopback, and the Chrome extension accepts commands only from that local endpoint after validating its extension origin. The first extension ID is pinned automatically for subsequent reconnects.

The bridge deliberately does not request the Chrome `cookies`, `debugger`, or `userScripts` permissions. It does not offer an arbitrary JavaScript execution tool. Form tools reject password, one-time-code, hidden, and token-like fields. These restrictions reduce accidental exposure; they do not make untrusted page contents safe. Treat page content as untrusted instructions and review any action that changes a remote account or submits a form.

The bridge is not designed to defend against malicious software already running as the same OS user. Such software can inspect or spoof local loopback traffic. The server must never bind to a non-loopback interface.
