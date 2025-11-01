/* eslint-disable no-undef */

/**
 * Synchronizes Chrome declarativeNetRequest rules with the extension configuration.
 */
export class RuleManager {
  constructor(storageService) {
    this.storage = storageService;
    this.globalRuleOffset = 2000000;
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

  async syncGlobal(globalConfig) {
    const blockedHosts = new Set(globalConfig.blockedHosts || []);
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const globalRules = existingRules.filter((rule) => rule.id >= this.globalRuleOffset);
    const desiredRuleIds = new Set();
    const addRules = [];
    const existingRuleById = new Map(globalRules.map((rule) => [rule.id, rule]));

    const siteOverrides = await this.storage.getAllSites();
    const allowOverrides = new Map();
    Object.entries(siteOverrides).forEach(([siteHost, config]) => {
      const allowed = new Set((config.allowedHosts || []).map(RuleManager.normalizeHost));
      allowed.forEach((host) => {
        if (!allowOverrides.has(host)) {
          allowOverrides.set(host, new Set());
        }
        allowOverrides.get(host).add(siteHost);
      });
    });

    blockedHosts.forEach((rawHost) => {
      const blockedHost = RuleManager.normalizeHost(rawHost);
      const ruleId = RuleManager.ensureGlobalRuleId(blockedHost, this.globalRuleOffset);
      desiredRuleIds.add(ruleId);
      const exclusions = Array.from(allowOverrides.get(blockedHost) || []).sort();
      const existingRule = existingRuleById.get(ruleId);
      let alreadyPresent = false;
      if (existingRule) {
        const existingDomains = Array.isArray(existingRule.condition?.requestDomains)
          ? existingRule.condition.requestDomains.map(RuleManager.normalizeHost)
          : [];
        const existingExcluded = new Set(existingRule.condition?.excludedInitiatorDomains || []);
        alreadyPresent =
          existingDomains.length === 1 &&
          existingDomains[0] === blockedHost &&
          exclusions.length === existingExcluded.size &&
          exclusions.every((domain) => existingExcluded.has(domain));
      }
      if (!alreadyPresent) {
        addRules.push(
          RuleManager.#buildGlobalBlockRule({
            blockedHost,
            ruleId,
            excludedInitiators: exclusions
          })
        );
      }
    });

    const rulesToRemove = globalRules
      .filter((rule) => !desiredRuleIds.has(rule.id))
      .map((rule) => rule.id);

    if (rulesToRemove.length || addRules.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rulesToRemove,
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

  static ensureGlobalRuleId(blockedHost, offset) {
    return offset + RuleManager.#hashToRuleId(`global::${blockedHost}`);
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

  static #buildGlobalBlockRule({ blockedHost, ruleId, excludedInitiators = [] }) {
    const condition = {
      requestDomains: [blockedHost],
      domainType: 'thirdParty'
    };
    if (excludedInitiators.length) {
      condition.excludedInitiatorDomains = excludedInitiators;
    }
    return {
      id: ruleId,
      priority: 1,
      action: { type: 'block' },
      condition
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

  static normalizeHost(host) {
    if (!host || typeof host !== 'string') {
      return '';
    }
    return host.trim().toLowerCase();
  }
}
