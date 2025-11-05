# Product Spec — External Host Gatekeeper

This document defines the product goals, scope, user flows, and requirements for External Host Gatekeeper, a Chrome extension that empowers users to review and control third‑party hosts per site.

## Goals

- Give users visibility into all third‑party hosts a page attempts to contact.
- Allow simple, durable decisions for each host: Block, Review later, Allow.
- Make per‑site decisions easy while supporting global defaults.
- Enforce decisions reliably with Chrome’s declarativeNetRequest API.
- Provide a smooth, low‑friction UX that works with typical browsing.

## Non‑Goals

- Full ad‑blocking or filter-list management (uBlock/AdGuard scope).
- Deep request inspection/modification beyond DNR capabilities.
- Cross‑browser support outside Chromium MV3.

## Personas

- Privacy‑conscious users who want to audit and reduce third‑party tracking.
- Developers and QA validating what third‑party services a site loads.
- Power users curating per‑site and global rules over time.

## Core User Stories

1. As a user, I want to see all third‑party hosts a site contacts so I can choose which to allow.
2. As a user, I want to block a host for a given site and have that decision persist.
3. As a user, I want to define global defaults for common trackers across every site.
4. As a user, I want to temporarily disable the extension for a site and re‑enable it later.
5. As a user, I want the UI to reflect the effective status when local and global decisions interact.

## Feature Overview

- Per‑site review UI (popup)
  - List of observed third‑party hosts and tri‑state toggles
  - Search filter and summary counts (Blocked/Review/Allowed)
  - Apply & Refresh saves decisions and reloads the tab
  - Disable/Enable for this site

- Global defaults (options page)
  - Add hosts and set a default status across all sites
  - Save and broadcast updates without requiring a page reload (rules still apply on next request/page load)

## Behavioral Rules

- Effective status resolution
  - If a host has a site‑specific decision (blocked/allowed), that decision wins over global.
  - If a host has no site‑specific decision, the global decision applies.
  - If no decision exists, host is `pending` and shown as “New”.
  - Hosts equal to the main site or its subdomains default to allowed unless explicitly blocked.

- Disable for site
  - When disabled, the extension neither shows hosts for that site nor applies site‑specific rules.
  - Global rules automatically exclude the disabled site via `excludedInitiatorDomains`.
  - Re‑enabling restores previous site‑specific behavior.

## Functional Requirements

- R1. Track third‑party hosts per tab and update the popup in real time.
- R2. Persist site decisions: `allowed`, `blocked`, `pending`.
- R3. Persist global defaults and merge with site decisions.
- R4. Apply site and global decisions via DNR dynamic rules.
- R5. Support disabling/enabling the extension on a per‑site basis.
- R6. Present a searchable list with summary counts and accessible controls.
- R7. Refresh the active tab after applying site decisions.
- R8. Retain observed hosts during the session so the popup can recover state after background restarts.

## Non‑Functional Requirements

- N1. Minimal perceived latency when updating toggles and saving.
- N2. Stable rule IDs to avoid DNR churn; deterministic hashing for rule IDs.
- N3. Robustness to background worker restarts; session store rehydrates state.
- N4. Clear logs for troubleshooting via service worker console.

## Constraints

- Chrome MV3 service worker lifecycle; no long‑running background pages.
- DNR dynamic rules limits and update semantics (remove before replacing changed rules).
- `webRequest` listener used for observation; enforcement via DNR only.

## Data Retention

- Per‑site configuration and global defaults stored in `chrome.storage.local`.
- Session‑scoped observed hosts stored in `chrome.storage.session`.
- No network payloads or PII are stored beyond hostnames.

## Success Metrics (Qualitative)

- Users can consistently block or allow known trackers across sites.
- Hosts classified in the popup remain enforced after reloads.
- Disabling a site immediately allows previously blocked hosts on that site.

## Open Questions / Future Enhancements

- Import/export lists of hosts and decisions.
- Soft grouping by category (analytics, ads, cdn) for easier review.
- Localization and theming.

