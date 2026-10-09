# Privacy policy

Pi Browser Bridge is an independent, local browser automation extension for Pi.

## Data processed

When you ask Pi to inspect or operate a page, the extension reads the active tab's visible page text, accessible labels, and selected control metadata. It may capture the visible tab as an image. The extension does not read cookies, local or session storage, passwords, authentication codes, or hidden form values.

The extension sends browser command results to the Pi process on the same computer through a loopback WebSocket. Pi may include those results in requests to the model provider configured by the user. Page content can contain personal or confidential information; use trusted Pi packages and model providers.

## Data collection and sharing

The extension does not send browsing data to the project maintainer, an analytics service, or a remote bridge server. It does not include analytics or advertising SDKs. Page data stays on the user's computer until Pi forwards it to the configured model provider.

## Permissions

- **Host access:** allows Pi to operate the websites the user chooses.
- **Tabs:** identifies the active tab and captures its screenshot.
- **Scripting:** runs fixed, packaged DOM inspection and interaction functions; model-supplied JavaScript is not executed.

The Pi package pins the first extension ID in a mode-`0600` file under the Pi agent directory so reconnects work without a user-supplied token.

## Contact

Report privacy or security concerns through the private vulnerability reporting feature on the GitHub repository.
