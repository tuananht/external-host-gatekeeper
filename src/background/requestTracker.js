/* eslint-disable no-undef */

/**
 * Tracks per-tab host relationships observed at runtime.
 */
export class RequestTracker {
  constructor() {
    this.tabMainHosts = new Map();
    this.tabObservedHosts = new Map();
  }

  setMainHost(tabId, host) {
    if (!host) {
      return false;
    }
    const previousHost = this.tabMainHosts.get(tabId);
    if (previousHost === host) {
      if (!this.tabObservedHosts.has(tabId)) {
        this.tabObservedHosts.set(tabId, new Set());
      }
      return false;
    }
    this.tabMainHosts.set(tabId, host);
    this.tabObservedHosts.set(tabId, new Set());
    return previousHost !== host;
  }

  getMainHost(tabId) {
    return this.tabMainHosts.get(tabId);
  }

  addObservedHost(tabId, host) {
    if (!host) {
      return;
    }
    const hosts = this.tabObservedHosts.get(tabId) || new Set();
    hosts.add(host);
    this.tabObservedHosts.set(tabId, hosts);
  }

  getObservedHosts(tabId) {
    const hosts = this.tabObservedHosts.get(tabId);
    return hosts ? new Set(hosts) : new Set();
  }

  resetTab(tabId) {
    this.tabMainHosts.delete(tabId);
    this.tabObservedHosts.delete(tabId);
  }
}
