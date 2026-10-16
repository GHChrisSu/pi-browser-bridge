# Browser workflow comparison and scope

This comparison separates features explicitly described by vendor documentation from implementation details in the locally installed Codex browser plugin. It is not a claim that Pi Bridge reproduces either product's model, UI, or safety service.

## Third-party Chrome Bridge for Claude Code

The separately installed `chrome-bridge-mcp` package is the open-source project [frsorrentino/chrome-bridge](https://github.com/frsorrentino/chrome-bridge), licensed under MIT. Its extension and MCP server source are available in that repository; the installed copy was under `~/.pi/agent/mcp-servers/chrome-bridge-mcp/node_modules/chrome-bridge-mcp`. Its 66-tool suite is the capability reference for Pi Bridge's browser debugging, network rules, audits, visual comparisons, clipboard operations, and window management.

Pi Bridge keeps its own profile-routed broker and extension. This parity pass exposes all 66 upstream top-level tool names, plus Pi-specific profile, accessibility, and download tools. Optional high-risk permissions are off by default and Pi confirms sensitive operations. Some detailed behaviors use bounded equivalents: network stub/record/replay and production-vs-staging visual comparisons are not yet implemented. Lighthouse and heap snapshots run in a fresh unauthenticated headless Chrome profile, not the selected signed-in tab.

## Claude in Chrome

Anthropic's product page describes the Chrome tab in front of the user, a named Claude tab group that can contain additional dragged-in tabs, a side-panel experience, background-running workflows, and use from Claude Cowork and Claude Code. Its safety documentation describes configurable approval modes and checks on page content and proposed actions. It also warns that screenshots can include sensitive content visible on the page.

Pi Bridge adopts only the browser-organization idea: named Pi Bridge groups can contain task tabs, and creating those tabs does not activate them. It does not claim to provide Claude's side panel, session sync, approval UI, safety classifiers, or background task service.

## OpenAI Codex browser plugin

The OpenAI-bundled Chrome plugin installed locally for this development environment documents:

- `tabs.content()` loading URLs in temporary background tabs and extracting content without changing the selected tab;
- browser tab listing and explicit claiming of user tabs;
- named tab-group management;
- background browser visibility by default;
- turn-scoped cleanup of agent-created tabs, with explicit keep-open marks for deliverables or handoffs.

Pi Bridge now implements background tab/workspace organization, profile routing, page-asset inventory, local-path downloads, and local file upload through a confirmed Chrome file-input operation. It does not claim Codex's external tab ownership model, arbitrary page-asset bundling, turn-scoped tab cleanup, or its browser execution backend.

## Focus and screenshots

Chrome can run DOM scripting in inactive tabs, so read and interaction tools can target a `tab_id` without selecting that tab. `chrome.tabs.captureVisibleTab`, however, captures the visible viewport of a window, not an arbitrary inactive tab. Pi Bridge checks that the requested tab is the active tab in its window and returns an error otherwise. It never activates a tab merely to take a screenshot.

## Boundaries

Pi Bridge keeps page scripts and cookie/storage access disabled by default. It exposes them only after optional permissions are enabled, with a Pi confirmation per script, storage, or authenticated-request operation. `execute_js` runs user-supplied code in the page's MAIN world; cookie-backed requests send profile cookies only to the requested origin and reject redirects. The bridge does not expose arbitrary CDP forwarding. Cookie and history access is not included in the default toolset. It also requests `downloads` and a narrowly used `debugger` permission for fixed accessibility and file-transfer operations. Site behavior may still require a trusted physical gesture; synthetic DOM clicks in background tabs are not guaranteed to work.

## Sources

- Anthropic, Claude in Chrome: <https://claude.com/chrome>
- Anthropic, Claude in Chrome generally available: <https://claude.com/resources/articles/claude-in-chrome-generally-available>
- Anthropic, use Claude in Chrome safely: <https://support.claude.com/en/articles/12902428-using-claude-for-chrome-safely>
- Anthropic, Claude in Chrome permissions: <https://support.claude.com/en/articles/12902446-claude-for-chrome-permissions-guide>
- OpenAI Chrome extension API reference for `Tabs.content()` and `BrowserUser.openTabs()`: captured in the OpenAI-bundled Chrome plugin installed locally during this investigation.
- Chrome Extensions, Tabs API: <https://developer.chrome.com/docs/extensions/reference/api/tabs>
- Chrome Extensions, Tab Groups API: <https://developer.chrome.com/docs/extensions/reference/api/tabGroups>
