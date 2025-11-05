# Development Notes

This document captures the practical details you will want handy when revisiting the project on another machine or extending the codebase.

## Environment Setup

1. Clone the repository and install dependencies:
   ```bash
   git clone git@github.com:tuananht/external-host-gatekeeper.git
   cd external-host-gatekeeper
   npm install
   ```
2. Recommended tooling:
   - Node.js ≥ 18 (workflow uses Node 20)
   - Chrome 109+ for MV3 testing
   - `pnpm`/`yarn` not required; scripts assume npm
   - Optional: VS Code + ESLint or Prettier (no configs committed yet)

## Key npm Scripts

| Script          | Description                                      |
| --------------- | ------------------------------------------------ |
| `npm run build` | Cleans `dist/`, copies extension assets, and zips into `dist/chrome-extension.zip`.|
| `npm run clean` | Use `node scripts/build.js --clean` to drop `dist/` manually. |

Build output is intentionally excluded from git via `.gitignore`.

## Directory Guide

- `src/background/` — background service worker and helpers.
  - `service_worker.js`: Orchestrates request tracking, messaging, DNR sync, badge counts.
  - `storage.js`: Handles persistent site configuration (`allowed`, `blocked`, `pending`).
  - `sessionStore.js`: Maintains session-specific host cache using `chrome.storage.session`.
  - `ruleManager.js`: Maps config to DNR rules.
  - `requestTracker.js`: Tracks per-tab host observations in memory.
- `popup/` — MV3 popup UI (HTML/CSS/JS) with live host list and tri-state toggles.
- `options/` — global defaults page surfaced via the popup gear icon (mirrors popup UI for managing allow/block lists).
- `StorageService.defaultGlobalBlocked` seeds the first-run configuration with opinionated telemetry hosts (extend here for new defaults).
- `assets/icons/` — Shield artwork for extension icon (generated via Pillow script).
- `scripts/build.js` — Node build script packaging `manifest.json`, `src`, `popup`, and `assets`.
- `.github/workflows/build-extension.yml` — CI pipeline mirroring `npm run build`, uploading artifacts, and creating releases on `main`.
- `README.md` — High-level project overview and usage.

## Chrome Extension Behavior

- **Host Detection**: `webRequest.onBeforeRequest` listens to all URLs. Main-frame navigation resets per-tab caches and badge counts.
- **Badge Counts**: Count unique third-party hosts per tab; resets when tab host changes.
- **Persisted Decisions**: `allowed`, `blocked`, and `pending` arrays are stored per site in `chrome.storage.local`. Pending hosts are tracked to preserve “review later” state.
- **Session Cache**: `chrome.storage.session` keeps newly observed hosts available after popup closes.
- **Subdomains**: If user hasn’t decided, hosts matching `<main host>` or `*.main` default to allowed, but explicit blocks override.
- **Popup UI**: `popup/popup.js` builds tri-state “switch toggle” controls and live summary counts (blocked/pending/allowed).
- **Refresh on Save**: After saving decisions, the background script applies DNR rules and reloads the tab.

## Testing & Debugging Tips

1. **Load Unpacked**: `npm run build` → `chrome://extensions` → Load `dist/unpacked`.
2. **View Background Logs**: In `chrome://extensions`, click “service worker” under the extension.
3. **Inspect Storage**:
   ```js
   chrome.storage.local.get('siteHostConfig').then(console.log);
   chrome.storage.session.get('runtimeSiteHosts').then(console.log);
   ```
4. **Validate DNR Rules**:
   ```js
   chrome.declarativeNetRequest.getDynamicRules().then(console.log);
   ```

## Release Flow

1. Commit changes to `main`.
2. Push to GitHub: GitHub Actions builds, uploads `dist/chrome-extension.zip`, and (for main pushes) creates release `v<run_number>`.
3. Download the artifact or release zip for distribution.

## Future Enhancements (Ideas)

- Add unit tests (webextension polyfills) for storage/rule manager logic.
- Add options page to preview per-site rules outside popup context.
- Provide whitelist/blacklist import/export.
- Offer localization capability — move strings out of JS/HTML.
- Add integration test script using Puppeteer to simulate network requests.

Keep this file updated whenever you introduce new conventions, scripts, or dependencies. It exists solely to make returning to the project frictionless.
