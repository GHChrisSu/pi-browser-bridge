# Privacy policy

Pi Bridge is an independent, local Chrome browser bridge for the Pi coding agent.

## Data processed

When you ask Pi to inspect or operate a page, the extension can read the active tab's visible page text, page title and URL, accessible labels, and selected control metadata. You may explicitly ask Pi to list tabs in the last-focused window or organize its own tabs in named Pi Bridge workspace groups. It may capture the visible tab as an image. The `read_urls` tool can open up to five requested HTTP/HTTPS URLs in temporary background tabs, return visible page text, and close those tabs after the read. These tabs are not saved as browsing history by the extension, though Chrome itself may record visited URLs according to browser settings. Visible page text and screenshots can include personal or confidential information, including a verification code if it is visibly displayed.

Each Chrome profile has a random profile ID and a display name you can set in the extension popup. The extension stores these in that profile's local extension storage, and sends them to the local Pi process so browser commands can be routed to the intended profile. If Pi lists profiles, the IDs and names may be included in the model context.

The extension does not read website cookies, a website's local or session storage, browser history, or values from password and hidden inputs. It uses Chrome's local extension storage only for the profile ID and display name described above. Password and hidden inputs are excluded from interactive-element inspection. Form-filling and typing operations refuse password, hidden, file, and token-like fields. These controls do not semantically redact sensitive content that is visibly displayed elsewhere on the page.

The extension sends browser command results to the Pi process on the same computer through a loopback WebSocket. Pi may include user-requested page content in requests to the model provider configured by the user. Review that provider's privacy, retention, and training settings. Page content can contain personal or confidential information; use trusted Pi packages and model providers.

## Data collection and sharing

The extension does not send page or profile data to the project maintainer, an analytics service, or a remote bridge server. It does not include analytics or advertising SDKs. It does not persist page text, screenshots, or a tab history. The profile ID and user-chosen display name are stored locally in Chrome extension storage; profile labels and page data are sent only to the local Pi process, which may forward user-requested context to the configured model provider.

## Permissions

- **Host access:** grants access to HTTP and HTTPS pages so Pi can work across sites without a separate permission step for every domain. Chrome displays this broad permission; users can narrow site access in the extension's Details page. The extension inspects a page only when Pi requests a browser operation. Chrome itself blocks extensions from scripting some browser-internal and Web Store pages.
- **Tabs:** lists the last-focused window's tabs, identifies a selected tab, creates background and temporary tabs, and captures the visible tab when requested. It does not access browser history.
- **Scripting:** runs fixed, packaged DOM inspection and interaction functions; model-supplied JavaScript is not executed.
- **Tab groups:** creates and updates named Pi Bridge groups for background work; existing user tabs are not moved into them.
- **Storage:** stores a random profile ID and user-chosen display name in local extension storage for this Chrome profile. The extension sends them to the local Pi server; Pi may include them in model context when a user requests the profile list.
- **Alarms:** retries the local Pi connection when Pi starts after Chrome.

The Pi package pins the first extension ID in a mode-`0600` file under the Pi agent directory. Each Chrome profile maintains its own profile identity locally.

## Contact

Report privacy or security concerns through the private vulnerability reporting feature on the GitHub repository.
