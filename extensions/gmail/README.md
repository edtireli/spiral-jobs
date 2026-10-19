# Gmail companion

Google can reject sign-in in browsers launched by automation. This companion uses your existing sign-in in regular Chrome. It does not disable Google's protections or read browser cookies.

1. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select this folder. The app shows its installed copy's folder in Settings → Gmail.
2. In Spiral Jobs, choose **Settings → Gmail → Connect Gmail**. Copy the connection code into the companion page opened by its toolbar icon.
3. Leave the companion page open while applying. The app checks your account on every lookup and opens a separate Gmail search tab, leaving your normal mailbox tab untouched.

The extension needs access to Gmail's page and the loopback address `127.0.0.1`. It receives a random pairing token with access only to the app's pending email lookup, not to jobs, documents, settings or submission endpoints. The token is stored in extension-local storage restricted to trusted extension contexts. Disconnecting in the app revokes it. If the app's port changes, pair again with its newly displayed address.

No inbox is read while idle. Each lookup is scoped to the application recipient, provider, request time and (for receipts) employer. Matching messages are returned only to the local app and are not persisted as raw mail. Codes require a current, unambiguous trusted-provider message. Receipt reconciliation additionally requires the exact role and employer and never resubmits a form. The extension has no mail-sending function.

The public source contains no credentials or connection codes. This is an unpacked development extension, not a Chrome Web Store release. Installation and access are optional and require your approval.
