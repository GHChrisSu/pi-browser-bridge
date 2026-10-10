# Delegate Chrome work to a Pi Browser agent

Pi Bridge includes a `pi-browser-operator` subagent for multi-step browser tasks. It runs through Pi Subagents and uses Pi Bridge's own Chrome extension and shared local broker. Each Pi session has its own MCP adapter, and multiple sessions using the same Pi agent directory share the browser connections. Its tools include full accessibility snapshots, snapshot-scoped node clicks, and Playwright-style `get_by_role` / `fill_by_role` / `click_by_role` locators. It does not need Microsoft's separate Playwright Chrome Extension or a remote debugging port.

## Install

Install Pi Subagents and Pi Browser Bridge into the existing Pi installation:

```bash
pi install npm:pi-subagents
pi install git:github.com/GHChrisSu/pi-browser-bridge
```

Install the Pi package into an existing Pi CLI and install the Pi Bridge Chrome extension separately in every profile you want to control. Chrome shows the extension's requested permissions. Pi Bridge does not request Chrome's cookies permission. Pi sessions using the same `~/.pi/agent` directory share one local broker; each session retains its own MCP adapter and upload-confirmation flow.

After installation, restart Pi or run `/reload`. The `pi-browser-operator` agent is packaged with Pi Bridge and appears in Pi Subagents. It runs as a background child so Pi can load the extension-registered MCP server into the child session.

## Use

Ask Pi to delegate the task to `pi-browser-operator`, or run:

```text
/run pi-browser-operator "Inspect the selected GitLab issue, find the reply control, and report its accessible name. Do not submit anything."
```

The agent starts by listing connected profiles and tabs. With multiple profiles, it routes all calls using the selected `profile_id`. It uses accessibility snapshots or role/name locators, rechecks page state after interactions, and reports evidence. It submits a comment or other external change only when that task explicitly requests it.

The browser interface is the Pi Browser Bridge extension already required for Pi browser tools. The optional agent does not install another Chrome extension or read cookies directly. The page operates inside Chrome's existing session, so ordinary website access remains subject to the same site permissions as Pi Bridge.
