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
  constructor(host, status, onStatusChange) {
    this.host = host;
    this.onStatusChange = onStatusChange;
    this.root = document.createElement('div');
    this.root.className = 'host-entry';
    this.inputs = new Map();
    this.selectedStatus = status;
    this.#build();
    this.setStatus(status);
  }

  setStatus(status) {
    this.selectedStatus = status;
    this.inputs.forEach((input, key) => {
      input.checked = key === status;
    });
  }

  #build() {
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

    this.root.appendChild(name);
    this.root.appendChild(actions);
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
    this.isDisabled = false;
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
        this.upsertHost(message.host, normalized, effective);
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
        if (hostEntry.localStatus !== null && hostEntry.localStatus !== undefined) {
          this.localSelections.set(normalized, hostEntry.localStatus);
          this.originalSiteConfig.add(normalized); // Track hosts with site-specific config
        }
        this.globalStatuses.set(normalized, globalStatus);
        const effective = this.getEffectiveStatus(normalized);
        this.upsertHost(displayHost, normalized, effective);
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

  upsertHost(displayHost, normalized, effectiveStatus) {
    if (this.isDisabled) {
      return;
    }
    let row = this.rows.get(normalized);
    if (row) {
      row.setStatus(effectiveStatus);
    } else {
      row = new HostRow(displayHost, effectiveStatus, (host, status) => this.updateDecision(host, status));
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
    } else {
      this.localSelections.set(normalized, status);
    }
    const effective = this.getEffectiveStatus(normalized);
    const row = this.rows.get(normalized);
    if (row) {
      row.setStatus(effective);
    }
    this.setStatus('');
    this.updateSummary();
    this.applySearch();
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
    this.saveButton.disabled = true;
    this.setStatus('Applying configuration…');

    // Send ALL hosts that need site-specific config or had it originally
    // This ensures hosts transitioning from site-specific to global are properly cleared
    const decisions = [];
    this.rows.forEach((row, normalized) => {
      const effectiveStatus = this.getEffectiveStatus(normalized);
      const globalStatus = this.globalStatuses.get(normalized) || DEFAULT_STATUS;
      
      // Send if: 1) different from global (needs override), OR 2) originally had site-specific config
      if (effectiveStatus !== globalStatus || this.originalSiteConfig.has(normalized)) {
        decisions.push({
          host: normalized,
          status: effectiveStatus
        });
      }
    });

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_SITE_DECISIONS,
        tabId: this.tabId,
        mainHost: this.mainHost,
        decisions
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      this.setStatus('Saved. Refreshing tab…');
      window.close();
    } catch (error) {
      console.error(error);
      this.setStatus('Failed to save configuration');
      this.saveButton.disabled = false;
    }
  }

  setStatus(text) {
    if (this.statusText) {
      this.statusText.textContent = text || '';
    }
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
    (config.blockedHosts || []).forEach((host) => updated.set(normalizeHost(host), 'blocked'));
    (config.allowedHosts || []).forEach((host) => updated.set(normalizeHost(host), 'allowed'));
    (config.pendingHosts || []).forEach((host) => {
      const normalized = normalizeHost(host);
      if (!updated.has(normalized)) {
        updated.set(normalized, 'pending');
      }
    });
    this.globalStatuses = updated;

    this.rows.forEach((row, normalized) => {
      const globalStatus = this.globalStatuses.get(normalized) || DEFAULT_STATUS;
      if (this.localSelections.get(normalized) === globalStatus) {
        this.localSelections.delete(normalized);
      }
      const effective = this.getEffectiveStatus(normalized);
      row.setStatus(effective);
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
    this.toggleSiteButton.textContent = this.isDisabled ? 'Enable for this site' : 'Disable for this site';
  }

  renderDisabledState() {
    this.rows.clear();
    this.localSelections.clear();
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
