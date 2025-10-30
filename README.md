# External Host Gatekeeper

Chrome extension that monitors every third-party host contacted while you browse and lets you decide whether each host should be allowed, reviewed later, or blocked. Decisions are remembered per primary domain and enforced with `declarativeNetRequest` rules so blocked hosts stay blocked on subsequent visits.

## Features

- **Live host tracking** — observes network requests in real time and shows new hosts immediately in the popup.
- **Per-site configuration** — stores allow/block/review decisions in `chrome.storage.local`, including subdomain handling.
- **Declarative blocking** — syncs blocked hosts with Chrome dynamic DNR rules for reliable request prevention.
- **Session cache** — keeps detected hosts available across popup restarts via `chrome.storage.session`.
- **Badge counts** — toolbar badge reflects the number of third-party hosts seen for the active tab.
- **Visual review UI** — MV3 popup with candy-style tri-state switches, summary bar, and autocomplete legend alignment.
- **Automated packaging** — simple Node build script plus a GitHub Actions workflow that builds, uploads artifacts, and creates releases on `main` pushes.

## Project Structure

```
assets/            Extension icon set (generated shield artwork)
popup/             MV3 popup (HTML/CSS/JS)
src/background/    Service worker, storage helpers, and runtime tracking
scripts/build.js   Node build script that assembles dist/chrome-extension.zip
.github/workflows/ GitHub Actions pipeline
```

## Prerequisites

- Node.js 18+ (workflow uses Node 20)
- npm
- Chrome 109+ (MV3 support and declarativeNetRequest APIs)

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the build to produce `dist/unpacked` and `dist/chrome-extension.zip`:
   ```bash
   npm run build
   ```
3. Load the unpacked extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and select `dist/unpacked`

## Git Workflow

1. Configure remotes (example for GitHub repository `tuananht/external-host-gatekeeper`):
   ```bash
   git init
   git remote add origin git@github.com:tuananht/external-host-gatekeeper.git
   git add .
   git commit -m "Initial commit"
   git push -u origin main
   ```
2. Ignore build artifacts: `.gitignore` already excludes `dist/`.
3. When switching machines:
   ```bash
   git clone git@github.com:tuananht/external-host-gatekeeper.git
   cd external-host-gatekeeper
   npm install
   ```
4. Run `npm run build` after changes; commit and push as usual.

## GitHub Actions

Workflow: `.github/workflows/build-extension.yml`

- Triggers on pushes/PRs targeting `main` and via manual dispatch.
- Installs dependencies, runs `npm run build`, uploads `dist/chrome-extension.zip`.
- On push to `main`, creates a tagged GitHub release with the packaged ZIP.
- Writes a summary to `GITHUB_STEP_SUMMARY` for quick status visibility.

## Testing & Verification

- **Manual**: load the unpacked build, visit target sites, verify host detection, badge counts, and blocking.
- **Storage inspection**: open background service worker DevTools and run:
  ```js
  chrome.storage.local.get('siteHostConfig').then(console.log);
  chrome.storage.session.get('runtimeSiteHosts').then(console.log);
  ```

## Release Notes

Releases are auto-generated on `main` pushes. Each release bundles `dist/chrome-extension.zip`, ready for manual upload or side-loading.

## Contributing & Maintenance

- Keep UI updates in `popup/`.
- Background logic resides in `src/background/`; ensure new hosts respect existing storage and DNR sync flows.
- Update icons in `assets/icons/` and rerun `npm run build` to refresh packaged assets.
- If new commands or dependencies are introduced, reflect them in this README and the GitHub Action workflow.
