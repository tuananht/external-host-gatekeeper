# External Host Gatekeeper — Privacy Policy

Effective date: November 8, 2025

This privacy policy describes how the External Host Gatekeeper Chrome extension ("the extension") handles data. The extension is designed to help you review and control third‑party hosts that load alongside the sites you visit.

## Summary

- No personal data is collected, transmitted, or sold.
- All processing happens locally in your browser.
- Decisions you make (allow/block/review) are stored only on your device using Chrome’s extension storage.

## Data Handling Details

The extension observes network requests to identify the hostnames (e.g., `cdn.example.com`) contacted by the current site. It does not read or modify page content.

The following data is processed locally to provide core functionality:

- Active site hostname for the current tab.
- Hostnames of third‑party requests made by that site.
- Your per‑site decisions to allow, block, or review specific hostnames.

Storage:

- Per‑site decisions are saved in `chrome.storage.local` so they persist across sessions.
- Recently observed hostnames may be cached in `chrome.storage.session` for the current browser session.

Transmission:

- No data is sent to external servers or third parties by the extension. There is no analytics, telemetry, or remote configuration.

## Permissions Use

- `webRequest` (without blocking): used only to observe requests so the popup can list third‑party hostnames.
- `declarativeNetRequest`: used to enforce your explicit block decisions via dynamic rules.
- `tabs`: used to determine the active tab, derive the current site hostname, update the badge, and refresh the tab after applying changes.
- `storage`: used to save your per‑site allow/block/review settings locally.
- Host permissions (`<all_urls>`): required to observe and manage third‑party requests across the sites you visit.

## Data Retention and Control

All data stays in your browser’s extension storage. Removing the extension will remove its stored data. You can also clear data by resetting Chrome’s extension storage for this extension.

## Contact

If you have questions about this policy or the extension, please contact the developer.

