const MESSAGE_TYPES = {
  GET_GLOBAL_CONFIG: 'GET_GLOBAL_CONFIG',
  SAVE_GLOBAL_DECISIONS: 'SAVE_GLOBAL_DECISIONS',
  GLOBAL_CONFIG_UPDATED: 'GLOBAL_CONFIG_UPDATED'
};

const STATUS_META = [
  { value: 'blocked', label: 'Block', icon: '' },
  { value: 'pending', label: 'Review later', icon: '' },
  { value: 'allowed', label: 'Allow', icon: '' }
];

function normalizeHost(host) {
  if (!host || typeof host !== 'string') {
    return '';
  }
  return host.trim().toLowerCase();
}

class HostRow {
  constructor(host, status, onStatusChange, onDelete) {
    this.host = host;
    this.onStatusChange = onStatusChange;
    this.onDelete = onDelete;
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
    const groupName = `global-${HostRow.#sanitizeHost(this.host)}`;

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

    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    actions.appendChild(toggle);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-host';
    deleteButton.textContent = '✕';
    deleteButton.title = 'Remove host';
    deleteButton.setAttribute('aria-label', `Remove ${this.host}`);
    deleteButton.addEventListener('click', () => this.onDelete(this.host));
    actions.appendChild(deleteButton);

    this.root.appendChild(name);
    this.root.appendChild(actions);
  }

  static #sanitizeHost(host) {
    return host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }
}

class GlobalOptionsApp {
  constructor() {
    this.hostsContainer = document.getElementById('hosts-container');
    this.summaryBar = document.getElementById('summary-bar');
    this.summaryBlocked = document.getElementById('summary-blocked');
    this.summaryPending = document.getElementById('summary-pending');
    this.summaryAllowed = document.getElementById('summary-allowed');
    this.statusText = document.getElementById('status-text');
    this.addHostInput = document.getElementById('host-input');
    this.addHostButton = document.getElementById('add-host');
    this.saveButton = document.getElementById('save-button');
    this.toggleLegend = document.getElementById('toggle-legend');
    this.searchInput = document.getElementById('search-input');
    this.errorLabel = document.getElementById('host-error');

    this.rows = new Map(); // normalized host -> HostRow
    this.decisions = new Map(); // normalized host -> status
  }

  async init() {
    this.addHostButton?.addEventListener('click', () => this.handleAddHost());
    this.addHostInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.handleAddHost();
      }
    });
    this.searchInput?.addEventListener('input', () => this.applySearch());
    this.saveButton?.addEventListener('click', () => this.handleSave());
    this.hostsContainer?.addEventListener('scroll', () => this.adjustLegendPadding());

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === MESSAGE_TYPES.GLOBAL_CONFIG_UPDATED) {
        this.applyConfig(message.config);
      }
    });

    await this.loadConfig();
  }

  async loadConfig() {
    this.setStatus('Loading global configuration…');
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_GLOBAL_CONFIG });
      if (response?.error) {
        throw new Error(response.error);
      }
      this.applyConfig(response?.config);
      this.setStatus('');
    } catch (error) {
      console.error(error);
      this.setStatus('Failed to load configuration');
    }
  }

  applyConfig(config) {
    this.hostsContainer.innerHTML = '';
    this.rows.clear();
    this.decisions.clear();

    if (!config) {
      this.updateSummary(this.calculateSummary());
      this.adjustLegendPadding();
      this.applySearch();
      return;
    }

    (config.blockedHosts || []).forEach((host) => {
      const normalized = normalizeHost(host);
      this.decisions.set(normalized, 'blocked');
      this.upsertHost(normalized, 'blocked');
    });
    (config.allowedHosts || []).forEach((host) => {
      const normalized = normalizeHost(host);
      this.decisions.set(normalized, 'allowed');
      this.upsertHost(normalized, 'allowed');
    });
    (config.pendingHosts || []).forEach((host) => {
      const normalized = normalizeHost(host);
      this.decisions.set(normalized, 'pending');
      this.upsertHost(normalized, 'pending');
    });

    this.updateSummary(this.calculateSummary());
    this.adjustLegendPadding();
    this.applySearch();
  }

  upsertHost(host, status) {
    const normalized = normalizeHost(host);
    let row = this.rows.get(normalized);
    if (row) {
      row.setStatus(status);
    } else {
      row = new HostRow(normalized, status, (targetHost, nextStatus) => this.updateDecision(targetHost, nextStatus), (targetHost) => this.deleteHost(targetHost));
      this.rows.set(normalized, row);
      this.hostsContainer.appendChild(row.root);
    }
    this.decisions.set(normalized, status);
  }

  updateDecision(host, status) {
    const normalized = normalizeHost(host);
    this.decisions.set(normalized, status);
    this.updateSummary(this.calculateSummary());
  }

  deleteHost(host) {
    const normalized = normalizeHost(host);
    const row = this.rows.get(normalized);
    if (row) {
      row.root.remove();
      this.rows.delete(normalized);
    }
    this.decisions.delete(normalized);
    this.updateSummary(this.calculateSummary());
    this.applySearch();
    this.setStatus(`Removed ${normalized} from global defaults.`);
  }

  handleAddHost() {
    const value = normalizeHost(this.addHostInput?.value || '');
    if (!this.#isValidHost(value)) {
      this.showError('Enter a valid host (e.g., example.com).');
      return;
    }
    this.showError('');
    this.decisions.set(value, 'blocked');
    this.upsertHost(value, 'blocked');
    if (this.addHostInput) {
      this.addHostInput.value = '';
    }
    this.setStatus(`Added ${value} as globally blocked.`);
    this.updateSummary(this.calculateSummary());
    this.applySearch();
  }

  async handleSave() {
    if (this.saveButton) {
      this.saveButton.disabled = true;
    }
    this.setStatus('Saving global configuration…');
    const decisions = Array.from(this.decisions.entries()).map(([host, status]) => ({ host, status }));
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_GLOBAL_DECISIONS,
        decisions
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      this.applyConfig(response?.config);
      this.showError('');
      this.setStatus('Global configuration saved.');
    } catch (error) {
      console.error(error);
      this.setStatus('Failed to save configuration');
    } finally {
      if (this.saveButton) {
        this.saveButton.disabled = false;
      }
    }
  }

  updateSummary(counts) {
    const total = counts.allowed + counts.blocked + counts.pending;
    if (this.summaryBar) {
      this.summaryBar.hidden = total === 0;
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
    const counts = { blocked: 0, pending: 0, allowed: 0 };
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

  setStatus(text) {
    if (this.statusText) {
      this.statusText.textContent = text || '';
    }
  }

  showError(message) {
    if (this.errorLabel) {
      this.errorLabel.textContent = message || '';
    }
  }

  applySearch() {
    if (!this.searchInput) {
      return;
    }
    const query = this.searchInput.value.trim().toLowerCase();
    this.rows.forEach((row, host) => {
      const matches = !query || host.includes(query);
      row.root.style.display = matches ? '' : 'none';
    });
  }

  #isValidHost(host) {
    if (!host) {
      return false;
    }
    const hostPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
    return hostPattern.test(host);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new GlobalOptionsApp();
  app.init().catch((error) => {
    console.error(error);
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = 'Failed to initialise settings page';
    }
  });
});
