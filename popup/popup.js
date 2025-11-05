const MESSAGE_TYPES = {
  GET_SITE_STATE: 'GET_SITE_STATE',
  SAVE_SITE_DECISIONS: 'SAVE_SITE_DECISIONS',
  HOSTS_OBSERVED: 'HOSTS_OBSERVED',
  ADD_GLOBAL_HOST: 'ADD_GLOBAL_HOST',
  GLOBAL_CONFIG_UPDATED: 'GLOBAL_CONFIG_UPDATED',
  DISABLE_SITE: 'DISABLE_SITE',
  ENABLE_SITE: 'ENABLE_SITE',
  SITE_DISABLED_CHANGED: 'SITE_DISABLED_CHANGED'
};

const STATUS_META = [
  { value: 'blocked', label: 'Block', icon: '' },
  { value: 'pending', label: 'Review later', icon: '' },
  { value: 'allowed', label: 'Allow', icon: '' }
];

const DEFAULT_STATUS = 'pending';

function normalizeHost(host) {
  if (!host || typeof host !== 'string') {
    return '';
  }
  return host.trim().toLowerCase();
}

class HostRow {
  constructor(host, status, source, onStatusChange, onAddToGlobal) {
    this.host = host;
    this.source = source;
    this.onStatusChange = onStatusChange;
    this.onAddToGlobal = onAddToGlobal;
    this.root = document.createElement('div');
    this.root.className = 'host-entry';
    this.inputs = new Map();
    this.selectedStatus = status;
    this.sourceElement = null;
    this.addGlobalButton = null;
    this.sourceContainer = null;
    this.#build();
    this.setStatus(status);
  }

  setStatus(status) {
    this.selectedStatus = status;
    this.inputs.forEach((input, key) => {
      input.checked = key === status;
    });
  }

  setSource(source) {
    this.source = source;
    if (this.sourceElement) {
      this.sourceElement.textContent = source;
      this.sourceElement.className = 'host-source';
      if (source) {
        this.sourceElement.classList.add(source.toLowerCase());
      }
    }
    this.updateAddToGlobalVisibility();
  }

  updateAddToGlobalVisibility() {
    if (!this.onAddToGlobal || !this.sourceContainer) {
      return;
    }
    const showButton = this.source === 'Site' || this.source === 'New';
    if (showButton) {
      if (!this.addGlobalButton) {
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'add-global-button';
        addButton.textContent = '+';
        addButton.title = 'Add to global rules';
        addButton.setAttribute('aria-label', 'Add host to global rules');
        addButton.addEventListener('click', () => {
          if (!this.onAddToGlobal) {
            return;
          }
          addButton.disabled = true;
          Promise.resolve(this.onAddToGlobal(this.host))
            .catch((error) => {
              console.error('Failed to add host to global', error);
            })
            .finally(() => {
              if (this.addGlobalButton === addButton) {
                this.addGlobalButton.disabled = false;
              }
              this.updateAddToGlobalVisibility();
            });
        });
        this.addGlobalButton = addButton;
        this.sourceContainer.appendChild(addButton);
      }
    } else if (this.addGlobalButton) {
      this.addGlobalButton.remove();
      this.addGlobalButton = null;
    }
  }

  #build() {
    const sourceLabel = document.createElement('span');
    sourceLabel.className = 'host-source';
    sourceLabel.textContent = this.source || '';
    if (this.source) {
      sourceLabel.classList.add(this.source.toLowerCase());
    }
    this.sourceElement = sourceLabel;

    const sourceContainer = document.createElement('div');
    sourceContainer.className = 'host-source-container';
    sourceContainer.appendChild(sourceLabel);
    this.sourceContainer = sourceContainer;

    const name = document.createElement('span');
    name.className = 'host-name';
    name.textContent = this.host;

    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const toggle = document.createElement('div');
    toggle.className = 'switch-toggle switch-3 switch-candy';
    const groupName = `mode-${HostRow.sanitizeHost(this.host)}`;

    STATUS_META.forEach((option, index) => {
      const inputId = `${groupName}-${option.value}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.id = inputId;
      input.name = groupName;
      input.value = option.value;
      input.dataset.index = String(index);
      input.addEventListener('change', () => {
        if (input.checked) {
          this.selectedStatus = option.value;
          this.onStatusChange(this.host, option.value);
        }
      });
      toggle.appendChild(input);
      this.inputs.set(option.value, input);

      const label = document.createElement('label');
      label.htmlFor = inputId;
      label.title = option.label;
      label.textContent = option.icon;
      toggle.appendChild(label);
    });

    const slider = document.createElement('span');
    slider.className = 'switch-slider';
    slider.setAttribute('aria-hidden', 'true');
    toggle.appendChild(slider);

    actions.appendChild(toggle);

    this.root.appendChild(sourceContainer);
    this.root.appendChild(name);
    this.root.appendChild(actions);
    this.updateAddToGlobalVisibility();
  }

  static sanitizeHost(host) {
    return host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }
}

class PopupApp {
  constructor() {
    this.saveButton = document.getElementById('save-button');
    this.settingsButton = document.getElementById('settings-button');
    this.toggleSiteButton = document.getElementById('toggle-site-button');
    this.hostsContainer = document.getElementById('hosts-container');
    this.searchInput = document.getElementById('search-input');
    this.statusText = document.getElementById('status-text');
    this.siteLabel = document.getElementById('site-label');
    this.toggleLegend = document.getElementById('toggle-legend');
    this.summaryBar = document.getElementById('summary-bar');
    this.summaryBlocked = document.getElementById('summary-blocked');
    this.summaryPending = document.getElementById('summary-pending');
    this.summaryAllowed = document.getElementById('summary-allowed');

    this.mainHost = null;
    this.tabId = null;
    this.rows = new Map(); // normalizedHost -> HostRow
    this.localSelections = new Map(); // normalizedHost -> status
    this.globalStatuses = new Map(); // normalizedHost -> status
    this.originalSiteConfig = new Set(); // hosts that had site-specific config when loaded
    this.hasExplicitGlobal = new Set(); // hosts that have explicit global config
    this.promotedToGlobal = new Set(); // hosts promoted to global during current session
    this.clearedSiteConfig = new Set(); // hosts whose site config should be cleared on save
    this.isDisabled = false;
    this.autoSaveTimer = null;
    this.autoSavePending = false;
    this.isPersisting = false;
    this.currentPersistPromise = null;
    this.statusClearTimer = null;
  }

  async init() {
    this.saveButton?.addEventListener('click', () => this.handleSave());
    this.settingsButton?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage().catch((error) => {
        console.error('Failed to open options page', error);
      });
    });
    this.toggleSiteButton?.addEventListener('click', () => this.handleToggleSite());
    this.hostsContainer?.addEventListener('scroll', () => this.adjustLegendPadding());
    this.searchInput?.addEventListener('input', () => this.applySearch());

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === MESSAGE_TYPES.HOSTS_OBSERVED && message.tabId === this.tabId) {
        if (this.isDisabled) {
          return;
        }
        const normalized = normalizeHost(message.host);
        const globalStatus = this.globalStatuses.get(normalized) || DEFAULT_STATUS;
        this.globalStatuses.set(normalized, globalStatus);
        const effective = this.getEffectiveStatus(normalized);
        // For dynamically detected hosts, pass null as hostEntry (will be treated as new if appropriate)
        this.upsertHost(message.host, normalized, effective, null);
      } else if (message?.type === MESSAGE_TYPES.GLOBAL_CONFIG_UPDATED) {
        this.refreshGlobalStatuses(message.config);
      } else if (message?.type === MESSAGE_TYPES.SITE_DISABLED_CHANGED) {
        if (!this.mainHost) {
          return;
        }
        if (normalizeHost(this.mainHost) === normalizeHost(message.siteHost)) {
          this.isDisabled = !!message.disabled;
          this.updateSiteToggleButton();
          if (this.isDisabled) {
            this.renderDisabledState();
          } else {
            this.loadState();
          }
        }
      }
    });

    await this.resolveActiveTab();
    await this.loadState();
  }

  async resolveActiveTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      throw new Error('Unable to resolve active tab');
    }
    this.tabId = activeTab.id;
  }

  async loadState() {
    this.setStatus('Loading detected hosts…');
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_SITE_STATE,
        tabId: this.tabId
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      if (!response?.mainHost) {
        this.siteLabel.textContent = 'No site detected';
        this.hostsContainer.textContent =
          'Open this popup while viewing a site to review its third-party hosts.';
        if (this.saveButton) {
          this.saveButton.disabled = true;
        }
        this.isDisabled = false;
        this.rows.clear();
        this.localSelections.clear();
        if (this.searchInput) {
          this.searchInput.value = '';
          this.searchInput.disabled = true;
        }
        this.updateSiteToggleButton();
        this.setStatus('');
        return;
      }

      this.mainHost = response.mainHost;
      if (this.saveButton) {
        this.saveButton.disabled = false;
      }
      this.siteLabel.textContent = `Site: ${this.mainHost}`;

      this.isDisabled = !!response.disabled;
      this.updateSiteToggleButton();
      this.rows.clear();
      this.localSelections.clear();
      this.globalStatuses.clear();
      this.originalSiteConfig.clear();
      this.hasExplicitGlobal.clear();
      this.promotedToGlobal.clear();
      this.clearedSiteConfig.clear();

      if (this.isDisabled) {
        this.renderDisabledState();
        return;
      }

      this.clearDisabledState();
      this.hostsContainer.innerHTML = '';

      if (response.globalStatuses) {
        Object.entries(response.globalStatuses).forEach(([host, status]) => {
          this.globalStatuses.set(normalizeHost(host), status);
        });
      }

      (response.hosts || []).forEach((hostEntry) => {
        const displayHost = hostEntry.host;
        const normalized = normalizeHost(displayHost);
        const globalStatus =
          hostEntry.globalStatus || this.globalStatuses.get(normalized) || DEFAULT_STATUS;
        
        // Track hosts with site-specific config (blocked or allowed, not pending)
        if (hostEntry.localStatus !== null && hostEntry.localStatus !== undefined) {
          this.localSelections.set(normalized, hostEntry.localStatus);
          this.originalSiteConfig.add(normalized); // Has site-specific config
        }
        
        // Track hosts with explicit global config
        if (hostEntry.hasExplicitGlobalConfig) {
          this.hasExplicitGlobal.add(normalized);
        }
        
        this.globalStatuses.set(normalized, globalStatus);
        const effective = this.getEffectiveStatus(normalized);
        this.upsertHost(displayHost, normalized, effective, hostEntry);
      });

      this.updateSummary();
      this.adjustLegendPadding();
      this.applySearch();
      this.setStatus('');
    } catch (error) {
      console.error(error);
      this.setStatus('Failed to load hosts');
    }
  }

  upsertHost(displayHost, normalized, effectiveStatus, hostEntry = null) {
    if (this.isDisabled) {
      return;
    }
    
    // Determine source:
    // 1. "Site" if host has site-specific config (in originalSiteConfig or localSelections)
    // 2. "New" if host is newly detected (no config anywhere)
    // 3. "Global" if host uses explicit global config
    let source;
    
    const hasSiteConfig = this.originalSiteConfig.has(normalized);
    const hasLocalOverride = this.localSelections.has(normalized);
    const isPromoted = this.promotedToGlobal.has(normalized);
    const hasExplicitGlobalConfig =
      hostEntry?.hasExplicitGlobalConfig || this.hasExplicitGlobal.has(normalized) || false;
    
    if (hasLocalOverride) {
      source = 'Site';
    } else if (isPromoted) {
      source = 'Global';
    } else if (hasSiteConfig) {
      source = 'Site';
    } else if (hasExplicitGlobalConfig) {
      // Has explicit global config (blocked or allowed globally)
      source = 'Global';
    } else {
      // No config anywhere - newly detected host
      source = 'New';
    }
    
    let row = this.rows.get(normalized);
    if (row) {
      row.setStatus(effectiveStatus);
      row.setSource(source);
    } else {
      row = new HostRow(
        displayHost,
        effectiveStatus,
        source,
        (host, status) => this.updateDecision(host, status),
        (host) => this.handleAddToGlobal(host)
      );
      this.rows.set(normalized, row);
      this.hostsContainer.appendChild(row.root);
    }
    this.applySearch();
  }

  updateDecision(host, status) {
    if (this.isDisabled) {
      return;
    }
    const normalized = normalizeHost(host);
    const globalStatus = this.globalStatuses.get(normalized) || DEFAULT_STATUS;
    if (status === globalStatus) {
      this.localSelections.delete(normalized);
      if (this.promotedToGlobal.has(normalized)) {
        this.clearedSiteConfig.add(normalized);
      }
    } else {
      this.localSelections.set(normalized, status);
      this.promotedToGlobal.delete(normalized);
      this.clearedSiteConfig.delete(normalized);
      this.originalSiteConfig.add(normalized);
    }
    const effective = this.getEffectiveStatus(normalized);
    const row = this.rows.get(normalized);
    if (row) {
      row.setStatus(effective);
      
      // Update source based on current state
      let source;
      const hasSiteConfig = this.originalSiteConfig.has(normalized);
      const hasLocalOverride = this.localSelections.has(normalized);
      if (hasLocalOverride) {
        source = 'Site';
      } else if (this.promotedToGlobal.has(normalized)) {
        source = 'Global';
      } else if (hasSiteConfig) {
        source = 'Site';
      } else {
        const hasExplicitGlobal = this.hasExplicitGlobal.has(normalized);
        source = hasExplicitGlobal ? 'Global' : 'New';
      }
      row.setSource(source);
    }
    this.setStatus('');
    this.updateSummary();
    this.scheduleAutoSave();
    this.applySearch();
  }

  collectSiteDecisions() {
    const decisions = [];
    this.rows.forEach((row, normalized) => {
      if (this.clearedSiteConfig.has(normalized)) {
        decisions.push({
          host: normalized,
          status: 'pending'
        });
        return;
      }
      const effectiveStatus = this.getEffectiveStatus(normalized);
      const globalStatus = this.globalStatuses.get(normalized) || DEFAULT_STATUS;
      if (effectiveStatus !== globalStatus || this.originalSiteConfig.has(normalized)) {
        decisions.push({
          host: normalized,
          status: effectiveStatus
        });
      }
    });
    return decisions;
  }

  cancelAutoSaveTimer() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  scheduleAutoSave() {
    if (this.isDisabled) {
      return;
    }
    if (!this.mainHost || typeof this.tabId !== 'number') {
      return;
    }
    this.cancelAutoSaveTimer();
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      this.triggerAutoSave();
    }, 300);
  }

  async triggerAutoSave() {
    if (this.isPersisting) {
      this.autoSavePending = true;
      return;
    }
    try {
      await this.persistDecisions({
        reload: false,
        closePopup: false,
        disableButton: false,
        statusMessages: {
          success: 'Changes saved',
          error: 'Failed to save changes'
        },
        autoClearStatus: 2000
      });
    } catch (error) {
      // Error already logged in persistDecisions
    } finally {
      if (this.autoSavePending) {
        this.autoSavePending = false;
        this.triggerAutoSave();
      }
    }
  }

  async persistDecisions(options = {}) {
    if (this.isDisabled) {
      return;
    }
    if (!this.mainHost || typeof this.tabId !== 'number') {
      return;
    }

    const {
      reload = false,
      closePopup = false,
      disableButton = false,
      statusMessages = {},
      autoClearStatus = null
    } = options;

    const decisions = this.collectSiteDecisions();
    if (!decisions.length) {
      this.originalSiteConfig = new Set(this.localSelections.keys());
      this.clearedSiteConfig.clear();
      if (statusMessages.success) {
        this.setStatus(statusMessages.success);
        if (autoClearStatus) {
          this.scheduleStatusClear(autoClearStatus);
        }
      }
      return;
    }

    if (this.isPersisting) {
      this.autoSavePending = true;
      return;
    }

    this.isPersisting = true;
    if (disableButton && this.saveButton) {
      this.saveButton.disabled = true;
    }
    if (statusMessages.pending) {
      this.setStatus(statusMessages.pending);
    }

    const message = {
      type: MESSAGE_TYPES.SAVE_SITE_DECISIONS,
      tabId: this.tabId,
      mainHost: this.mainHost,
      decisions,
      reload
    };

    const persistPromise = (async () => {
      try {
        const response = await chrome.runtime.sendMessage(message);
        if (response?.error) {
          throw new Error(response.error);
        }

        this.originalSiteConfig = new Set(this.localSelections.keys());
        this.clearedSiteConfig.clear();

        if (statusMessages.success) {
          this.setStatus(statusMessages.success);
        } else if (reload) {
          this.setStatus('Saved');
        }
        if (autoClearStatus && !reload) {
          this.scheduleStatusClear(autoClearStatus);
        }

        if (reload && closePopup) {
          window.close();
        }
      } catch (error) {
        console.error(error);
        if (statusMessages.error) {
          this.setStatus(statusMessages.error);
        }
        throw error;
      } finally {
        if (disableButton && this.saveButton) {
          this.saveButton.disabled = false;
        }
        this.isPersisting = false;
      }
    })();

    this.currentPersistPromise = persistPromise;
    try {
      await persistPromise;
    } finally {
      if (this.currentPersistPromise === persistPromise) {
        this.currentPersistPromise = null;
      }
      if (this.autoSavePending && !reload) {
        const shouldRetry = this.autoSavePending;
        this.autoSavePending = false;
        if (shouldRetry) {
          this.triggerAutoSave();
        }
      }
    }
  }

  updateSummary() {
    if (this.isDisabled) {
      if (this.summaryBar) {
        this.summaryBar.hidden = true;
      }
      return;
    }
    let blocked = 0;
    let pending = 0;
    let allowed = 0;

    this.rows.forEach((row) => {
      const status = row.selectedStatus || DEFAULT_STATUS;
      if (status === 'blocked') {
        blocked += 1;
      } else if (status === 'allowed') {
        allowed += 1;
      } else {
        pending += 1;
      }
    });

    const total = blocked + pending + allowed;
    if (this.summaryBar) {
      this.summaryBar.hidden = total === 0;
    }
    if (this.summaryBlocked) {
      this.summaryBlocked.textContent = String(blocked);
    }
    if (this.summaryPending) {
      this.summaryPending.textContent = String(pending);
    }
    if (this.summaryAllowed) {
      this.summaryAllowed.textContent = String(allowed);
    }
  }

  async handleAddToGlobal(host) {
    if (this.isDisabled) {
      return;
    }
    const normalized = normalizeHost(host);
    if (!normalized) {
      return;
    }
    const row = this.rows.get(normalized);
    const selectedStatus = row?.selectedStatus || this.getEffectiveStatus(normalized);
    this.setStatus('Adding to global settings…');

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.ADD_GLOBAL_HOST,
        host,
        status: selectedStatus
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      if (response?.config) {
        this.refreshGlobalStatuses(response.config);
      } else {
        this.globalStatuses.set(normalized, selectedStatus);
        this.hasExplicitGlobal.add(normalized);
      }

      this.promotedToGlobal.add(normalized);
      this.clearedSiteConfig.add(normalized);
      this.originalSiteConfig.delete(normalized);
      this.localSelections.delete(normalized);

      const updatedRow = this.rows.get(normalized);
      if (updatedRow) {
        const effective = this.getEffectiveStatus(normalized);
        updatedRow.setStatus(effective);
        updatedRow.setSource('Global');
      }

      this.updateSummary();
      this.applySearch();
      this.setStatus('Added to global settings');
      this.scheduleAutoSave();
    } catch (error) {
      console.error(error);
      this.setStatus('Failed to add to global settings');
    }
  }

  adjustLegendPadding() {
    if (this.isDisabled) {
      return;
    }
    if (!this.hostsContainer || !this.toggleLegend) {
      return;
    }
    const scrollable = this.hostsContainer.scrollHeight > this.hostsContainer.clientHeight + 1;
    const scrollbarWidth = scrollable
      ? this.hostsContainer.offsetWidth - this.hostsContainer.clientWidth
      : 0;
    this.toggleLegend.style.paddingRight = `${scrollbarWidth}px`;
  }

  async handleSave() {
    if (this.isDisabled) {
      return;
    }
    if (!this.mainHost || typeof this.tabId !== 'number') {
      return;
    }
    this.cancelAutoSaveTimer();
    if (this.currentPersistPromise) {
      try {
        await this.currentPersistPromise;
      } catch (error) {
        // Ignore errors from prior auto-saves; status already set
      }
    }
    try {
      await this.persistDecisions({
        reload: true,
        closePopup: true,
        disableButton: true,
        statusMessages: {
          pending: 'Applying configuration…',
          success: 'Saved. Refreshing tab…',
          error: 'Failed to save configuration'
        }
      });
    } catch (error) {
      // Error details are logged in persistDecisions
    }
  }

  setStatus(text) {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
      this.statusClearTimer = null;
    }
    if (this.statusText) {
      this.statusText.textContent = text || '';
    }
  }

  scheduleStatusClear(delay = 2000) {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
    }
    this.statusClearTimer = setTimeout(() => {
      this.statusClearTimer = null;
      if (this.statusText) {
        this.statusText.textContent = '';
      }
    }, delay);
  }

  getEffectiveStatus(normalized) {
    if (this.localSelections.has(normalized)) {
      return this.localSelections.get(normalized);
    }
    return this.globalStatuses.get(normalized) || DEFAULT_STATUS;
  }

  refreshGlobalStatuses(config) {
    if (!config) {
      return;
    }
    if (this.isDisabled) {
      return;
    }
    const updated = new Map();
    const explicitGlobal = new Set();
    (config.blockedHosts || []).forEach((host) => {
      const normalized = normalizeHost(host);
      updated.set(normalized, 'blocked');
      explicitGlobal.add(normalized);
    });
    (config.allowedHosts || []).forEach((host) => {
      const normalized = normalizeHost(host);
      updated.set(normalized, 'allowed');
      explicitGlobal.add(normalized);
    });
    (config.pendingHosts || []).forEach((host) => {
      const normalized = normalizeHost(host);
      if (!updated.has(normalized)) {
        updated.set(normalized, 'pending');
      }
      explicitGlobal.add(normalized);
    });
    this.globalStatuses = updated;
    this.hasExplicitGlobal = explicitGlobal;

    const retainedPromoted = new Set();
    const retainedCleared = new Set();
    this.promotedToGlobal.forEach((host) => {
      if (explicitGlobal.has(host)) {
        retainedPromoted.add(host);
        if (this.clearedSiteConfig.has(host)) {
          retainedCleared.add(host);
        }
      }
    });
    this.promotedToGlobal = retainedPromoted;
    this.clearedSiteConfig = retainedCleared;

    this.rows.forEach((row, normalized) => {
      const globalStatus = this.globalStatuses.get(normalized) || DEFAULT_STATUS;
      if (this.localSelections.get(normalized) === globalStatus) {
        this.localSelections.delete(normalized);
      }
      const effective = this.getEffectiveStatus(normalized);
      row.setStatus(effective);

      let source;
      const hasSiteConfig = this.originalSiteConfig.has(normalized);
      const hasLocalOverride = this.localSelections.has(normalized);
      if (hasLocalOverride) {
        source = 'Site';
      } else if (this.promotedToGlobal.has(normalized)) {
        source = 'Global';
      } else if (hasSiteConfig) {
        source = 'Site';
      } else {
        const hasExplicit = this.hasExplicitGlobal.has(normalized);
        source = hasExplicit ? 'Global' : 'New';
      }
      row.setSource(source);
    });
    this.updateSummary();
    this.setStatus('');
    this.applySearch();
  }

  applySearch() {
    if (this.isDisabled) {
      return;
    }
    if (!this.searchInput) {
      return;
    }
    const query = this.searchInput.value.trim().toLowerCase();
    this.rows.forEach((row, normalized) => {
      const matches = !query || normalized.includes(query);
      row.root.style.display = matches ? '' : 'none';
    });
  }

  updateSiteToggleButton() {
    if (!this.toggleSiteButton) {
      return;
    }
    if (!this.mainHost) {
      this.toggleSiteButton.disabled = true;
      this.toggleSiteButton.textContent = 'Disable for this site';
      return;
    }
    this.toggleSiteButton.disabled = false;
    this.toggleSiteButton.textContent = this.isDisabled ? 'Enable' : 'Disable';
  }

  renderDisabledState() {
    this.rows.clear();
    this.localSelections.clear();
    this.globalStatuses.clear();
    this.originalSiteConfig.clear();
    this.hasExplicitGlobal.clear();
    this.promotedToGlobal.clear();
    this.clearedSiteConfig.clear();
    if (this.searchInput) {
      this.searchInput.value = '';
      this.searchInput.disabled = true;
    }
    if (this.saveButton) {
      this.saveButton.disabled = true;
    }
    if (this.hostsContainer) {
      this.hostsContainer.innerHTML = '<div class="disabled-message">This extension is disabled for this site.</div>';
    }
    if (this.summaryBar) {
      this.summaryBar.hidden = true;
    }
    this.setStatus('Extension disabled for this site');
  }

  clearDisabledState() {
    if (this.searchInput) {
      this.searchInput.disabled = false;
    }
    if (this.saveButton) {
      this.saveButton.disabled = false;
    }
    if (this.hostsContainer) {
      this.hostsContainer.innerHTML = '';
    }
    if (this.summaryBar) {
      this.summaryBar.hidden = true;
    }
  }

  async handleToggleSite() {
    if (!this.mainHost) {
      return;
    }
    const messageType = this.isDisabled ? MESSAGE_TYPES.ENABLE_SITE : MESSAGE_TYPES.DISABLE_SITE;
    this.toggleSiteButton.disabled = true;
    this.setStatus(this.isDisabled ? 'Enabling…' : 'Disabling…');
    try {
      const response = await chrome.runtime.sendMessage({
        type: messageType,
        siteHost: this.mainHost
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      await this.loadState();
    } catch (error) {
      console.error(error);
      this.setStatus('Failed to toggle site state');
    } finally {
      this.toggleSiteButton.disabled = false;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new PopupApp();
  app.init().catch((error) => {
    console.error(error);
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = 'Popup initialisation failed';
    }
  });
});
