/* eslint-disable no-undef */

/**
 * Handles persistence of site specific host configuration.
 */
export class StorageService {
  constructor(storageArea = chrome.storage.local) {
    this.storageArea = storageArea;
    this.configKey = 'siteHostConfig';
    this.globalKey = 'globalHostConfig';
    this.defaultGlobalBlocked = [
      'www.googletagmanager.com',
      'connect.facebook.net'
    ];
    this.disabledSitesKey = 'disabledSites';
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

  async getDisabledSites() {
    const data = await this.storageArea.get(this.disabledSitesKey);
    return Array.isArray(data[this.disabledSitesKey])
      ? Array.from(new Set(data[this.disabledSitesKey])).sort()
      : [];
  }

  async setDisabledSites(list) {
    const normalized = Array.from(new Set((list || []).map(StorageService.normalizeHost))).filter(Boolean).sort();
    await this.storageArea.set({ [this.disabledSitesKey]: normalized });
    return normalized;
  }

  async disableSite(siteHost) {
    const current = await this.getDisabledSites();
    const normalized = StorageService.normalizeHost(siteHost);
    if (!normalized) {
      return current;
    }
    if (!current.includes(normalized)) {
      current.push(normalized);
      current.sort();
      await this.setDisabledSites(current);
    }
    return current;
  }

  async enableSite(siteHost) {
    const normalized = StorageService.normalizeHost(siteHost);
    if (!normalized) {
      return this.getDisabledSites();
    }
    const updated = (await this.getDisabledSites()).filter((host) => host !== normalized);
    await this.setDisabledSites(updated);
    return updated;
  }

  async getGlobalConfig() {
    const data = await this.storageArea.get(this.globalKey);
    let config = data[this.globalKey];
    if (!config) {
      config = await this.saveGlobalConfig({
        allowedHosts: [],
        blockedHosts: this.defaultGlobalBlocked,
        pendingHosts: []
      });
    }
    return {
      allowedHosts: Array.isArray(config.allowedHosts) ? [...new Set(config.allowedHosts)] : [],
      blockedHosts: Array.isArray(config.blockedHosts) ? [...new Set(config.blockedHosts)] : [],
      pendingHosts: Array.isArray(config.pendingHosts) ? [...new Set(config.pendingHosts)] : []
    };
  }

  async saveGlobalConfig(globalConfig) {
    const cleaned = this.#cleanGlobalConfig(globalConfig);
    await this.storageArea.set({ [this.globalKey]: cleaned });
    return cleaned;
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

  #cleanGlobalConfig(config) {
    const allowed = new Set((config.allowedHosts || []).map(StorageService.normalizeHost));
    const blocked = new Set((config.blockedHosts || []).map(StorageService.normalizeHost));
    const pending = new Set((config.pendingHosts || []).map(StorageService.normalizeHost));

    allowed.delete('');
    blocked.delete('');
    pending.delete('');

    // Pending should not duplicate allowed/blocked
    for (const host of allowed) {
      pending.delete(host);
      blocked.delete(host);
    }
    for (const host of blocked) {
      pending.delete(host);
      allowed.delete(host);
    }

    return {
      allowedHosts: Array.from(allowed).sort(),
      blockedHosts: Array.from(blocked).sort(),
      pendingHosts: Array.from(pending).sort()
    };
  }

  static normalizeHost(host) {
    if (!host || typeof host !== 'string') {
      return '';
    }
    return host.trim().toLowerCase();
  }
}
