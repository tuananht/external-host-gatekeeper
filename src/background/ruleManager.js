/* eslint-disable no-undef */

/**
 * Synchronizes Chrome declarativeNetRequest rules with the extension configuration.
 */
export class RuleManager {
  constructor(storageService) {
    this.storage = storageService;
  }

  async initialize() {
    const sites = await this.storage.getAllSites();
    const siteHosts = Object.keys(sites);
    for (const siteHost of siteHosts) {
      // eslint-disable-next-line no-await-in-loop
      await this.syncSite(siteHost);
    }
  }

  async syncSite(siteHost) {
    const siteConfig = await this.storage.getSite(siteHost);
    const blockedHosts = siteConfig.blockedHosts || {};
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const siteRuleIds = existingRules
      .filter((rule) => RuleManager.#ruleMatchesSite(rule, siteHost))
      .map((rule) => rule.id);

    const desiredRuleIds = new Set(Object.values(blockedHosts));
    const rulesToRemove = siteRuleIds.filter((id) => !desiredRuleIds.has(id));

    const addRules = Object.entries(blockedHosts).map(([blockedHost, ruleId]) =>
      RuleManager.#buildBlockRule({ siteHost, blockedHost, ruleId })
    );

    if (rulesToRemove.length || addRules.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: siteRuleIds,
        addRules
      });
    }
  }

  static ensureRuleId(siteHost, blockedHost, existingId) {
    if (typeof existingId === 'number' && Number.isFinite(existingId)) {
      return existingId;
    }
    return RuleManager.#hashToRuleId(`${siteHost}->${blockedHost}`);
  }

  static #ruleMatchesSite(rule, siteHost) {
    const initiators = rule?.condition?.initiatorDomains || [];
    return initiators.includes(siteHost);
  }

  static #buildBlockRule({ siteHost, blockedHost, ruleId }) {
    return {
      id: ruleId,
      priority: 1,
      action: { type: 'block' },
      condition: {
        initiatorDomains: [siteHost],
        requestDomains: [blockedHost]
      }
    };
  }

  static #hashToRuleId(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 1000000 + 1;
  }
}
