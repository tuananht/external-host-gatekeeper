# Testing "Disable for this site" Feature

## The Fix

**Problem:** When disabling a site, the UI showed it as disabled, but global blocking rules still blocked requests.

**Root Cause:** The code removed site-specific rules but didn't resync global rules to add the disabled site to `excludedInitiatorDomains`.

**Solution:** Added `await ruleManager.syncGlobal(globalConfigCache)` when disabling a site, so global rules are updated to exclude the disabled site.

---

## How to Test

### Step 1: Setup Global Block
1. Open extension options (gear icon)
2. Add a host to global block list (e.g., `doubleclick.net`)
3. Click "Add as blocked"
4. Check service worker console:
```
[Service Worker] Applying global config update: { blockedCount: 1, ... }
[RuleManager] Syncing global rules: {
  disabledSites: [],
  addRules: [{ 
    requestDomains: ['doubleclick.net'],
    excludedInitiatorDomains: []  // Empty - no exclusions yet
  }]
}
```

### Step 2: Test Blocking Works
1. Visit a site that uses the blocked host (e.g., any news site)
2. Open DevTools Network tab
3. Filter for the blocked host
4. Verify requests are blocked (show as "blocked" or don't appear)

### Step 3: Disable for Current Site
1. On the same site, open the extension popup
2. Click "**Disable for this site**"
3. The page will reload
4. Check service worker console:
```
[Service Worker] Disabling site: example.com
[RuleManager] Syncing global rules: {
  disabledSites: ['example.com'],  // ✓ Site added
  addRules: [{
    requestDomains: ['doubleclick.net'],
    excludedInitiatorDomains: ['example.com']  // ✓ Site excluded!
  }]
}
[RuleManager] Global rules resynced to exclude example.com
[Service Worker] Reloaded 1 tabs
```

### Step 4: Verify Blocking is Disabled
1. After page reloads, open DevTools Network tab
2. The previously blocked host should now load successfully
3. Check the extension popup - it should show:
   - "This extension is disabled for this site."
   - No hosts listed
   - "Enable for this site" button

### Step 5: Re-enable for Site
1. Click "**Enable for this site**"
2. The page will reload
3. Check service worker console:
```
[Service Worker] Enabling site: example.com
[RuleManager] Syncing global rules: {
  disabledSites: [],  // ✓ Site removed
  addRules: [{
    requestDomains: ['doubleclick.net'],
    excludedInitiatorDomains: []  // ✓ No exclusions
  }]
}
[Service Worker] Site rules restored for example.com
```

### Step 6: Verify Blocking is Restored
1. After page reloads, open DevTools Network tab
2. The host should be blocked again
3. Extension popup should show detected hosts again

---

## Expected Console Output

### When Disabling a Site
```
[Service Worker] Disabling site: example.com
[RuleManager] Syncing global rules: {
  blockedHostsCount: 2,
  disabledSitesCount: 1,
  disabledSites: ['example.com'],
  rulesToRemove: 2,
  rulesToAdd: 2,
  addRules: [
    {
      id: 2000123,
      requestDomains: ['doubleclick.net'],
      excludedInitiatorDomains: ['example.com']  // ← Site is excluded
    },
    {
      id: 2000456,
      requestDomains: ['googletagmanager.com'],
      excludedInitiatorDomains: ['example.com']  // ← Site is excluded
    }
  ]
}
[RuleManager] Global rules synced successfully
[RuleManager] Current global rules in Chrome: [...]
[Service Worker] Global rules resynced to exclude example.com
[Service Worker] Reloaded 1 tabs
```

### When Re-enabling a Site
```
[Service Worker] Enabling site: example.com
[RuleManager] Syncing site rules for example.com: { ... }
[RuleManager] Syncing global rules: {
  disabledSitesCount: 0,
  disabledSites: [],
  addRules: [
    {
      id: 2000123,
      requestDomains: ['doubleclick.net'],
      excludedInitiatorDomains: []  // ← No exclusions
    },
    ...
  ]
}
[Service Worker] Site rules restored for example.com
[Service Worker] Reloaded 1 tabs
```

---

## Debugging Commands

In the service worker console:

```javascript
// Check which sites are disabled
await chrome.storage.local.get('disabledSites')

// Check all rules
await debugRules()

// Check if a specific rule has exclusions
const rules = await chrome.declarativeNetRequest.getDynamicRules()
const globalRules = rules.filter(r => r.id >= 2000000)
globalRules.forEach(r => {
  console.log(`Rule ${r.id}:`, {
    requestDomains: r.condition.requestDomains,
    excludedInitiatorDomains: r.condition.excludedInitiatorDomains || []
  })
})
```

---

## What Should Happen

### ✅ CORRECT Behavior (After Fix)

1. **Disable site** → Global rules get `excludedInitiatorDomains: ['site.com']`
2. **Page reloads** → Requests to globally blocked hosts are allowed for this site
3. **Enable site** → Global rules remove the site from exclusions
4. **Page reloads** → Requests are blocked again

### ❌ INCORRECT Behavior (Before Fix)

1. **Disable site** → Global rules NOT updated
2. **Page reloads** → Requests still blocked (❌ BUG)
3. UI shows "disabled" but blocking still happens

---

## Additional Test Cases

### Test Case 1: Multiple Disabled Sites
1. Add global block for `tracker.com`
2. Visit `site1.com` → Disable extension
3. Visit `site2.com` → Disable extension
4. Check console - global rule should show:
```javascript
excludedInitiatorDomains: ['site1.com', 'site2.com']
```

### Test Case 2: Disable Then Add New Global Block
1. Disable extension on `example.com`
2. Add new global block for `newtracker.com`
3. Check console - new rule should immediately have exclusion:
```javascript
{
  requestDomains: ['newtracker.com'],
  excludedInitiatorDomains: ['example.com']
}
```

### Test Case 3: Combination of Site-Specific and Global
1. Add global block for `tracker1.com`
2. On `site.com`, add site-specific block for `tracker2.com`
3. Save and verify both blocks work
4. Disable extension for `site.com`
5. Both `tracker1.com` and `tracker2.com` should now be allowed
6. Re-enable → Both should be blocked again

---

## Common Issues

### Issue: "No global rules changes needed"
This is OK if the disabled sites list hasn't changed. But if you just clicked "Disable", you should see rules being updated.

### Issue: Rules show exclusions but still blocking
- Make sure page was reloaded AFTER rules were synced
- Check that the site hostname matches exactly (normalized, lowercase)
- Use `await debugRules()` to verify exclusions are in Chrome

### Issue: Re-enabling doesn't restore blocking
- Check that `syncSite()` was called to restore site-specific rules
- Check that global rules were resynced without the exclusion
- Verify page was reloaded after re-enabling

