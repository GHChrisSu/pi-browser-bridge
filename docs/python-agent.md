# Connect a Python MCP client

Pi users should install the package through Pi; each Pi session starts a stdio MCP server process. A standalone Python agent is an MCP client that launches the same local stdio MCP server; that server attaches to the shared browser broker.

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

The Chrome extension is still required. Each Pi or external MCP client keeps its own stdio session and attaches to the shared broker; only the broker owns the fixed loopback port. Multiple clients can use different Chrome profiles concurrently. Calls that mutate one profile are serialized, while reads remain concurrent. The Pi package confirms local file uploads before transfer; if using another MCP client, require that client to show and obtain the user's approval for the specific file and website.
