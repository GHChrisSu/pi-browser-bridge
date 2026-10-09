# Privacy policy

Pi Bridge is an independent, local Chrome browser bridge for the Pi coding agent.

## Data processed

When you ask Pi to inspect or operate a page, the extension can read the active tab's visible page text, page URL, accessible labels, and selected control metadata. It may capture the visible tab as an image. Visible page text and screenshots can include personal or confidential information, including a verification code if it is visibly displayed.

The extension does not read cookies, local or session storage, browser history, or values from password and hidden inputs. Password and hidden inputs are excluded from interactive-element inspection. Form-filling and typing operations refuse password, hidden, file, and token-like fields. These controls do not semantically redact sensitive content that is visibly displayed elsewhere on the page.

The extension sends browser command results to the Pi process on the same computer through a loopback WebSocket. Pi may include user-requested page content in requests to the model provider configured by the user. Review that provider's privacy, retention, and training settings. Page content can contain personal or confidential information; use trusted Pi packages and model providers.

## Data collection and sharing

The extension does not send browsing data to the project maintainer, an analytics service, or a remote bridge server. It does not include analytics or advertising SDKs. The extension does not persist page text or screenshots. User-requested page data remains on the user's computer until Pi forwards it to the configured model provider; the provider's own data handling then applies.

## Permissions

- **Host access:** grants access to HTTP and HTTPS pages so Pi can work across sites without a separate permission step for every domain. Chrome displays this broad permission; users can narrow site access in the extension's Details page. The extension inspects a page only when Pi requests a browser operation. Chrome itself blocks extensions from scripting some browser-internal and Web Store pages.
- **Tabs:** identifies the active tab and captures its screenshot.
- **Scripting:** runs fixed, packaged DOM inspection and interaction functions; model-supplied JavaScript is not executed.
- **Alarms:** retries the local Pi connection when Pi starts after Chrome.

The Pi package pins the first extension ID in a mode-`0600` file under the Pi agent directory so reconnects work without a user-supplied token.

## Contact

Report privacy or security concerns through the private vulnerability reporting feature on the GitHub repository.
