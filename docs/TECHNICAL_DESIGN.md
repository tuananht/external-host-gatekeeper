# Technical Design — External Host Gatekeeper

This document explains the architecture, data model, messaging, and rule synchronization strategy used by External Host Gatekeeper.

## Overview

- MV3 background service worker orchestrates request observation, storage, and DNR rules.
- Popup and Options UIs communicate via `chrome.runtime.sendMessage`.
- DNR dynamic rules enforce both global and site‑specific decisions.

Key modules:

- `src/background/service_worker.js` — lifecycle, listeners, messaging, and coordination
- `src/background/storage.js` — persistent storage (site configs, global defaults, disabled sites)
- `src/background/ruleManager.js` — computes and syncs DNR rules; manages rule IDs and exclusions
- `src/background/requestTracker.js` — in‑memory per‑tab main host and observed hosts
- `src/background/sessionStore.js` — session‑scoped cache of observed hosts for resilience
- `popup/*` — per‑site review UI
- `options/*` — global defaults UI

## Data Model

Storage keys in `chrome.storage.local` and `chrome.storage.session`:

- `siteHostConfig` (local)
  - Shape per site host:
    - `allowedHosts: string[]`
    - `blockedHosts: { [host: string]: ruleId: number }` (site‑specific block rules)
    - `pendingHosts: string[]` (tracked for continuity of review)

- `globalHostConfig` (local)
  - `allowedHosts: string[]`
  - `blockedHosts: string[]`
  - `pendingHosts: string[]`
  - On first run, seeds with opinionated defaults (e.g., `www.googletagmanager.com`, `connect.facebook.net`).

- `disabledSites` (local)
  - `string[]` of normalized site hosts where the extension is disabled.

- `runtimeSiteHosts` (session)
  - `{ [siteHost: string]: string[] }` of observed third‑party hosts for the session.

Normalization: all hosts are lowercased and trimmed prior to storage or comparison.

## Request Observation

- `chrome.webRequest.onBeforeRequest` observes network requests for `<all_urls>`.
- Main‑frame navigations:
  - Update the tab’s main host and reset observed hosts.
  - If the site is disabled, clear badge and stop processing.
- Subrequests:
  - Derive main host from tracked tab context or initiator/document URL.
  - Ignore first‑party requests; only track third‑party hosts.
  - Add host to in‑memory tracker and session store; update badge; broadcast to popup.

## Effective Status Resolution

Given a candidate host on a site:

1. If the site configuration explicitly `blocked` or `allowed` the host, use it.
2. Else, if a global configuration exists for the host, use it.
3. Else, if host equals the main site or a subdomain, treat as `allowed` by default.
4. Else, treat as `pending` (review later).

## DNR Rules Strategy

Two categories of dynamic rules:

- Site‑specific rules (ID < 2,000,000)
  - Block rules: `{ initiatorDomains: [site], requestDomains: [blockedHost], action: block }`
  - Allow overrides: when a host is globally blocked but locally allowed, add `{ action: allow }` with the same initiator/request pairing.

- Global rules (ID ≥ 2,000,000)
  - Block rules for each globally blocked host; exclude disabled sites via `excludedInitiatorDomains`.

Rule IDs:

- Deterministic hashing to ensure stable IDs across sessions:
  - `ensureRuleId(siteHost, blockedHost)` → 1..1,000,000
  - `ensureGlobalRuleId(blockedHost, offset=2,000,000)` → 2,000,001..

Sync algorithm:

- Site sync:
  - Compute desired rules for the site (blocks + allow‑overrides)
  - Remove all existing rules for the site; add the desired rules set

- Global sync:
  - Compute desired global rules with current disabled sites as exclusions
  - Detect changed rules and mark their IDs for removal
  - Call `updateDynamicRules` once with `removeRuleIds` and `addRules`
  - Verify and log current rules after update

Disabled sites:

- When a site is disabled:
  - Remove site‑specific rules
  - Resync global rules to add the site to `excludedInitiatorDomains`
- When re‑enabled:
  - Resync site‑specific rules and global rules to remove exclusions

## Messaging Protocol

Message types and payloads exchanged with the background service worker:

- `GET_SITE_STATE` → `{ tabId: number }`
  - Response: `{ mainHost: string | null, hosts: Array<{ host, status, globalStatus, localStatus?, hasExplicitGlobalConfig? }>, globalStatuses: { [host]: status }, hasExplicitGlobalConfig: { [host]: boolean }, disabled: boolean }`

- `SAVE_SITE_DECISIONS` → `{ tabId: number, mainHost: string, decisions: Array<{ host: string, status: 'blocked'|'pending'|'allowed' }> }`
  - Response: `{ success: true }` (tab reload triggered)

- `GET_GLOBAL_CONFIG` → void
  - Response: `{ config: { allowedHosts: string[], blockedHosts: string[], pendingHosts: string[] } }`

- `SAVE_GLOBAL_DECISIONS` → `{ decisions: Array<{ host: string, status: 'blocked'|'pending'|'allowed' }> }`
  - Response: `{ success: true, config }`

- `ADD_GLOBAL_HOST` → `{ host: string, status: 'blocked'|'pending'|'allowed' }`
  - Response: `{ success: true, config }`

- `DISABLE_SITE` / `ENABLE_SITE` → `{ siteHost: string }`
  - Response: `{ success: true }`

- Broadcasts:
  - `HOSTS_OBSERVED` → `{ tabId, host }`
  - `GLOBAL_CONFIG_UPDATED` → `{ config }`
  - `SITE_DISABLED_CHANGED` → `{ siteHost, disabled: boolean }`

## Initialization & Lifecycle

On extension start:

1. Configure badge color.
2. Hydrate session store from `chrome.storage.session`.
3. Load global config and build status indices.
4. Load disabled sites.
5. Initialize rule manager and sync global rules.
6. Attach tab, webRequest, and message listeners.

On tab updates/activations: ensure tab context and update badge.

On popup open: resolve active tab, fetch site state, render UI.

## Error Handling & Logging

- Background logs significant transitions (sync start/end, rules added/removed, disabled/enable flows).
- Popup and Options show status messages for save/load and validation errors.
- Use the service worker console from `chrome://extensions` for debugging.

## Security & Privacy

- Required permissions: `storage`, `tabs`, `webRequest`, `declarativeNetRequest`, `<all_urls>` host permissions.
- Only hostnames are stored; no request bodies or headers are persisted.
- DNR enforces decisions natively in Chrome; the extension does not proxy traffic.

## Limitations & Edge Cases

- MV3 service worker restarts can occur; session store mitigates context loss.
- DNR rule limits apply; extremely large host sets may need paging or pruning.
- Some requests may appear in DevTools as blocked entries; this is expected behavior for DNR.

## Build & Distribution

- `npm run build` packages to `dist/unpacked` and `dist/external-host-gatekeeper.zip`.
- See `CONTRIBUTING.md` for CI workflow and tips, plus `TESTING-GLOBAL-RULES.md` and `test-disable-site.md` for validation guides.

