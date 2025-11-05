/**
 * Debug script to inspect declarativeNetRequest rules
 * 
 * To use this in the browser console:
 * 1. Open Chrome DevTools
 * 2. Go to the service worker console (chrome://extensions -> External Host Gatekeeper -> service worker -> inspect)
 * 3. Copy and paste the functions below
 * 4. Run: await debugRules()
 */

async function debugRules() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  
  console.log('=== ALL DYNAMIC RULES ===');
  console.log(`Total rules: ${rules.length}`);
  
  const siteRules = rules.filter(r => r.id < 2000000);
  const globalRules = rules.filter(r => r.id >= 2000000);
  
  console.log('\n=== SITE-SPECIFIC RULES ===');
  console.log(`Count: ${siteRules.length}`);
  siteRules.forEach(rule => {
    console.log(`Rule ${rule.id}:`, {
      action: rule.action,
      initiatorDomains: rule.condition.initiatorDomains,
      requestDomains: rule.condition.requestDomains
    });
  });
  
  console.log('\n=== GLOBAL RULES ===');
  console.log(`Count: ${globalRules.length}`);
  globalRules.forEach(rule => {
    console.log(`Rule ${rule.id}:`, {
      action: rule.action,
      requestDomains: rule.condition.requestDomains,
      domainType: rule.condition.domainType,
      excludedInitiatorDomains: rule.condition.excludedInitiatorDomains
    });
  });
  
  return { total: rules.length, siteRules: siteRules.length, globalRules: globalRules.length };
}

async function testBlockRule(hostname) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const matchingRules = rules.filter(rule => 
    rule.condition.requestDomains && 
    rule.condition.requestDomains.some(domain => domain === hostname || hostname.endsWith('.' + domain))
  );
  
  console.log(`=== RULES MATCHING "${hostname}" ===`);
  console.log(`Found ${matchingRules.length} matching rule(s)`);
  matchingRules.forEach(rule => {
    console.log(`Rule ${rule.id}:`, rule);
  });
  
  return matchingRules;
}

console.log('Debug functions loaded! Available commands:');
console.log('  await debugRules()           - Show all dynamic rules');
console.log('  await testBlockRule("host")  - Test if a host has blocking rules');

