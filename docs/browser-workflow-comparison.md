# Browser workflow comparison and scope

This comparison separates features explicitly described by vendor documentation from implementation details in the locally installed Codex browser plugin. It is not a claim that Pi Bridge reproduces either product's model, UI, or safety service.

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

Pi Bridge now implements the background tab and workspace ideas, plus the same kind of explicit browser-instance routing: every Chrome profile stores a separate stable ID, `list_profiles` returns IDs and user-chosen names, and every browser tool can target `profile_id`. When multiple profiles are online, the broker rejects calls that omit the ID. It does not claim external tabs automatically or auto-close regular workspace tabs at the end of a Pi turn.

## Focus and screenshots

Chrome can run DOM scripting in inactive tabs, so read and interaction tools can target a `tab_id` without selecting that tab. `chrome.tabs.captureVisibleTab`, however, captures the visible viewport of a window, not an arbitrary inactive tab. Pi Bridge checks that the requested tab is the active tab in its window and returns an error otherwise. It never activates a tab merely to take a screenshot.

## Boundaries

Pi Bridge remains a Chrome extension plus local Pi MCP server. Chrome blocks extensions from scripting browser-internal pages and Chrome Web Store pages. The project does not request `debugger`, cookie, history, or arbitrary code-execution access. Site behavior may also require an actual user gesture; DOM-driven clicks in background tabs are not guaranteed to satisfy that requirement.

## Sources

- Anthropic, Claude in Chrome: <https://claude.com/chrome>
- Anthropic, Claude in Chrome generally available: <https://claude.com/resources/articles/claude-in-chrome-generally-available>
- Anthropic, use Claude in Chrome safely: <https://support.claude.com/en/articles/12902428-using-claude-for-chrome-safely>
- Anthropic, Claude in Chrome permissions: <https://support.claude.com/en/articles/12902446-claude-for-chrome-permissions-guide>
- OpenAI Chrome extension API reference for `Tabs.content()` and `BrowserUser.openTabs()`: captured in the OpenAI-bundled Chrome plugin installed locally during this investigation.
- Chrome Extensions, Tabs API: <https://developer.chrome.com/docs/extensions/reference/api/tabs>
- Chrome Extensions, Tab Groups API: <https://developer.chrome.com/docs/extensions/reference/api/tabGroups>
