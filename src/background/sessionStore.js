/* eslint-disable no-undef */

/**
 * Persists observed hosts for the current browser session so the popup can
 * restore context even after the background service worker is unloaded.
 */
export class SessionStore {
  constructor(storageArea = chrome.storage.session) {
    this.storageArea = storageArea;
    this.storageKey = 'runtimeSiteHosts';
    this.cache = new Map();
  }

  async initialize() {
    try {
      const result = await this.storageArea.get(this.storageKey);
      const raw = result[this.storageKey] || {};
      Object.entries(raw).forEach(([siteHost, hosts]) => {
        if (Array.isArray(hosts) && hosts.length) {
          this.cache.set(siteHost, new Set(hosts));
        }
      });
    } catch (error) {
      console.warn('Failed to hydrate session store', error);
      this.cache.clear();
    }
  }

  getHosts(siteHost) {
    const set = this.cache.get(siteHost);
    return set ? new Set(set) : new Set();
  }

  async addHost(siteHost, host) {
    if (!siteHost || !host || !this.storageArea) {
      return;
    }
    const set = this.cache.get(siteHost) || new Set();
    if (set.has(host)) {
      return;
    }
    set.add(host);
    this.cache.set(siteHost, set);
    await this.#persist();
  }

  async setHosts(siteHost, hostsIterable) {
    if (!this.storageArea) {
      return;
    }
    const set = new Set(hostsIterable || []);
    if (set.size) {
      this.cache.set(siteHost, set);
    } else {
      this.cache.delete(siteHost);
    }
    await this.#persist();
  }

  async clearSite(siteHost) {
    if (!this.storageArea) {
      return;
    }
    this.cache.delete(siteHost);
    await this.#persist();
  }

  async #persist() {
    const payload = {};
    this.cache.forEach((set, siteHost) => {
      if (set.size) {
        payload[siteHost] = Array.from(set).sort();
      }
    });
    await this.storageArea.set({ [this.storageKey]: payload });
  }
}
