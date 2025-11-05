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
    const allowedHosts = siteConfig.allowedHosts || [];
    const globalConfig = await this.storage.getGlobalConfig();
    const globalBlockedHosts = new Set((globalConfig.blockedHosts || []).map(RuleManager.normalizeHost));
    
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const siteRuleIds = existingRules
      .filter((rule) => RuleManager.#ruleMatchesSite(rule, siteHost))
      .map((rule) => rule.id);

    const desiredRuleIds = new Set(Object.values(blockedHosts));
    const addRules = [];

    // Add block rules for site-specific blocks
    Object.entries(blockedHosts).forEach(([blockedHost, ruleId]) => {
      desiredRuleIds.add(ruleId);
      addRules.push(RuleManager.#buildBlockRule({ siteHost, blockedHost, ruleId }));
    });

    // Add allow rules for hosts that are globally blocked but site wants to allow
    allowedHosts.forEach((allowedHost) => {
      const normalized = RuleManager.normalizeHost(allowedHost);
      if (globalBlockedHosts.has(normalized)) {
        // Create override rule to allow this host even though it's globally blocked
        const ruleId = RuleManager.ensureRuleId(siteHost, allowedHost, null);
        desiredRuleIds.add(ruleId);
        addRules.push(RuleManager.#buildAllowRule({ siteHost, allowedHost, ruleId }));
      }
    });

    const rulesToRemove = siteRuleIds.filter((id) => !desiredRuleIds.has(id));

    if (rulesToRemove.length || addRules.length) {
      console.log(`[RuleManager] Syncing site rules for ${siteHost}:`, {
        blockedHostsCount: Object.keys(blockedHosts).length,
        allowOverridesCount: addRules.filter(r => r.action.type === 'allow').length,
        rulesToRemove: siteRuleIds.length,
        rulesToAdd: addRules.length,
        addRules: addRules.map(r => ({ 
          id: r.id,
          action: r.action.type,
          initiatorDomains: r.condition.initiatorDomains,
          requestDomains: r.condition.requestDomains 
        }))
      });
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: siteRuleIds,
        addRules
      });
      console.log(`[RuleManager] Site rules synced successfully for ${siteHost}`);
    }
  }

  async removeSiteRules(siteHost) {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const siteRuleIds = existingRules
      .filter((rule) => RuleManager.#ruleMatchesSite(rule, siteHost))
      .map((rule) => rule.id);

    if (siteRuleIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: siteRuleIds
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

    // Get disabled sites - global rules should not apply to them
    const disabledSites = await this.storage.getDisabledSites();

    const rulesToUpdate = [];
    blockedHosts.forEach((rawHost) => {
      const blockedHost = RuleManager.normalizeHost(rawHost);
      const ruleId = RuleManager.ensureGlobalRuleId(blockedHost, this.globalRuleOffset);
      desiredRuleIds.add(ruleId);
      // Combine allow overrides and disabled sites for exclusions
      const allowExclusions = Array.from(allowOverrides.get(blockedHost) || []);
      const exclusions = [...new Set([...allowExclusions, ...disabledSites])].sort();
      const existingRule = existingRuleById.get(ruleId);
      let needsUpdate = true;
      if (existingRule) {
        const existingDomains = Array.isArray(existingRule.condition?.requestDomains)
          ? existingRule.condition.requestDomains.map(RuleManager.normalizeHost)
          : [];
        const existingExcluded = new Set(existingRule.condition?.excludedInitiatorDomains || []);
        const isIdentical =
          existingDomains.length === 1 &&
          existingDomains[0] === blockedHost &&
          exclusions.length === existingExcluded.size &&
          exclusions.every((domain) => existingExcluded.has(domain));
        if (isIdentical) {
          needsUpdate = false;
        } else {
          // Rule exists but needs updating - mark it for removal
          rulesToUpdate.push(ruleId);
        }
      }
      if (needsUpdate) {
        addRules.push(
          RuleManager.#buildGlobalBlockRule({
            blockedHost,
            ruleId,
            excludedInitiators: exclusions
          })
        );
      }
    });

    // Remove rules that are no longer needed OR need updating
    const rulesToRemove = [
      ...rulesToUpdate,
      ...globalRules
        .filter((rule) => !desiredRuleIds.has(rule.id))
        .map((rule) => rule.id)
    ];

    if (rulesToRemove.length || addRules.length) {
      console.log('[RuleManager] Syncing global rules:', {
        blockedHostsCount: blockedHosts.size,
        disabledSitesCount: disabledSites.length,
        disabledSites: disabledSites,
        rulesToRemove: rulesToRemove.length,
        rulesToAdd: addRules.length,
        addRules: addRules.map(r => ({ 
          id: r.id, 
          requestDomains: r.condition.requestDomains,
          excludedInitiatorDomains: r.condition.excludedInitiatorDomains || []
        }))
      });
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: rulesToRemove,
          addRules
        });
        console.log('[RuleManager] Global rules synced successfully');
        
        // Verify the rules were actually added
        const allRules = await chrome.declarativeNetRequest.getDynamicRules();
        const globalRulesAfter = allRules.filter((rule) => rule.id >= this.globalRuleOffset);
        console.log('[RuleManager] Current global rules in Chrome:', globalRulesAfter.map(r => ({
          id: r.id,
          action: r.action,
          requestDomains: r.condition.requestDomains,
          excludedInitiatorDomains: r.condition.excludedInitiatorDomains || []
        })));
      } catch (error) {
        console.error('[RuleManager] Failed to sync global rules:', error);
        throw error;
      }
    } else {
      console.log('[RuleManager] No global rules changes needed');
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
      priority: 2, // Higher priority than global rules (site-specific takes precedence)
      action: { type: 'block' },
      condition: {
        initiatorDomains: [siteHost],
        requestDomains: [blockedHost]
      }
    };
  }

  static #buildAllowRule({ siteHost, allowedHost, ruleId }) {
    return {
      id: ruleId,
      priority: 2, // Higher priority than global rules (site-specific takes precedence)
      action: { type: 'allow' },
      condition: {
        initiatorDomains: [siteHost],
        requestDomains: [allowedHost]
      }
    };
  }

  static #buildGlobalBlockRule({ blockedHost, ruleId, excludedInitiators = [] }) {
    const condition = {
      requestDomains: [blockedHost]
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
