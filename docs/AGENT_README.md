# External Host Gatekeeper — Agent README

External Host Gatekeeper is a Chrome extension that observes third‑party hosts contacted by the pages you visit and lets you decide whether each host should be blocked, allowed, or left for later review. Decisions can be applied per‑site or globally and are enforced via Chrome’s `declarativeNetRequest` (DNR) rules so blocked hosts stay blocked on subsequent visits.

This Agent README orients you to the problem the extension solves, the core concepts, and where to find deeper technical and product details.

## What It Does

- Tracks third‑party hosts on each site in real time (per tab)
- Lets you classify each host: Block, Review later, Allow
- Persists decisions per site and globally in `chrome.storage.local`
- Applies decisions through DNR rules; reloads the tab after saving
- Supports “Disable for this site” to suspend all blocking on a site

## Core Concepts

- Main site host: the top‑level domain for the active tab (e.g., `example.com`).
- Observed host: any third‑party host requested by the page (e.g., `cdn.example.net`, `tracker.com`).
- Status: one of `blocked`, `pending` (review later), or `allowed`.
- Local vs global config: local applies only to the current site; global applies to all sites unless locally overridden.
- Disabled sites: sites for which the extension is temporarily disabled; global rules exclude these via DNR `excludedInitiatorDomains`.

## Quick Start

See the main project README at `README.md` for installation and building instructions. In short:

1. `npm install`
2. `npm run build`
3. Load `dist/unpacked` at `chrome://extensions` (Developer mode → Load unpacked)

## User Experience Highlights

- Popup shows the current site, a searchable list of observed hosts, and tri‑state toggles.
- Summary bar displays counts for Blocked, Review later, Allowed.
- “Apply & Refresh” saves decisions and refreshes the tab to apply rules.
- Gear icon opens global defaults where you can manage all‑site decisions.
- “Disable for this site” suspends blocking for the current site.

## Architecture at a Glance

- Background service worker (`src/background/service_worker.js`): tracks requests, coordinates storage, and syncs DNR rules.
- Storage (`src/background/storage.js`): persists per‑site, global, and disabled‑site state.
- RuleManager (`src/background/ruleManager.js`): computes and updates dynamic DNR rules; assigns stable rule IDs; handles exclusions for disabled sites and allow‑overrides.
- Session cache (`src/background/sessionStore.js`): keeps observed hosts for the current session to restore context.
- Popup (`popup/`): reviews hosts per site and applies decisions.
- Options (`options/`): manages global defaults.

## Where To Go Next

- Product details and behavior: `docs/PRODUCT_SPEC.md`
- Technical architecture and data shapes: `docs/TECHNICAL_DESIGN.md`
- End‑user usage and troubleshooting: `docs/USER_GUIDE.md`
- Development notes and CI: `CONTRIBUTING.md`, `TESTING-GLOBAL-RULES.md`, `test-disable-site.md`

