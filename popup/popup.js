const MESSAGE_TYPES = {
  GET_SITE_STATE: 'GET_SITE_STATE',
  SAVE_SITE_DECISIONS: 'SAVE_SITE_DECISIONS',
  HOSTS_OBSERVED: 'HOSTS_OBSERVED'
};

const STATUS_META = [
  { value: 'blocked', label: 'Block', icon: '' },
  { value: 'pending', label: 'Review later', icon: '' },
  { value: 'allowed', label: 'Allow', icon: '' }
];
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

    const toggle = document.createElement('div');
    toggle.className = 'switch-toggle switch-3 switch-candy';
    const groupName = `mode-${HostRow.#sanitizeHost(this.host)}`;

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

    this.root.appendChild(name);
    this.root.appendChild(toggle);
  }

  static #sanitizeHost(host) {
    return host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }
}

class PopupApp {
  constructor() {
    this.saveButton = document.getElementById('save-button');
    this.hostsContainer = document.getElementById('hosts-container');
    this.statusText = document.getElementById('status-text');
    this.siteLabel = document.getElementById('site-label');
    this.toggleLegend = document.getElementById('toggle-legend');
    this.summaryBar = document.getElementById('summary-bar');
    this.summaryBlocked = document.getElementById('summary-blocked');
    this.summaryPending = document.getElementById('summary-pending');
    this.summaryAllowed = document.getElementById('summary-allowed');
    this.mainHost = null;
    this.tabId = null;
    this.rows = new Map();
    this.decisions = new Map();
  }

  async init() {
    this.saveButton.addEventListener('click', () => this.handleSave());
    if (this.hostsContainer) {
      this.hostsContainer.addEventListener('scroll', () => this.adjustLegendPadding());
    }
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === MESSAGE_TYPES.HOSTS_OBSERVED && message.tabId === this.tabId) {
        this.upsertHost(message.host, 'pending');
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
        this.saveButton.disabled = true;
        this.setStatus('');
        return;
      }

      this.mainHost = response.mainHost;
      this.siteLabel.textContent = `Site: ${this.mainHost}`;
      this.hostsContainer.innerHTML = '';
      this.rows.clear();
      this.decisions.clear();

      // Adjust legend alignment immediately in case scrollbar presence changes after content rebuild
      this.adjustLegendPadding();

      const counts = {
        blocked: 0,
        pending: 0,
        allowed: 0
      };

      response.hosts.forEach((hostEntry) => {
        this.upsertHost(hostEntry.host, hostEntry.status);
        if (counts[hostEntry.status] !== undefined) {
          counts[hostEntry.status] += 1;
        }
      });

      this.updateSummary(counts);
      this.adjustLegendPadding();
      this.setStatus('');
    } catch (error) {
      console.error(error);
      this.setStatus('Failed to load hosts');
    }
  }

  upsertHost(host, status) {
    if (this.rows.has(host)) {
      const row = this.rows.get(host);
      row.setStatus(status);
    } else {
      const row = new HostRow(host, status, (targetHost, nextStatus) => {
        this.updateDecision(targetHost, nextStatus);
      });
      this.rows.set(host, row);
      this.hostsContainer.appendChild(row.root);
    }
    this.decisions.set(host, status);
    this.updateSummary(this.calculateSummary());
    this.adjustLegendPadding();
  }

  updateDecision(host, status) {
    this.decisions.set(host, status);
    this.setStatus('');
    this.updateSummary(this.calculateSummary());
    this.adjustLegendPadding();
  }

  updateSummary(counts) {
    const total = counts.allowed + counts.blocked + counts.pending;
    if (total === 0) {
      if (this.summaryBar) {
        this.summaryBar.hidden = true;
      }
      return;
    }
    if (this.summaryBar) {
      this.summaryBar.hidden = false;
    }
    if (this.summaryBlocked) {
      this.summaryBlocked.textContent = String(counts.blocked);
    }
    if (this.summaryPending) {
      this.summaryPending.textContent = String(counts.pending);
    }
    if (this.summaryAllowed) {
      this.summaryAllowed.textContent = String(counts.allowed);
    }
  }

  calculateSummary() {
    const counts = {
      blocked: 0,
      pending: 0,
      allowed: 0
    };
    this.decisions.forEach((status) => {
      if (counts[status] !== undefined) {
        counts[status] += 1;
      }
    });
    return counts;
  }

  adjustLegendPadding() {
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
    if (!this.mainHost || typeof this.tabId !== 'number') {
      return;
    }
    this.saveButton.disabled = true;
    this.setStatus('Applying configuration…');

    const decisions = Array.from(this.decisions.entries()).map(([host, status]) => ({
      host,
      status
    }));

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
    this.statusText.textContent = text || '';
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
