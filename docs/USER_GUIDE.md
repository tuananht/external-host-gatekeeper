# User Guide — External Host Gatekeeper

This guide explains how to install the extension, use the popup to review hosts on a site, manage global defaults, disable/enable per‑site, and troubleshoot common issues.

## Install & Setup

1. Install Node.js 18+ and npm.
2. In the repository root, install dependencies:
   
   ```bash
   npm install
   ```

3. Build the extension:
   
   ```bash
   npm run build
   ```

4. In Chrome, open `chrome://extensions`, enable Developer mode, click “Load unpacked”, and select `dist/unpacked`.

## Using the Popup (Per‑Site Review)

Open the extension popup while viewing a site.

- Site label: shows the current site host.
- List of observed hosts: updates live as the page loads new third‑party hosts.
- Source column:
  - New — no decisions exist yet
  - Global — uses an explicit global decision
  - Site — has a site‑specific decision (or you set one in the popup)
- Tri‑state toggle per host:
  - 🚫 Block
  - 🍪 Review later (Pending)
  - ✅ Allow
- Search: filter visible hosts by substring.
- Summary bar: visual counts of Blocked/Review/Allowed.
- Apply & Refresh: saves decisions for this site and reloads the tab to apply changes.

Status resolution:

- If a host has a site‑specific decision, that decision wins over global.
- Otherwise, the global decision applies.
- If neither is set, the host is pending.
- Hosts matching the main site (or its subdomains) default to allowed unless explicitly blocked.

## Global Defaults (All Sites)

Click the gear (⚙️) icon in the popup to open the options page, or navigate to it via the extension’s options.

- Add host: type a hostname (e.g., `tracker.com`) and add it as blocked (you can change the status afterward).
- Toggle status: set each host to Block, Review later, or Allow globally.
- Save changes: persists the global configuration and updates the background rules. Tabs will apply new rules on the next request or reload.

Tip: Some common telemetry domains are blocked by default on first run. You can remove or change them at any time.

## Disable/Enable for a Site

From the popup:

- Click “Disable for this site” to suspend all blocking and per‑site behavior for the current site.
- The page reloads; the popup shows a disabled message and no hosts.
- Click “Enable for this site” to restore normal behavior; the page reloads again.

What happens under the hood:

- Global rules automatically exclude the disabled site via DNR `excludedInitiatorDomains`.
- Re‑enabling removes the exclusion and re‑applies site‑specific rules.

## Troubleshooting

- I don’t see any hosts in the popup
  - Ensure you opened the popup while on an actual site (not `chrome://` pages).
  - Reload the page; the extension observes hosts as the page loads.
  - Check that the site is not disabled.

- A host I blocked still loads
  - Click “Apply & Refresh” to ensure the new DNR rules are applied to the tab.
  - Verify via DevTools → Network that requests are marked as blocked.
  - If you globally allow a host, a site‑specific block is needed to block it on this site.

- Global block doesn’t apply on a site
  - Check whether that site is disabled; disabled sites are excluded from global rules.
  - If the host is allowed for the site specifically, it overrides the global block.

- How can I inspect current rules or storage?
  - Open `chrome://extensions`, click the service worker link under the extension.
  - In the console:

    ```js
    chrome.declarativeNetRequest.getDynamicRules().then(console.log);
    chrome.storage.local.get(['siteHostConfig','globalHostConfig','disabledSites']).then(console.log);
    chrome.storage.session.get('runtimeSiteHosts').then(console.log);
    ```

  - See `TESTING-GLOBAL-RULES.md` and `test-disable-site.md` for step‑by‑step validation.

## FAQ

- Does this replace ad blockers?
  - No. It focuses on host‑level visibility and control; it can complement an ad blocker but is not a filter‑list engine.

- What data does it store?
  - Only hostnames and decisions, plus session hosts for convenience. No request payloads or PII are stored.

- Will it work in other Chromium browsers?
  - It targets MV3 Chrome. Other Chromium browsers may work but are not officially supported.

