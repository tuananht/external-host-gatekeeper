# Testing Global Blocking Rules

## Recent Fixes

### Issue
Global blocking rules were syncing but not taking effect in Chrome's declarativeNetRequest API.

### Root Cause
When updating existing rules with the same ID, Chrome requires the old rule to be removed before adding the new one. The code was attempting to add rules without first removing changed rules.

### Solution
Modified `syncGlobal()` in `ruleManager.js` to:
1. Detect when existing rules need updating (not just identical)
2. Add those rule IDs to `rulesToRemove` array
3. Remove old rules first, then add updated ones in a single `updateDynamicRules()` call

---

## How to Test Global Blocking Rules

### Step 1: Setup
1. Load the extension in Chrome (chrome://extensions)
2. Enable Developer Mode
3. Click on "service worker" link under the extension to open the service worker console

### Step 2: Add a Global Block Rule
1. Click the extension icon → Click the gear (⚙️) icon to open Options
2. In the "Add host" field, enter a hostname (e.g., `doubleclick.net`)
3. Click "Add as blocked"
4. Check the service worker console - you should see:
```
[Service Worker] Applying global config update: { blockedCount: 1, blockedHosts: ["doubleclick.net"] }
[RuleManager] Syncing global rules: { blockedHostsCount: 1, rulesToAdd: 1, ... }
[RuleManager] Global rules synced successfully
[RuleManager] Current global rules in Chrome: [{ id: ..., action: { type: 'block' }, condition: {...} }]
[Service Worker] Reloaded X tabs after global config change
[Service Worker] Global config update complete
```

### Step 3: Verify Rules in Chrome
1. In the service worker console, load the debug script:
```javascript
// Copy/paste the contents of debug-rules.js into the console
```

2. Run the debug command:
```javascript
await debugRules()
```

3. You should see output like:
```
=== GLOBAL RULES ===
Count: 1
Rule 2000123: {
  action: { type: 'block' },
  requestDomains: ['doubleclick.net'],
  domainType: 'thirdParty',
  excludedInitiatorDomains: []
}
```

### Step 4: Test Blocking in Action
1. Visit a website that loads the blocked host (e.g., visit any site that uses DoubleClick ads)
2. Open DevTools → Network tab
3. Filter by the blocked hostname
4. You should see requests to that domain either:
   - Not appear at all (blocked before request)
   - Show as "blocked:other" in the Status column
   - Turn red indicating they were blocked

### Step 5: Test Exclusions (Disable for Site)
1. While on a test site, open the extension popup
2. Click "Disable for this site"
3. The page should reload
4. Run `await debugRules()` in the service worker console again
5. The global rule should now show the site in `excludedInitiatorDomains`

### Step 6: Verify Site-Specific Blocking
1. Visit a site
2. Open the extension popup
3. Set a host to "Block" (the left option)
4. Click "Save and reload"
5. Check the console:
```
[RuleManager] Syncing site rules for example.com: { blockedHostsCount: 1, ... }
```
6. Run `await debugRules()` - should show a site-specific rule with:
```
initiatorDomains: ['example.com']
requestDomains: ['blocked-host.com']
```

---

## Common Issues

### Issue: "No global rules changes needed"
**Cause:** Rules are already in sync
**Solution:** This is normal if no changes were made

### Issue: Rules show in console but requests aren't blocked
**Cause:** Page was loaded before rules were applied
**Solution:** Manually reload the page (F5)

### Issue: "domainType: 'thirdParty'" not blocking
**Cause:** The blocked host is being accessed as a first-party request (main navigation)
**Expected:** Global rules with `domainType: 'thirdParty'` only block when the domain is loaded as a third-party resource (scripts, images, etc.), not when navigating directly to it

### Issue: Requests still appear in Network tab as blocked
**Cause:** This is normal - Chrome shows blocked requests in DevTools
**Expected:** The request will show "(blocked:other)" or similar status and won't actually complete

---

## Understanding Rule Types

### Site-Specific Rules (ID < 2,000,000)
```javascript
{
  id: 123456,
  priority: 1,
  action: { type: 'block' },
  condition: {
    initiatorDomains: ['example.com'],  // Only blocks on this site
    requestDomains: ['tracker.com']      // When requesting this domain
  }
}
```

### Global Rules (ID >= 2,000,000)
```javascript
{
  id: 2000123,
  priority: 1,
  action: { type: 'block' },
  condition: {
    requestDomains: ['tracker.com'],              // Block this domain
    domainType: 'thirdParty',                     // Only when third-party
    excludedInitiatorDomains: ['trusted.com']     // Except from these sites
  }
}
```

---

## Debugging Commands

Copy these into the service worker console:

```javascript
// Show all rules
await debugRules()

// Test if a specific host has rules
await testBlockRule('doubleclick.net')

// Get raw rules
const rules = await chrome.declarativeNetRequest.getDynamicRules()
console.log(rules)

// Check global config cache (service worker only)
console.log(globalConfigCache)
```

---

## Log Format

### Successful Global Sync
```
[Service Worker] Applying global config update: { blockedCount: 2, blockedHosts: [...] }
[RuleManager] Syncing global rules: { blockedHostsCount: 2, rulesToRemove: 0, rulesToAdd: 2 }
[RuleManager] Global rules synced successfully
[RuleManager] Current global rules in Chrome: [...]
[Service Worker] Reloaded 3 tabs after global config change
[Service Worker] Global config update complete
```

### Successful Site Sync
```
[RuleManager] Syncing site rules for example.com: { blockedHostsCount: 1, rulesToAdd: 1 }
[RuleManager] Site rules synced successfully for example.com
```

### Update Existing Rule
```
[RuleManager] Syncing global rules: { rulesToRemove: 1, rulesToAdd: 1 }
```
(Removes old version, adds updated version)

---

## Next Steps If Issues Persist

1. Check manifest.json has `declarativeNetRequest` permission
2. Check Chrome version >= 109
3. Check if rule limit is exceeded (max dynamic rules varies by Chrome version)
4. Try removing all rules manually:
```javascript
const rules = await chrome.declarativeNetRequest.getDynamicRules()
await chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: rules.map(r => r.id)
})
```
Then reload the extension and try again.

