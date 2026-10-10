# Browser capability matrix

Pi Bridge covers common HTTP/HTTPS website workflows. It is a Chrome extension plus a per-agent-directory shared broker and per-session MCP adapters, not a general remote-control API for every browser surface.

## Available

| Task | How it works |
|---|---|
| Connect Chrome profiles | Each profile creates a random local ID automatically. Multiple Pi MCP sessions can share the broker; `list_profiles` reports all connected profiles, and browser tools route by `profile_id`. A custom display label is optional. |
| Inspect pages | Read visible body text, page title and URL; inspect form metadata without reading values; list visible links, buttons, and form controls. |
| Navigate and organize | Open HTTP/HTTPS URLs, create background tabs, create Pi Bridge tab groups, and read up to five URLs in temporary background tabs. |
| Interact with page DOM | Click a CSS-selected element, fill ordinary supported form controls, type in ordinary inputs/textareas/contenteditable elements, press common keys, scroll, and wait for text or a selector. Every operation can target a background tab with `tab_id`. |
| Accessibility and real clicks | `get_accessibility_tree` returns Chrome's full paginated accessibility tree; `get_visible_dom` filters it to interactive nodes with snapshot-scoped IDs. `click_dom_node` revalidates a node and dispatches a real pointer event. `get_by_role`, `fill_by_role`, and `click_by_role` provide Playwright-style role/name locators backed by Chrome's accessibility tree and fixed debugger input commands; Pi Bridge does not bundle Playwright or expose arbitrary page evaluation. Form values are omitted from inspection. |
| Inspect page assets | `list_page_assets` inventories visible images, media, and download links with selectors; `download_media` can save selected HTTP(S), `blob:`, or `data:` assets. In-page assets use Chrome's Downloads API and obey the same `max_bytes` limit (50 MiB by default, 100 MiB maximum). |
| Download a file | `download_media` starts a selected page asset/control download and waits for Chrome; `download_url` fetches an explicitly requested HTTP/HTTPS URL. Both return the local path, MIME type, size, and Chrome danger state. Downloads default to a 50 MiB limit, capped at 100 MiB. Clients may overlap an explicitly requested direct download with unrelated tab setup, reads, or role actions. |
| Upload a local file | `upload_file` sets one local file up to 50 MiB on a selected `input[type=file]`. Pi requires action-time confirmation displaying the canonical path, size, profile, tab, and target website. After confirmation and completion of role/debugger actions on that tab, upload setup may overlap with an independent requested `download_url`. Keep page-control and blob downloads serialized within one profile; the website receives the file contents directly from Chrome. |
| Capture a page | Capture the currently visible viewport of the active tab as JPEG. |

## Limits

- It cannot script browser-internal pages (`chrome://…`), extension pages, or the Chrome Web Store.
- It cannot read or modify cookies, website local/session storage, browser history, or arbitrary browser profile files.
- The `downloads` permission lets Pi Bridge wait for requested downloads and return their local path. Direct HTTP/HTTPS downloads use Chrome's download API, which may send that Chrome profile's cookies for the target host. Downloads are never opened or executed automatically.
- The `debugger` permission attaches only for fixed accessibility-tree reads, node-validated pointer clicks, ordinary accessible textbox fills, and confirmed `upload_file` operations. Pi Bridge exposes no arbitrary DevTools command or page-JavaScript evaluation tool.
- Pi asks for action-time confirmation before uploads; uploads are blocked when Pi has no confirmation UI. Other MCP clients need their own upload approval policy.
- File uploads transmit the selected file to the target website. Chrome or a site-specific flow may still refuse access or submission.
- Page inspection runs in the top document. Cross-origin iframe controls and closed shadow roots are not traversed.
- CSS-based page clicks, text entry, and keyboard tools use DOM-synthetic events. The accessibility-node click uses Chrome's debugger API to dispatch a browser-level pointer event; `fill_by_role` uses Chrome input events. Sites can still reject actions that require additional user gesture context.
- Background tabs support DOM operations but not visible screenshots. Pi Bridge refuses a background screenshot instead of switching focus.
- Password, hidden, file, and token-like fields are refused. Visible page text and screenshots can still expose sensitive content if it appears on screen.
- A Chrome profile identity is a random extension-local ID, not the Chrome menu's display name. Chrome's public extension API does not expose that display name. Pi Bridge generates a short default label; changing it in the popup is optional.

When more than one profile is connected, omit `profile_id` only if the broker reports one connected profile. With multiple profiles, Pi Bridge fails ambiguous calls instead of choosing a browser silently. Read operations can run concurrently; page mutations are serialized per profile, and downloads are serialized by Chrome profile.
