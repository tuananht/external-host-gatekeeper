/* eslint-disable no-undef */

import { StorageService } from './storage.js';
import { RuleManager } from './ruleManager.js';
import { RequestTracker } from './requestTracker.js';
import { SessionStore } from './sessionStore.js';

const MESSAGE_TYPES = {
  GET_SITE_STATE: 'GET_SITE_STATE',
  SAVE_SITE_DECISIONS: 'SAVE_SITE_DECISIONS',
  HOSTS_OBSERVED: 'HOSTS_OBSERVED'
};

const storage = new StorageService();
const ruleManager = new RuleManager(storage);
const tracker = new RequestTracker();
const sessionStore = new SessionStore();

const observedHostsCache = new Map();

initialize();

async function initialize() {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
  } catch (error) {
    console.warn('Failed to set badge background color', error);
  }
  await sessionStore.initialize();
  await ruleManager.initialize();
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
      default:
        return false;
    }
  });
}

async function refreshObservedHostsFromConfig(tabId, siteHost) {
  const siteConfig = await storage.getSite(siteHost);
  const combinedHosts = new Set([
    ...tracker.getObservedHosts(tabId),
    ...sessionStore.getHosts(siteHost),
    ...siteConfig.allowedHosts,
    ...Object.keys(siteConfig.blockedHosts),
    ...(siteConfig.pendingHosts || [])
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
    return { mainHost: null, hosts: [] };
  }

  const siteConfig = await storage.getSite(mainHost);
  const hostSet = observedHostsCache.get(tabId) || new Set();
  const hosts = Array.from(hostSet)
    .map((host) => ({
      host,
      status: determineHostStatus(host, siteConfig, mainHost)
    }))
    .sort((a, b) => a.host.localeCompare(b.host));

  return { mainHost, hosts };
}

function determineHostStatus(host, siteConfig, mainHost) {
  if (siteConfig.blockedHosts[host]) {
    return 'blocked';
  }
  if (siteConfig.allowedHosts.includes(host)) {
    return 'allowed';
  }
  if (siteConfig.pendingHosts && siteConfig.pendingHosts.includes(host)) {
    return 'pending';
  }
  if (host === mainHost || host.endsWith(`.${mainHost}`)) {
    return 'allowed';
  }
  return 'pending';
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
  const hostSet = tracker.getObservedHosts(tabId);
  const count = hostSet ? hostSet.size : 0;
  const text = count === 0 ? '' : count > 999 ? '999+' : String(count);
  await chrome.action.setBadgeText({ tabId, text });
}
