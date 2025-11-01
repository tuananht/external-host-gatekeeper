/* eslint-disable no-undef */

import { StorageService } from './storage.js';
import { RuleManager } from './ruleManager.js';
import { RequestTracker } from './requestTracker.js';
import { SessionStore } from './sessionStore.js';

const MESSAGE_TYPES = {
  GET_SITE_STATE: 'GET_SITE_STATE',
  SAVE_SITE_DECISIONS: 'SAVE_SITE_DECISIONS',
  HOSTS_OBSERVED: 'HOSTS_OBSERVED',
  GET_GLOBAL_CONFIG: 'GET_GLOBAL_CONFIG',
  SAVE_GLOBAL_DECISIONS: 'SAVE_GLOBAL_DECISIONS',
  ADD_GLOBAL_HOST: 'ADD_GLOBAL_HOST',
  GLOBAL_CONFIG_UPDATED: 'GLOBAL_CONFIG_UPDATED',
  DISABLE_SITE: 'DISABLE_SITE',
  ENABLE_SITE: 'ENABLE_SITE',
  SITE_DISABLED_CHANGED: 'SITE_DISABLED_CHANGED'
};

const storage = new StorageService();
const ruleManager = new RuleManager(storage);
const tracker = new RequestTracker();
const sessionStore = new SessionStore();

const observedHostsCache = new Map();
let globalConfigCache = {
  allowedHosts: [],
  blockedHosts: [],
  pendingHosts: []
};
let globalStatusIndex = {
  allowed: new Set(),
  blocked: new Set(),
  pending: new Set()
};
let disabledSitesCache = new Set();

initialize();

async function initialize() {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
  } catch (error) {
    console.warn('Failed to set badge background color', error);
  }
  await sessionStore.initialize();
  globalConfigCache = await storage.getGlobalConfig();
  rebuildGlobalStatusIndex();
  disabledSitesCache = new Set((await storage.getDisabledSites()).map(StorageService.normalizeHost).filter(Boolean));
  await ruleManager.initialize();
  await ruleManager.syncGlobal(globalConfigCache);
  attachTabListeners();
  attachRequestListener();
  attachMessageListener();
}

function attachTabListeners() {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab?.url) {
      const host = extractHostname(tab.url);
      if (host) {
        const changed = tracker.setMainHost(tabId, host);
        if (changed) {
          observedHostsCache.set(tabId, new Set());
          updateBadgeCount(tabId).catch((error) => {
            console.warn('Failed to reset badge for tab', error);
          });
        }
        await refreshObservedHostsFromConfig(tabId, host);
      }
    }
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      await ensureTabContext(tabId);
      await updateBadgeCount(tabId);
    } catch (error) {
      console.warn('Failed to update badge on tab activation', error);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tracker.resetTab(tabId);
    observedHostsCache.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: '' }).catch((error) => {
      console.warn('Failed to clear badge on tab removal', error);
    });
  });
}

function attachRequestListener() {
  chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
      if (details.tabId < 0) {
        return;
      }
      const requestHost = extractHostname(details.url);
      if (!requestHost) {
        return;
      }

      if (details.type === 'main_frame') {
        const changed = tracker.setMainHost(details.tabId, requestHost);
        if (isSiteDisabled(requestHost)) {
          observedHostsCache.set(details.tabId, new Set());
          await chrome.action
            .setBadgeText({ tabId: details.tabId, text: '' })
            .catch((error) => console.warn('Failed to clear badge for disabled tab', error));
          return;
        }
        if (changed) {
          observedHostsCache.set(details.tabId, new Set());
          updateBadgeCount(details.tabId).catch((error) => {
            console.warn('Failed to reset badge for main frame', error);
          });
        }
        return;
      }

      let siteHost = tracker.getMainHost(details.tabId);
      if (!siteHost) {
        const candidateUrl = details.initiator || details.documentUrl || details.originUrl;
        if (candidateUrl) {
          siteHost = extractHostname(candidateUrl);
        }
        if (!siteHost) {
          try {
            const tab = await chrome.tabs.get(details.tabId);
            siteHost = tab?.url ? extractHostname(tab.url) : null;
          } catch (error) {
            console.warn('Failed to derive tab host for request', error);
          }
        }
        if (siteHost) {
          const changed = tracker.setMainHost(details.tabId, siteHost);
          if (changed) {
            observedHostsCache.set(details.tabId, new Set());
            updateBadgeCount(details.tabId).catch((error) => {
              console.warn('Failed to reset badge for request tab', error);
            });
          }
        }
      }

      if (!siteHost || siteHost === requestHost) {
        return;
      }
      if (isSiteDisabled(siteHost)) {
        return;
      }

      tracker.addObservedHost(details.tabId, requestHost);
      const hostSet = observedHostsCache.get(details.tabId) || new Set();
      hostSet.add(requestHost);
      observedHostsCache.set(details.tabId, hostSet);
      updateBadgeCount(details.tabId).catch((error) => {
        console.warn('Failed to update badge', error);
      });
      sessionStore.addHost(siteHost, requestHost).catch((error) => {
        console.warn('Failed to persist session host', error);
      });
      broadcastHostUpdate(details.tabId, requestHost);
    },
    { urls: ['<all_urls>'] }
  );
}

function attachMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) {
      return false;
    }

    switch (message.type) {
      case MESSAGE_TYPES.GET_SITE_STATE:
        handleGetSiteState(message.tabId)
          .then(sendResponse)
          .catch((error) => {
            console.error(error);
            sendResponse({ error: error.message });
          });
        return true;
      case MESSAGE_TYPES.SAVE_SITE_DECISIONS:
        handleSaveSiteDecisions(message.tabId, message.mainHost, message.decisions)
          .then(sendResponse)
          .catch((error) => {
            console.error(error);
            sendResponse({ error: error.message });
          });
        return true;
      case MESSAGE_TYPES.GET_GLOBAL_CONFIG:
        handleGetGlobalConfig()
          .then(sendResponse)
          .catch((error) => {
            console.error(error);
            sendResponse({ error: error.message });
          });
        return true;
      case MESSAGE_TYPES.SAVE_GLOBAL_DECISIONS:
        handleSaveGlobalDecisions(message.decisions)
          .then(sendResponse)
          .catch((error) => {
            console.error(error);
            sendResponse({ error: error.message });
          });
        return true;
      case MESSAGE_TYPES.ADD_GLOBAL_HOST:
        handleAddGlobalHost(message.host, message.status)
          .then(sendResponse)
          .catch((error) => {
            console.error(error);
            sendResponse({ error: error.message });
          });
        return true;
      case MESSAGE_TYPES.DISABLE_SITE:
        handleDisableSite(message.siteHost)
          .then(sendResponse)
          .catch((error) => {
            console.error(error);
            sendResponse({ error: error.message });
          });
        return true;
      case MESSAGE_TYPES.ENABLE_SITE:
        handleEnableSite(message.siteHost)
          .then(sendResponse)
          .catch((error) => {
            console.error(error);
            sendResponse({ error: error.message });
          });
        return true;
      default:
        return false;
    }
  });
}

async function refreshObservedHostsFromConfig(tabId, siteHost) {
  if (isSiteDisabled(siteHost)) {
    observedHostsCache.set(tabId, new Set());
    updateBadgeCount(tabId).catch((error) => {
      console.warn('Failed to update badge during refresh', error);
    });
    return;
  }

  const siteConfig = await storage.getSite(siteHost);
  const combinedHosts = new Set([
    ...tracker.getObservedHosts(tabId),
    ...sessionStore.getHosts(siteHost),
    ...siteConfig.allowedHosts,
    ...Object.keys(siteConfig.blockedHosts),
    ...(siteConfig.pendingHosts || []),
    ...globalConfigCache.allowedHosts,
    ...globalConfigCache.blockedHosts,
    ...globalConfigCache.pendingHosts
  ]);
  observedHostsCache.set(tabId, combinedHosts);
  updateBadgeCount(tabId).catch((error) => {
    console.warn('Failed to update badge during refresh', error);
  });
  sessionStore.setHosts(siteHost, combinedHosts).catch((error) => {
    console.warn('Failed to sync session hosts', error);
  });
}

async function handleGetSiteState(tabId) {
  if (typeof tabId !== 'number') {
    throw new Error('Active tab id missing');
  }

  const mainHost = await ensureTabContext(tabId);
  if (!mainHost) {
    return { mainHost: null, hosts: [], disabled: false };
  }

  const normalizedMain = StorageService.normalizeHost(mainHost);
  const disabled = disabledSitesCache.has(normalizedMain);
  if (disabled) {
    return { mainHost, hosts: [], disabled: true };
  }

  const siteConfig = await storage.getSite(mainHost);
  // Only get hosts that were actually accessed during the current tab load
  const hostSet = tracker.getObservedHosts(tabId);

  const globalStatuses = {};
  const hosts = Array.from(hostSet)
    .map((host) => {
      const normalizedHost = StorageService.normalizeHost(host);
      const globalStatus = getGlobalStatus(normalizedHost, mainHost);
      const localStatus = getLocalStatus(normalizedHost, siteConfig);
      globalStatuses[host] = globalStatus;
      return {
        host,
        status: determineHostStatus(normalizedHost, siteConfig, mainHost),
        globalStatus,
        localStatus
      };
    })
    .sort((a, b) => a.host.localeCompare(b.host));

  return { mainHost, hosts, globalStatuses, disabled: false };
}

function determineHostStatus(host, siteConfig, mainHost) {
  const normalizedHost = StorageService.normalizeHost(host);
  const localStatus = getLocalStatus(host, siteConfig);
  if (localStatus) {
    return localStatus;
  }
  return getGlobalStatus(normalizedHost, mainHost);
}

function getLocalStatus(host, siteConfig) {
  const normalizedHost = StorageService.normalizeHost(host);
  const blockedHosts = Object.keys(siteConfig.blockedHosts || {});
  if (blockedHosts.some((blocked) => StorageService.normalizeHost(blocked) === normalizedHost)) {
    return 'blocked';
  }
  if ((siteConfig.allowedHosts || []).some((allowed) => StorageService.normalizeHost(allowed) === normalizedHost)) {
    return 'allowed';
  }
  // Note: pending in site config is NOT an override - it means "use global default"
  // So we don't return 'pending' here, we return null to check global status
  return null;
}

async function handleSaveSiteDecisions(tabId, mainHost, decisions) {
  if (typeof tabId !== 'number' || !mainHost) {
    throw new Error('Missing tab context for save');
  }

  const siteConfig = await storage.getSite(mainHost);
  const allowed = new Set(siteConfig.allowedHosts);
  const blocked = { ...siteConfig.blockedHosts };
  const pending = new Set(siteConfig.pendingHosts || []);

  decisions.forEach(({ host, status }) => {
    if (!host) {
      return;
    }
    if (status === 'blocked') {
      const ruleId = RuleManager.ensureRuleId(mainHost, host, blocked[host]);
      blocked[host] = ruleId;
      allowed.delete(host);
      pending.delete(host);
    } else if (status === 'allowed') {
      allowed.add(host);
      delete blocked[host];
      pending.delete(host);
    } else {
      allowed.delete(host);
      delete blocked[host];
      pending.add(host);
    }
  });

  const cleanedAllowed = Array.from(allowed).sort();
  const cleanedBlocked = {};
  Object.entries(blocked).forEach(([host, ruleId]) => {
    if (typeof ruleId === 'number' && Number.isFinite(ruleId)) {
      cleanedBlocked[host] = ruleId;
    }
  });
  const cleanedPending = Array.from(pending).sort();

  await storage.saveSite(mainHost, {
    allowedHosts: cleanedAllowed,
    blockedHosts: cleanedBlocked,
    pendingHosts: cleanedPending
  });
  await ruleManager.syncSite(mainHost);
  const persistedHosts = new Set([
    ...Array.from(allowed),
    ...Object.keys(cleanedBlocked),
    ...Array.from(pending),
    ...sessionStore.getHosts(mainHost)
  ]);
  sessionStore.setHosts(mainHost, persistedHosts).catch((error) => {
    console.warn('Failed to persist saved session hosts', error);
  });
  updateBadgeCount(tabId).catch((error) => {
    console.warn('Failed to update badge after save', error);
  });
  await reloadTab(tabId);
  return { success: true };
}

async function handleGetGlobalConfig() {
  return { config: globalConfigCache };
}

async function handleSaveGlobalDecisions(decisions = []) {
  const allowed = new Set();
  const blocked = new Set();
  const pending = new Set();

  decisions.forEach(({ host, status }) => {
    const normalizedHost = StorageService.normalizeHost(host);
    if (!normalizedHost) {
      return;
    }
    if (status === 'blocked') {
      blocked.add(normalizedHost);
    } else if (status === 'allowed') {
      allowed.add(normalizedHost);
    } else {
      pending.add(normalizedHost);
    }
  });

  const newConfig = await storage.saveGlobalConfig({
    allowedHosts: Array.from(allowed),
    blockedHosts: Array.from(blocked),
    pendingHosts: Array.from(pending)
  });
  await applyGlobalConfigUpdate(newConfig);
  return { success: true, config: globalConfigCache };
}

async function handleAddGlobalHost(host, status) {
  const normalizedHost = StorageService.normalizeHost(host);
  if (!normalizedHost) {
    throw new Error('Invalid host');
  }

  const allowed = new Set(globalConfigCache.allowedHosts.map(StorageService.normalizeHost));
  const blocked = new Set(globalConfigCache.blockedHosts.map(StorageService.normalizeHost));
  const pending = new Set(globalConfigCache.pendingHosts.map(StorageService.normalizeHost));

  allowed.delete(normalizedHost);
  blocked.delete(normalizedHost);
  pending.delete(normalizedHost);

  if (status === 'blocked') {
    blocked.add(normalizedHost);
  } else if (status === 'allowed') {
    allowed.add(normalizedHost);
  } else {
    pending.add(normalizedHost);
  }

  const newConfig = await storage.saveGlobalConfig({
    allowedHosts: Array.from(allowed),
    blockedHosts: Array.from(blocked),
    pendingHosts: Array.from(pending)
  });
  await applyGlobalConfigUpdate(newConfig);
  return { success: true, config: globalConfigCache };
}

async function handleDisableSite(siteHost) {
  const normalized = StorageService.normalizeHost(siteHost);
  if (!normalized) {
    throw new Error('Invalid site host');
  }
  disabledSitesCache = new Set(await storage.disableSite(normalized));
  await applyDisabledState(normalized, true);
  broadcastDisabledUpdate(normalized, true);
  
  // Reload all tabs for this site to apply changes
  const reloadPromises = [];
  tracker.tabMainHosts.forEach((host, tabId) => {
    if (StorageService.normalizeHost(host) === normalized) {
      reloadPromises.push(reloadTab(tabId));
    }
  });
  await Promise.allSettled(reloadPromises);
  
  return { success: true };
}

async function handleEnableSite(siteHost) {
  const normalized = StorageService.normalizeHost(siteHost);
  if (!normalized) {
    throw new Error('Invalid site host');
  }
  disabledSitesCache = new Set(await storage.enableSite(normalized));
  await applyDisabledState(normalized, false);
  broadcastDisabledUpdate(normalized, false);
  
  // Reload all tabs for this site to apply changes
  const reloadPromises = [];
  tracker.tabMainHosts.forEach((host, tabId) => {
    if (StorageService.normalizeHost(host) === normalized) {
      reloadPromises.push(reloadTab(tabId));
    }
  });
  await Promise.allSettled(reloadPromises);
  
  return { success: true };
}

async function applyGlobalConfigUpdate(newConfig) {
  console.log('[Service Worker] Applying global config update:', {
    allowedCount: newConfig.allowedHosts.length,
    blockedCount: newConfig.blockedHosts.length,
    pendingCount: newConfig.pendingHosts.length,
    blockedHosts: newConfig.blockedHosts
  });
  globalConfigCache = newConfig;
  rebuildGlobalStatusIndex();
  await ruleManager.syncGlobal(globalConfigCache);
  await refreshAllTabsAfterGlobalChange();
  broadcastGlobalUpdate();
  console.log('[Service Worker] Global config update complete');
}

async function refreshAllTabsAfterGlobalChange() {
  const refreshPromises = [];
  observedHostsCache.forEach((_, tabId) => {
    const mainHost = tracker.getMainHost(tabId);
    if (mainHost) {
      refreshPromises.push(refreshObservedHostsFromConfig(tabId, mainHost));
    }
  });
  await Promise.allSettled(refreshPromises);
  console.log(`[Service Worker] Refreshed cache for ${refreshPromises.length} tabs (no reload)`);
}

function broadcastGlobalUpdate() {
  chrome.runtime.sendMessage(
    {
      type: MESSAGE_TYPES.GLOBAL_CONFIG_UPDATED,
      config: globalConfigCache
    },
    () => {
      if (chrome.runtime.lastError) {
        // No active listeners
      }
    }
  );
}

function broadcastHostUpdate(tabId, host) {
  chrome.runtime.sendMessage(
    {
      type: MESSAGE_TYPES.HOSTS_OBSERVED,
      tabId,
      host
    },
    () => {
      if (chrome.runtime.lastError) {
        // No active listeners - safe to ignore
      }
    }
  );
}

function extractHostname(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname;
  } catch (error) {
    return null;
  }
}

async function reloadTab(tabId) {
  try {
    await chrome.tabs.reload(tabId);
  } catch (error) {
    console.error('Failed to reload tab', error);
  }
}

async function ensureTabContext(tabId) {
  const existingHost = tracker.getMainHost(tabId);
  if (existingHost) {
    await refreshObservedHostsFromConfig(tabId, existingHost);
    return existingHost;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const host = tab?.url ? extractHostname(tab.url) : null;
    if (host) {
      const changed = tracker.setMainHost(tabId, host);
      if (changed) {
        observedHostsCache.set(tabId, new Set());
        updateBadgeCount(tabId).catch((error) => {
          console.warn('Failed to reset badge while ensuring context', error);
        });
      }
      await refreshObservedHostsFromConfig(tabId, host);
      return host;
    }
  } catch (error) {
    console.warn('Failed to resolve tab context', error);
  }
  return null;
}

async function updateBadgeCount(tabId) {
  const mainHost = tracker.getMainHost(tabId);
  if (mainHost && isSiteDisabled(mainHost)) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const hostSet = tracker.getObservedHosts(tabId);
  const count = hostSet ? hostSet.size : 0;
  const text = count === 0 ? '' : count > 999 ? '999+' : String(count);
  await chrome.action.setBadgeText({ tabId, text });
}

function isSiteDisabled(host) {
  if (!host) {
    return false;
  }
  return disabledSitesCache.has(StorageService.normalizeHost(host));
}

async function applyDisabledState(normalizedHost, disabled) {
  if (disabled) {
    console.log(`[Service Worker] Disabling site: ${normalizedHost}`);
    // Remove all site-specific blocking rules for this site
    await ruleManager.removeSiteRules(normalizedHost);
    // Resync global rules to add this site to excludedInitiatorDomains
    await ruleManager.syncGlobal(globalConfigCache);
    console.log(`[Service Worker] Global rules resynced to exclude ${normalizedHost}`);
  } else {
    console.log(`[Service Worker] Enabling site: ${normalizedHost}`);
    // Restore blocking rules for this site
    await ruleManager.syncSite(normalizedHost);
    // Also resync global rules to remove this site from exclusions
    await ruleManager.syncGlobal(globalConfigCache);
    console.log(`[Service Worker] Site rules restored for ${normalizedHost}`);
  }

  const tasks = [];
  tracker.tabMainHosts.forEach((host, tabId) => {
    if (StorageService.normalizeHost(host) === normalizedHost) {
      if (disabled) {
        observedHostsCache.set(tabId, new Set());
        tasks.push(
          chrome.action
            .setBadgeText({ tabId, text: '' })
            .catch((error) => console.warn('Failed to clear badge for disabled tab', error))
        );
      } else {
        tasks.push(
          refreshObservedHostsFromConfig(tabId, host).catch((error) =>
            console.warn('Failed to refresh tab after enabling site', error)
          )
        );
      }
    }
  });
  await Promise.allSettled(tasks);
}

function broadcastDisabledUpdate(siteHost, disabled) {
  chrome.runtime.sendMessage(
    {
      type: MESSAGE_TYPES.SITE_DISABLED_CHANGED,
      siteHost,
      disabled
    },
    () => {
      if (chrome.runtime.lastError) {
        // no listeners available
      }
    }
  );
}

function rebuildGlobalStatusIndex() {
  globalStatusIndex = {
    allowed: new Set(globalConfigCache.allowedHosts.map(StorageService.normalizeHost)),
    blocked: new Set(globalConfigCache.blockedHosts.map(StorageService.normalizeHost)),
    pending: new Set(globalConfigCache.pendingHosts.map(StorageService.normalizeHost))
  };
}

function getGlobalStatus(host, mainHost) {
  const normalizedHost = StorageService.normalizeHost(host);
  if (globalStatusIndex.blocked.has(normalizedHost)) {
    return 'blocked';
  }
  if (globalStatusIndex.allowed.has(normalizedHost)) {
    return 'allowed';
  }
  if (globalStatusIndex.pending.has(normalizedHost)) {
    return 'pending';
  }
  if (mainHost) {
    const normalizedMain = StorageService.normalizeHost(mainHost);
    if (normalizedHost === normalizedMain || normalizedHost.endsWith(`.${normalizedMain}`)) {
      return 'allowed';
    }
  }
  return 'pending';
}
