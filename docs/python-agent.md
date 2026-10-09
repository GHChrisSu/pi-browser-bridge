# Connect a Python MCP client

Pi users should install the package through Pi; the extension registers the stdio MCP server automatically. A Python agent is a separate MCP client and must launch the same local server itself.

## JSON MCP config

Clone the repository and install the Node dependencies once:

```bash
git clone https://github.com/GHChrisSu/pi-browser-bridge.git
cd pi-browser-bridge
npm ci
node ./bin/pi-browser-bridge.js mcp-config --format json
```

The command prints an `mcpServers` entry with an absolute Node executable, server path, and working directory. If the agent reads a JSON MCP configuration file, this command can merge the entry while preserving other fields:

```bash
node ./bin/pi-browser-bridge.js mcp-config --write /path/to/your-agent-mcp.json
```

If a different server already uses the `pi-browser-bridge` name, the command refuses to replace it. Review the file and use `--force` only if you intend to replace that entry.

## Python SDK

The MCP Python SDK uses stdio to launch the server. Print the exact local parameters with:

```bash
node ./bin/pi-browser-bridge.js mcp-config --format python
```

It emits a `StdioServerParameters` snippet that you can add to the agent's startup code. The agent process should keep the stdio session open while it uses browser tools.

The Chrome extension is still required. One Pi or external MCP server can serve multiple Chrome profiles through the same fixed bridge port. Only one MCP server process can own that port; close the Pi session before starting a separate Python agent. The Pi package confirms local file uploads before transfer; if using another MCP client, require that client to show and obtain the user's approval for the specific file and website.
