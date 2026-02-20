// Side panel script for displaying all tabs

let allTabs = [];
let filteredTabs = [];

// Load all tabs
async function loadTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    allTabs = tabs;
    filteredTabs = tabs;
    renderTabs();
  } catch (error) {
    console.error('Error loading tabs:', error);
    showError('Failed to load tabs');
  }
}

// Display tabs
function renderTabs() {
  const tabsList = document.getElementById('tabsList');
  
  if (filteredTabs.length === 0) {
    tabsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📑</div>
        <div class="empty-state-text">No tabs found</div>
      </div>
    `;
    return;
  }

  // Get current active tab
  chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
    tabsList.innerHTML = filteredTabs.map(tab => {
      const isActive = tab.id === activeTab?.id;
      const faviconUrl = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999"/></svg>';
      const tabTitle = tab.title || 'Untitled';
      
      return `
        <div class="tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" title="${escapeHtml(tabTitle)}">
          <img src="${faviconUrl}" alt="" class="tab-favicon" onerror="this.style.display='none'">
          <div class="tab-actions">
            <button class="tab-action-btn" title="Close" data-action="close">✕</button>
          </div>
        </div>
      `;
    }).join('');

    // Add event handlers
    attachEventListeners();
  });
}

// Attach event handlers
function attachEventListeners() {
  // Click on tab - switch to it
  document.querySelectorAll('.tab-item').forEach(item => {
    const tabId = parseInt(item.dataset.tabId);
    
    item.addEventListener('click', (e) => {
      // Ignore clicks on action buttons
      if (e.target.closest('.tab-actions')) {
        return;
      }
      
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update((async () => {
        const tab = await chrome.tabs.get(tabId);
        return tab.windowId;
      })(), { focused: true });
    });
  });

  // Action buttons
  document.querySelectorAll('.tab-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabItem = btn.closest('.tab-item');
      const tabId = parseInt(tabItem.dataset.tabId);
      const action = btn.dataset.action;

      if (action === 'close') {
        chrome.tabs.remove(tabId).then(() => {
          loadTabs(); // Reload list
        });
      }
    });
  });
}

// Search tabs
function filterTabs(searchTerm) {
  if (!searchTerm.trim()) {
    filteredTabs = allTabs;
  } else {
    const term = searchTerm.toLowerCase();
    filteredTabs = allTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      return title.includes(term) || url.includes(term);
    });
  }
  renderTabs();
}

// HTML escaping
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show error
function showError(message) {
  const tabsList = document.getElementById('tabsList');
  tabsList.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">${escapeHtml(message)}</div>
    </div>
  `;
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Load tabs on open
  loadTabs();

  // Search handler
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    filterTabs(e.target.value);
  });

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.addEventListener('click', () => {
    loadTabs();
  });

  // Listen to tab changes
  chrome.tabs.onCreated.addListener(() => loadTabs());
  chrome.tabs.onRemoved.addListener(() => loadTabs());
  chrome.tabs.onUpdated.addListener(() => loadTabs());
});
