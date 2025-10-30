/* eslint-disable no-undef */

/**
 * Handles persistence of site specific host configuration.
 */
export class StorageService {
  constructor(storageArea = chrome.storage.local) {
    this.storageArea = storageArea;
    this.configKey = 'siteHostConfig';
  }

  async getAllSites() {
    const data = await this.storageArea.get(this.configKey);
    return data[this.configKey] ? { ...data[this.configKey] } : {};
  }

  async getSite(siteHost) {
    const allSites = await this.getAllSites();
    const siteConfig = allSites[siteHost];
    if (siteConfig) {
      return {
        allowedHosts: Array.isArray(siteConfig.allowedHosts)
          ? [...new Set(siteConfig.allowedHosts)]
          : [],
        blockedHosts:
          siteConfig.blockedHosts && typeof siteConfig.blockedHosts === 'object'
            ? { ...siteConfig.blockedHosts }
            : {},
        pendingHosts: Array.isArray(siteConfig.pendingHosts)
          ? [...new Set(siteConfig.pendingHosts)]
          : []
      };
    }
    return {
      allowedHosts: [],
      blockedHosts: {},
      pendingHosts: []
    };
  }

  async saveSite(siteHost, siteConfig) {
    const allSites = await this.getAllSites();
    const cleanedConfig = this.#cleanSiteConfig(siteConfig);
    if (!cleanedConfig) {
      delete allSites[siteHost];
    } else {
      allSites[siteHost] = cleanedConfig;
    }
    await this.storageArea.set({ [this.configKey]: allSites });
    return cleanedConfig;
  }

  #cleanSiteConfig(siteConfig) {
    const allowedSet = new Set(siteConfig.allowedHosts || []);
    const blockedEntries = Object.entries(siteConfig.blockedHosts || {}).filter(
      ([, ruleId]) => typeof ruleId === 'number' && Number.isFinite(ruleId)
    );
    const pendingSet = new Set(siteConfig.pendingHosts || []);

    if (!allowedSet.size && !blockedEntries.length && !pendingSet.size) {
      return null;
    }

    const allowedHosts = Array.from(allowedSet).sort();
    const blockedHosts = {};
    for (const [host, ruleId] of blockedEntries) {
      blockedHosts[host] = ruleId;
    }
    const pendingHosts = Array.from(pendingSet).sort();
    return { allowedHosts, blockedHosts, pendingHosts };
  }
}
