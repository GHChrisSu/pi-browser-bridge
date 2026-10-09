# Privacy policy

Pi Bridge is an independent local Chrome browser bridge for the Pi coding agent.

## Data processed

When you ask Pi to inspect or operate a page, the extension can read visible page text, the page title and URL, accessible labels, selected form metadata, tab information, screenshots, and Pi Bridge workspace names. Visible page text and screenshots can include personal or confidential information, including a verification code displayed on screen.

Each Chrome profile has a random profile ID and an optional display label stored in that profile's local Chrome extension storage. The extension sends these values to the local Pi process so commands can be routed to the intended profile. They may enter the model context when Pi lists connected profiles.

When you ask Pi to download a file, the extension waits for Chrome's download to finish and returns its local path and basic metadata to Pi. Direct HTTP/HTTPS downloads use Chrome's Downloads API; Chrome may send cookies for that download URL's host. Downloads are limited in size and are not opened or executed automatically. Pi can read the returned file if you ask it to inspect or integrate it, and may then include its contents in a request to your configured model provider.

When you request an upload, Pi displays an action-time confirmation with the canonical file path, file size, Chrome profile, tab, and website origin. Uploads are limited to one regular file no larger than 50 MiB. After confirmation, Chrome sets that file on the selected page's `input[type=file]` and sends the file contents directly to that website. Pi Bridge and its maintainers do not receive a copy of the uploaded file contents.

## Data collection and sharing

The extension does not send page or profile data to the project maintainer, an analytics service, or a remote bridge server. It includes no analytics or advertising SDKs. It does not persist page text, screenshots, or a browsing history. Profile IDs and optional labels remain in Chrome extension storage and are sent only to the local Pi process. User-requested page data and download metadata go to local Pi and may be forwarded to the model provider configured by the user. File-upload contents travel directly from Chrome to the website named in the confirmation.

## Permissions

- **Host access:** grants access to HTTP and HTTPS pages so Pi can work across sites without a separate permission step for every domain. The extension inspects a page only when Pi requests an operation. Chrome restricts browser-internal pages and the Chrome Web Store.
- **Tabs:** identifies tabs in the last-focused window, creates background or temporary tabs, and captures the visible tab when requested. It does not access browsing history.
- **Scripting:** runs fixed packaged DOM inspection and interaction functions. It does not evaluate model-supplied JavaScript.
- **Tab groups:** creates and updates named Pi Bridge groups for background work; existing tabs are not moved into them.
- **Storage:** stores a random profile ID and optional display label locally for each Chrome profile.
- **Downloads:** waits for requested downloads and returns their path and metadata. The extension does not enumerate or erase download history. Chrome may send cookies for the destination host when the Downloads API is used.
- **Debugger:** attaches briefly to the selected tab for a confirmed file upload, checks the target page and file input, sets the specified file, and detaches. Pi Bridge exposes no arbitrary DevTools Protocol tool.
- **Alarms:** retries the local Pi connection when Pi starts after Chrome.

The Pi package pins the extension ID in a mode-`0600` file under the Pi agent directory. Each Chrome profile has a separate local profile identity.

## Contact

Report privacy or security concerns through the private vulnerability reporting feature on the GitHub repository.
