# Delegate Chrome work to a Playwright browser agent

Pi Bridge can ship a `playwright-browser` specialist agent through Pi Subagents. The child uses Microsoft's Playwright MCP server and its Chrome Extension to control an explicitly selected tab in an existing Chrome profile. Pi Bridge itself remains a separate extension and local browser MCP server.

## Install the Pi agent

Install Pi Subagents if it is not already installed, then install or update Pi Bridge:

```bash
pi install npm:pi-subagents
pi install git:github.com/GHChrisSu/pi-browser-bridge
```

The Playwright MCP server is separate from the Pi Bridge package. Add this entry to `~/.pi/agent/mcp.json` and merge it with any existing `mcpServers` entries:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@0.0.83", "--extension"],
      "timeout": 180,
      "exposure": "hidden",
      "description": "Playwright for the user-approved Chrome tab group.",
      "toolExposure": {
        "browser_tabs": "direct",
        "browser_snapshot": "direct",
        "browser_find": "direct",
        "browser_navigate": "direct",
        "browser_navigate_back": "direct",
        "browser_click": "direct",
        "browser_fill_form": "direct",
        "browser_type": "direct",
        "browser_press_key": "direct",
        "browser_wait_for": "direct",
        "browser_select_option": "direct",
        "browser_hover": "direct",
        "browser_take_screenshot": "direct"
      }
    }
  }
}
```

This allowlist gives the agent accessible snapshots and ordinary browser interactions. It leaves arbitrary page JavaScript, arbitrary Playwright code, network request bodies, downloads, and file uploads hidden. Do not add a Playwright extension authentication token; keep its per-connection approval dialog enabled.

## Install the Chrome Extension

Install [Microsoft Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm) in the Chrome profile you want the agent to use. Chrome will disclose the extension's `debugger`, tabs, tab-groups, active-tab, and all-site host permissions. The extension does not request Chrome's cookies permission; it controls only tabs you approve through the Playwright Extension. On first use, choose the intended tab and approve the connection. The extension groups tabs by MCP client and only exposes tabs in that client's group.

If the extension is installed in several profiles, Playwright uses the most recently used profile that has the extension. To pin one, add `--profile-dir-name "Profile 1"` to the MCP server arguments; use the directory name shown on `chrome://version`, not Chrome's displayed profile label. The extension connection token is profile-specific and should remain in the extension; Pi does not need it.

## Use the agent

After changing MCP configuration, restart Pi or run `/reload`. Ask Pi to delegate a browser task to `playwright-browser`, or run:

```text
/run playwright-browser "Inspect the selected GitLab issue and report the reply control without submitting anything."
```

The agent works from fresh context, locates controls through accessible names and snapshot refs, verifies each result in the page, and returns its findings. It submits external content only when the delegated task explicitly requests that action.
