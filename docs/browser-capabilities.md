# Browser capability matrix

Pi Bridge covers common HTTP/HTTPS website workflows. It is a Chrome extension plus a local Pi MCP server, not a general remote-control API for every browser surface.

## Available

| Task | How it works |
|---|---|
| Connect Chrome profiles | Each profile creates a random local ID automatically. `list_profiles` reports connected profiles; browser tools route by `profile_id`. A custom display label is optional. |
| Inspect pages | Read visible body text, page title and URL; inspect form metadata without reading values; list visible links, buttons, and form controls. |
| Navigate and organize | Open HTTP/HTTPS URLs, create background tabs, create Pi Bridge tab groups, and read up to five URLs in temporary background tabs. |
| Interact with page DOM | Click a CSS-selected element, fill ordinary supported form controls, type in ordinary inputs/textareas/contenteditable elements, press common keys, scroll, and wait for text or a selector. Every operation can target a background tab with `tab_id`. |
| Capture a page | Capture the currently visible viewport of the active tab as JPEG. |

## Limits

- It cannot script browser-internal pages (`chrome://…`), extension pages, or the Chrome Web Store.
- It cannot read or modify cookies, website local/session storage, browser history, or arbitrary browser profile files.
- It does not evaluate model-supplied JavaScript, inspect browser DevTools, upload local files, control downloads, or handle native browser dialogs.
- Page inspection runs in the top document. Cross-origin iframe controls and closed shadow roots are not traversed.
- Page clicks, text entry, and keyboard events are DOM-level synthetic events. Sites requiring a trusted physical gesture, drag-and-drop, or coordinate-based interaction may reject them or behave differently.
- Background tabs support DOM operations but not visible screenshots. Pi Bridge refuses a background screenshot instead of switching focus.
- Password, hidden, file, and token-like fields are refused. Visible page text and screenshots can still expose sensitive content if it appears on screen.
- A Chrome profile identity is a random extension-local ID, not the Chrome menu's display name. Chrome's public extension API does not expose that display name. Pi Bridge generates a short default label; changing it in the popup is optional.

When more than one profile is connected, omit `profile_id` only if the broker reports one connected profile. With multiple profiles, Pi Bridge fails ambiguous calls instead of choosing a browser silently.
