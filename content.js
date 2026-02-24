// Content script for displaying tabs panel at the bottom of the page
const VT_CONTENT_SCRIPT_GUARD_KEY = '__verticalTabsContentScriptLoadedV3';
if (!globalThis[VT_CONTENT_SCRIPT_GUARD_KEY]) {
  globalThis[VT_CONTENT_SCRIPT_GUARD_KEY] = true;

let panelVisible = false;
let tabsPanel = null;
let shadowRoot = null;
let isLoadingTabs = false;

function updatePanelDomVisibility({ skipAnimation = false } = {}) {
  const panel = document.getElementById('tabs-extension-panel');
  const toggleBtn = shadowRoot?.getElementById('tabs-panel-toggle');
  const launcherToggleBtn = shadowRoot?.getElementById('tabs-panel-enable-launcher');
  const searchToggleBtn = shadowRoot?.getElementById('tabs-panel-search-toggle');
  const searchContainer = shadowRoot?.querySelector('.tabs-panel-search');

  if (!panel) return;

  if (skipAnimation) {
    panel.classList.add('no-transition');
  }

  panel.classList.toggle('collapsed', !panelVisible);
  panel.classList.toggle('launcher-hidden', !panelVisible && !collapsedLauncherEnabled);

  if (toggleBtn) {
    toggleBtn.textContent = panelVisible ? '❯' : '❮';
    toggleBtn.title = panelVisible ? t('collapsePanel') : t('expandPanel');
  }
  if (launcherToggleBtn) {
    launcherToggleBtn.classList.toggle('active', collapsedLauncherEnabled);
    launcherToggleBtn.title = collapsedLauncherEnabled
      ? t('launcherEnabled')
      : t('launcherDisabled');
  }
  if (searchToggleBtn) {
    searchToggleBtn.classList.toggle('active', searchVisible);
  }
  if (searchContainer) {
    searchContainer.classList.toggle('visible', searchVisible);
  }

  // When opening panel, shift the page; when closing, restore it
  if (panelVisible) {
    applyPageShift();
    // After expanding panel, recalculate adaptive layout by actual width.
    recalculateColumnsLayoutSoon();
    // Scroll to active tab when opening panel
    setTimeout(() => scrollToActiveTab(), 300);
  } else {
    removePageShift();
  }

  if (skipAnimation) {
    requestAnimationFrame(() => {
      panel.classList.remove('no-transition');
    });
  }
}

function setPanelVisibility(visible, { notifyBackground = false, skipAnimation = false } = {}) {
  panelVisible = !!visible;

  if (!tabsPanel) {
    createTabsPanel();
  }

  updatePanelDomVisibility({ skipAnimation });

  if (notifyBackground) {
    chrome.runtime.sendMessage({
      action: 'panelVisibilityChanged',
      visible: panelVisible,
    }).catch(() => {
      // Ignore errors if background is unavailable
    });
  }
}

// Page shift parameters when opening panel
const PANEL_WIDTH_STORAGE_KEY = 'tabsExtensionPanelWidth';
const MIN_PANEL_WIDTH = 150;
const MAX_PANEL_WIDTH = 800;
let panelWidth = 350;
let pageShiftApplied = false;
let shiftedPageRootElements = [];

function clearShiftedPageRoots() {
  if (!shiftedPageRootElements.length) return;
  shiftedPageRootElements.forEach((item) => {
    const { el, marginRight, transition, transform } = item;
    if (!el || !el.isConnected) return;
    el.style.marginRight = marginRight;
    el.style.transform = transform;
    el.style.transition = transition;
  });
  shiftedPageRootElements = [];
}

function shiftPageRoots() {
  clearShiftedPageRoots();
  const body = document.body;
  if (!body) return;

  const candidates = Array.from(body.children);
  candidates.forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.id === 'tabs-extension-panel') return;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') return;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    // Skip fixed/absolute elements — marginRight doesn't apply to them
    // correctly and breaks their positioning (navbars, modals, overlays).
    const pos = style.position;
    if (pos === 'fixed' || pos === 'absolute') return;

    const prevMarginRight = el.style.marginRight || '';
    const prevTransform = el.style.transform || '';
    const prevTransition = el.style.transition || '';

    // Keep left edge stable; reserve space on the right.
    el.style.marginRight = `${panelWidth}px`;
    if (!prevTransition.includes('margin-right')) {
      el.style.transition = prevTransition
        ? `${prevTransition}, margin-right 0.3s ease`
        : 'margin-right 0.3s ease';
    }

    shiftedPageRootElements.push({
      el,
      marginRight: prevMarginRight,
      transform: prevTransform,
      transition: prevTransition,
    });
  });
}

// Settings for number of columns with tab icons
const COLUMNS_STORAGE_KEY = 'tabsExtensionColumnsCount';
let columnsCount = 6;
const SPREAD_LAYOUT_STORAGE_KEY = 'tabsExtensionSpreadLayoutEnabled';
let spreadLayoutEnabled = true;
const SPREAD_LAYOUT_TITLE_MIN_CELL_WIDTH = 40;

// Collapsed groups (Set<number> - groupId)
const COLLAPSED_GROUPS_STORAGE_KEY = 'tabsExtensionCollapsedGroups';
let collapsedGroups = new Set();
const COLLAPSED_LAUNCHER_STORAGE_KEY = 'tabsExtensionCollapsedLauncherEnabled';
let collapsedLauncherEnabled = true;
const SEARCH_VISIBLE_STORAGE_KEY = 'tabsExtensionSearchVisible';
let searchVisible = false;
const COLLAPSED_PEEK_TOP_STORAGE_KEY = 'tabsExtensionCollapsedPeekTop';
let collapsedPeekTop = 8;
const LANGUAGE_STORAGE_KEY = 'tabsExtensionLanguage';
let currentLanguage = 'en';
const I18N = {
  en: {
    collapsePanel: 'Collapse panel',
    expandPanel: 'Expand panel',
    launcherEnabled: 'Mini button enabled',
    launcherDisabled: 'Enable mini button in collapsed mode',
    layoutOn: 'Disable even layout',
    layoutOff: 'Enable even layout',
    expandAllGroups: 'Expand all groups',
    collapseAllGroups: 'Collapse all groups',
    searchToggle: 'Show/hide search',
    refresh: 'Refresh',
    searchPlaceholder: 'Search tabs...',
    expandPanelLabel: 'Expand panel',
    hideMiniButtonLabel: 'Hide mini button',
    dragMiniButton: 'Move mini button',
    noTitle: 'Untitled',
    group: 'Group',
    groupTabs: 'Tab group',
    ungroupedTabs: 'Ungrouped',
    close: 'Close',
    tabsNotFound: 'No tabs found',
    loadFailed: 'Failed to load tabs',
    languageTitle: 'Switch language (RU/EN)',
    columnsCountLabel: 'Number of icon columns',
    totalTabsLabel: 'Total tabs in all windows',
  },
};

function t(key) {
  return I18N[currentLanguage]?.[key] || I18N.en[key] || key;
}

// Favicon cache by tab id (within one page)
const faviconCache = new Map();

function applyPageShift() {
  shiftPageRoots();
  pageShiftApplied = true;
}

function removePageShift() {
  if (!pageShiftApplied) return;
  clearShiftedPageRoots();
  pageShiftApplied = false;
}

// Load CSS text and keep it scoped to Shadow DOM
let panelCssTextPromise = null;
function loadPanelCSSText() {
  if (panelCssTextPromise) return panelCssTextPromise;
  // Prefer CSS text injected by background before executing this file.
  if (typeof globalThis.__verticalTabsPanelCssText === 'string' && globalThis.__verticalTabsPanelCssText.length > 0) {
    panelCssTextPromise = Promise.resolve(globalThis.__verticalTabsPanelCssText);
    return panelCssTextPromise;
  }
  panelCssTextPromise = fetch(chrome.runtime.getURL('content.css'))
    .then((response) => (response.ok ? response.text() : ''))
    .catch(() => '');
  return panelCssTextPromise;
}

// Load saved column count
function loadStoredColumnsCount() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve(null);
        return;
      }

      chrome.storage.sync.get([COLUMNS_STORAGE_KEY], (result) => {
        const value = result?.[COLUMNS_STORAGE_KEY];
        if (typeof value === 'number' && Number.isFinite(value)) {
          resolve(value);
        } else {
          resolve(null);
        }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// Save column count
function storeColumnsCount(value) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [COLUMNS_STORAGE_KEY]: value });
  } catch (e) {
    // Silently ignore storage errors
  }
}

function loadStoredSpreadLayoutEnabled() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) { resolve(null); return; }
      chrome.storage.sync.get([SPREAD_LAYOUT_STORAGE_KEY], (result) => {
        const value = result?.[SPREAD_LAYOUT_STORAGE_KEY];
        if (typeof value === 'boolean') {
          resolve(value);
        } else {
          resolve(null);
        }
      });
    } catch (e) { resolve(null); }
  });
}

function storeSpreadLayoutEnabled(value) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [SPREAD_LAYOUT_STORAGE_KEY]: !!value });
  } catch (e) { /* ignore */ }
}

function loadStoredCollapsedLauncherEnabled() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) { resolve(null); return; }
      chrome.storage.sync.get([COLLAPSED_LAUNCHER_STORAGE_KEY], (result) => {
        const value = result?.[COLLAPSED_LAUNCHER_STORAGE_KEY];
        if (typeof value === 'boolean') {
          resolve(value);
        } else {
          resolve(null);
        }
      });
    } catch (e) { resolve(null); }
  });
}

function storeCollapsedLauncherEnabled(value) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [COLLAPSED_LAUNCHER_STORAGE_KEY]: !!value });
  } catch (e) { /* ignore */ }
}

function loadStoredSearchVisible() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) { resolve(null); return; }
      chrome.storage.sync.get([SEARCH_VISIBLE_STORAGE_KEY], (result) => {
        const value = result?.[SEARCH_VISIBLE_STORAGE_KEY];
        if (typeof value === 'boolean') {
          resolve(value);
        } else {
          resolve(null);
        }
      });
    } catch (e) { resolve(null); }
  });
}

function storeSearchVisible(value) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [SEARCH_VISIBLE_STORAGE_KEY]: !!value });
  } catch (e) { /* ignore */ }
}

function loadStoredLanguage() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) { resolve(null); return; }
      chrome.storage.sync.get([LANGUAGE_STORAGE_KEY], (result) => {
        const value = result?.[LANGUAGE_STORAGE_KEY];
        if (value === 'en') {
          resolve(value);
        } else {
          resolve(null);
        }
      });
    } catch (e) { resolve(null); }
  });
}

function storeLanguage(lang) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    if (lang !== 'en') return;
    chrome.storage.sync.set({ [LANGUAGE_STORAGE_KEY]: lang });
  } catch (e) { /* ignore */ }
}

function loadStoredCollapsedPeekTop() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) { resolve(null); return; }
      chrome.storage.sync.get([COLLAPSED_PEEK_TOP_STORAGE_KEY], (result) => {
        const value = result?.[COLLAPSED_PEEK_TOP_STORAGE_KEY];
        if (typeof value === 'number' && Number.isFinite(value)) {
          resolve(value);
        } else {
          resolve(null);
        }
      });
    } catch (e) { resolve(null); }
  });
}

function storeCollapsedPeekTop(value) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [COLLAPSED_PEEK_TOP_STORAGE_KEY]: Math.round(value) });
  } catch (e) { /* ignore */ }
}

// Panel width - storage + application
function loadStoredPanelWidth() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) { resolve(null); return; }
      chrome.storage.sync.get([PANEL_WIDTH_STORAGE_KEY], (result) => {
        const value = result?.[PANEL_WIDTH_STORAGE_KEY];
        if (typeof value === 'number' && Number.isFinite(value)) {
          resolve(value);
        } else {
          resolve(null);
        }
      });
    } catch (e) { resolve(null); }
  });
}

function storePanelWidth(value) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [PANEL_WIDTH_STORAGE_KEY]: value });
  } catch (e) { /* ignore */ }
}

function applyPanelWidth() {
  if (tabsPanel) {
    tabsPanel.style.setProperty('--panel-width', `${panelWidth}px`);
  }
  if (pageShiftApplied) {
    shiftPageRoots();
  }
  applyColumnsSetting();
}

// Load collapsed groups from storage
function loadCollapsedGroups() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.sync) { resolve(null); return; }
      chrome.storage.sync.get([COLLAPSED_GROUPS_STORAGE_KEY], (result) => {
        const arr = result?.[COLLAPSED_GROUPS_STORAGE_KEY];
        if (Array.isArray(arr)) {
          resolve(new Set(arr.filter(id => typeof id === 'number')));
        } else {
          resolve(null);
        }
      });
    } catch (e) { resolve(null); }
  });
}

// Save collapsed groups to storage
function storeCollapsedGroups() {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [COLLAPSED_GROUPS_STORAGE_KEY]: [...collapsedGroups] });
  } catch (e) { /* ignore */ }
}

// Toggle group collapsed state
function toggleGroupCollapsed(groupId) {
  if (collapsedGroups.has(groupId)) {
    collapsedGroups.delete(groupId);
  } else {
    collapsedGroups.add(groupId);
  }
  storeCollapsedGroups();
  renderTabs();
}

function toggleAllGroups() {
  const allGroupIds = allTabGroups.map(g => g.id);
  if (allGroupIds.length === 0) return;

  const allCollapsed = allGroupIds.every(id => collapsedGroups.has(id));
  if (allCollapsed) {
    collapsedGroups.clear();
  } else {
    allGroupIds.forEach(id => collapsedGroups.add(id));
  }
  storeCollapsedGroups();
  renderTabs();
}

function updateToggleAllButton() {
  if (!shadowRoot) return;
  const btn = shadowRoot.getElementById('tabs-panel-toggle-all');
  if (!btn) return;

  const allGroupIds = allTabGroups.map(g => g.id);
  const hasGroups = allGroupIds.length > 0;
  const allCollapsed = hasGroups && allGroupIds.every(id => collapsedGroups.has(id));
  btn.textContent = allCollapsed ? 'G▸' : 'G▾';
  btn.title = allCollapsed ? t('expandAllGroups') : t('collapseAllGroups');
  btn.style.display = hasGroups ? '' : 'none';
}

// Apply column count setting
function applyColumnsSetting() {
  if (!shadowRoot) return;
  const content = shadowRoot.getElementById('tabs-panel-content');
  if (!content) return;

  const safeColumns = Math.max(1, Math.min(12, Number(columnsCount) || 1));
  columnsCount = safeColumns;

  if (safeColumns === 1) {
    content.style.gridTemplateColumns = '1fr';
    content.classList.add('single-column');
    content.classList.remove('spread-layout');
    content.classList.remove('spread-with-titles');
  } else if (spreadLayoutEnabled) {
    content.style.gridTemplateColumns = `repeat(${safeColumns}, minmax(0, 1fr))`;
    content.classList.remove('single-column');
    content.classList.add('spread-layout');
    const computed = window.getComputedStyle(content);
    const gap = parseFloat(computed.columnGap || computed.gap || '0') || 0;
    const availableWidth = content.clientWidth - gap * (safeColumns - 1);
    const cellWidth = availableWidth / safeColumns;
    content.classList.toggle('spread-with-titles', cellWidth >= SPREAD_LAYOUT_TITLE_MIN_CELL_WIDTH);
  } else {
    content.style.gridTemplateColumns = `repeat(${safeColumns}, 40px)`;
    content.classList.remove('single-column');
    content.classList.remove('spread-layout');
    content.classList.remove('spread-with-titles');
  }
}

function recalculateColumnsLayoutSoon() {
  // Several passes to catch actual width after first expansion.
  requestAnimationFrame(() => {
    applyColumnsSetting();
    requestAnimationFrame(() => applyColumnsSetting());
  });
  setTimeout(() => applyColumnsSetting(), 120);
}

function updateLayoutToggleButton() {
  if (!shadowRoot) return;
  const btn = shadowRoot.getElementById('tabs-panel-layout-toggle');
  if (!btn) return;
  btn.classList.toggle('active', spreadLayoutEnabled);
  btn.classList.toggle('is-off', !spreadLayoutEnabled);
  btn.textContent = '↔';
  btn.title = spreadLayoutEnabled
    ? t('layoutOn')
    : t('layoutOff');
}

function applyLanguageUI({ rerenderTabs = false } = {}) {
  if (!shadowRoot) return;
  const searchInput = shadowRoot.getElementById('tabs-panel-search-input');
  const refreshBtn = shadowRoot.getElementById('tabs-panel-refresh');
  const searchToggleBtn = shadowRoot.getElementById('tabs-panel-search-toggle');
  const languageBtn = shadowRoot.getElementById('tabs-panel-language-toggle');
  const colsInput = shadowRoot.getElementById('tabs-panel-cols-input');
  const totalCount = shadowRoot.getElementById('tabs-panel-total-count');
  const peekExpandBtn = shadowRoot.getElementById('tabs-panel-peek-expand');
  const peekCloseBtn = shadowRoot.getElementById('tabs-panel-peek-close');
  const peekDrag = shadowRoot.getElementById('tabs-panel-peek-drag');

  if (searchInput) searchInput.placeholder = t('searchPlaceholder');
  if (refreshBtn) refreshBtn.title = t('refresh');
  if (searchToggleBtn) searchToggleBtn.title = t('searchToggle');
  if (peekExpandBtn) {
    peekExpandBtn.title = t('expandPanelLabel');
    peekExpandBtn.setAttribute('aria-label', t('expandPanelLabel'));
  }
  if (peekCloseBtn) {
    peekCloseBtn.title = t('hideMiniButtonLabel');
    peekCloseBtn.setAttribute('aria-label', t('hideMiniButtonLabel'));
  }
  if (peekDrag) {
    peekDrag.title = t('dragMiniButton');
    peekDrag.setAttribute('aria-label', t('dragMiniButton'));
  }
  if (languageBtn) {
    languageBtn.textContent = 'EN';
    languageBtn.title = 'Language: English';
    languageBtn.style.display = 'none';
  }
  if (colsInput) {
    colsInput.title = t('columnsCountLabel');
    colsInput.setAttribute('aria-label', t('columnsCountLabel'));
  }
  if (totalCount) {
    const total = Array.isArray(allTabs) ? allTabs.length : 0;
    totalCount.title = `${t('totalTabsLabel')}: ${total}`;
    totalCount.setAttribute('aria-label', `${t('totalTabsLabel')}: ${total}`);
  }

  updateLayoutToggleButton();
  updateToggleAllButton();
  updatePanelDomVisibility();

  if (rerenderTabs) {
    renderTabs();
  }
}

function setSearchVisibility(visible, { persist = true } = {}) {
  searchVisible = !!visible;
  if (persist) storeSearchVisible(searchVisible);
  updatePanelDomVisibility();

  if (searchVisible && shadowRoot) {
    const searchInput = shadowRoot.getElementById('tabs-panel-search-input');
    if (searchInput) {
      requestAnimationFrame(() => searchInput.focus());
    }
  }
}

function setRefreshButtonLoading(loading) {
  if (!shadowRoot) return;
  const refreshBtn = shadowRoot.getElementById('tabs-panel-refresh');
  if (!refreshBtn) return;
  refreshBtn.classList.toggle('is-loading', !!loading);
}

function updateTotalTabsBadge() {
  if (!shadowRoot) return;
  const badge = shadowRoot.getElementById('tabs-panel-total-count');
  if (!badge) return;
  const total = Array.isArray(allTabs) ? allTabs.length : 0;
  badge.textContent = total > 999 ? '999+' : String(total);
  badge.title = `${t('totalTabsLabel')}: ${total}`;
  badge.setAttribute('aria-label', `${t('totalTabsLabel')}: ${total}`);
}

function refreshTabsPanel() {
  faviconCache.clear();
  loadTabs();
}

function getClampedCollapsedPeekTop(rawTop) {
  if (!shadowRoot) return 8;
  const peek = shadowRoot.getElementById('tabs-panel-collapsed-peek');
  const height = peek?.offsetHeight || 58;
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  return Math.max(minTop, Math.min(maxTop, Number(rawTop) || minTop));
}

function applyCollapsedPeekPosition() {
  if (!shadowRoot) return;
  const peek = shadowRoot.getElementById('tabs-panel-collapsed-peek');
  if (!peek) return;
  collapsedPeekTop = getClampedCollapsedPeekTop(collapsedPeekTop);
  peek.style.top = `${collapsedPeekTop}px`;
}

// Create panel with Shadow DOM for style isolation
function createTabsPanel() {
  if (tabsPanel) return;

  // Create panel container
  tabsPanel = document.createElement('div');
  tabsPanel.id = 'tabs-extension-panel';
  
  // Create Shadow DOM for style isolation
  shadowRoot = tabsPanel.attachShadow({ mode: 'closed' });
  
  // Load CSS into Shadow DOM to keep style isolation
  const styleEl = document.createElement('style');
  styleEl.id = 'tabs-panel-style';
  shadowRoot.appendChild(styleEl);
  loadPanelCSSText().then((cssText) => {
    const targetStyle = shadowRoot?.getElementById('tabs-panel-style');
    if (!targetStyle) return;
    if (cssText) {
      targetStyle.textContent = cssText;
    } else {
      // Minimal fallback to keep panel visible if CSS cannot be loaded.
      targetStyle.textContent = `
        :host { position: fixed; top: 0; right: 0; width: 350px; height: 100vh; z-index: 2147483647; background: #fff; border-left: 1px solid #e0e0e0; }
        .tabs-panel-container { display: flex; flex-direction: column; height: 100%; }
        .tabs-panel-content { flex: 1; overflow: auto; padding: 8px; }
      `;
    }
  });
  
  // Create panel container
  const panelContainer = document.createElement('div');
  panelContainer.className = 'tabs-panel-container';
  panelContainer.innerHTML = `
    <div class="tabs-panel-header">
      <button id="tabs-panel-layout-toggle" class="tabs-panel-layout-toggle tabs-panel-header-btn" title="${t('layoutOff')}">↔</button>
      <button id="tabs-panel-toggle-all" class="tabs-panel-toggle-all tabs-panel-header-btn" title="${t('collapseAllGroups')}" style="display:none">G▾</button>
      <span id="tabs-panel-total-count" class="tabs-panel-total-count" title="${t('totalTabsLabel')}: 0" aria-label="${t('totalTabsLabel')}: 0">0</span>
      <button id="tabs-panel-search-toggle" class="tabs-panel-icon-btn tabs-panel-header-btn" title="${t('searchToggle')}">⌕</button>
      <button id="tabs-panel-language-toggle" class="tabs-panel-icon-btn tabs-panel-header-btn" title="${t('languageTitle')}">EN</button>
      <input
        type="number"
        id="tabs-panel-cols-input"
        class="tabs-panel-cols-input"
        min="1"
        max="12"
        value="6"
        title="${t('columnsCountLabel')}"
        aria-label="${t('columnsCountLabel')}"
      >
      <button id="tabs-panel-toggle" class="tabs-panel-toggle tabs-panel-header-btn" title="${t('collapsePanel')}">❯</button>
      <button id="tabs-panel-refresh" class="tabs-panel-refresh tabs-panel-header-btn" title="${t('refresh')}">↻</button>
      <button id="tabs-panel-enable-launcher" class="tabs-panel-icon-btn tabs-panel-header-btn" title="${t('launcherDisabled')}">⌂</button>
    </div>
    <div id="tabs-panel-collapsed-peek" class="tabs-panel-collapsed-peek">
      <div id="tabs-panel-peek-drag" class="tabs-panel-peek-drag" title="${t('dragMiniButton')}" aria-label="${t('dragMiniButton')}">⋮⋮</div>
      <button id="tabs-panel-peek-expand" class="tabs-panel-peek-expand" title="${t('expandPanelLabel')}" aria-label="${t('expandPanelLabel')}">❮</button>
      <button id="tabs-panel-peek-close" class="tabs-panel-peek-close" title="${t('hideMiniButtonLabel')}" aria-label="${t('hideMiniButtonLabel')}">✕</button>
    </div>
    <div class="tabs-panel-search">
      <input type="text" id="tabs-panel-search-input" placeholder="${t('searchPlaceholder')}">
    </div>
    <div id="tabs-panel-content" class="tabs-panel-content">
      <div class="tabs-loading">Loading tabs...</div>
    </div>
  `;
  
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'tabs-resize-handle';
  panelContainer.appendChild(resizeHandle);

  shadowRoot.appendChild(panelContainer);
  document.body.appendChild(tabsPanel);

  // Apply initial state without animation to prevent flickering during initialization
  updatePanelDomVisibility({ skipAnimation: true });

  // Synchronize actual visibility from background (by window) also without animation
  chrome.runtime.sendMessage({ action: 'getPanelVisibility' }).then((response) => {
    if (response && typeof response.visible === 'boolean') {
      setPanelVisibility(response.visible, { notifyBackground: false, skipAnimation: true });
    }
  }).catch(() => {
    // If background unavailable, stay in local state
  });

  // Load saved settings, then initialize the rest
  Promise.all([
    loadStoredColumnsCount(),
    loadStoredSpreadLayoutEnabled(),
    loadCollapsedGroups(),
    loadStoredPanelWidth(),
    loadStoredCollapsedLauncherEnabled(),
    loadStoredSearchVisible(),
    loadStoredCollapsedPeekTop(),
    loadStoredLanguage(),
  ]).then(([storedCols, storedSpreadLayout, storedCollapsed, storedWidth, storedLauncherEnabled, storedSearchVisible, storedPeekTop, storedLanguage]) => {
    if (storedCols !== null) {
      columnsCount = Math.max(1, Math.min(12, storedCols));
    }
    if (storedSpreadLayout !== null) {
      spreadLayoutEnabled = storedSpreadLayout;
    }
    if (storedCollapsed !== null) {
      collapsedGroups = storedCollapsed;
    }
    if (storedWidth !== null) {
      panelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, storedWidth));
    }
    if (storedLauncherEnabled !== null) {
      collapsedLauncherEnabled = storedLauncherEnabled;
    }
    if (storedSearchVisible !== null) {
      searchVisible = storedSearchVisible;
    }
    if (storedPeekTop !== null) {
      collapsedPeekTop = storedPeekTop;
    }
    if (storedLanguage !== null) {
      currentLanguage = storedLanguage;
    }
    applyPanelWidth();
    applyCollapsedPeekPosition();
    applyLanguageUI({ rerenderTabs: false });
    updatePanelDomVisibility({ skipAnimation: true });

    // Event handlers
    setupEventListeners();
    setupResizeHandle();
    setupCollapsedPeekDrag();

    // Apply column count setting (already considering saved value)
    applyColumnsSetting();

    // Update input value if it already exists
    const colsInput = shadowRoot.getElementById('tabs-panel-cols-input');
    if (colsInput) {
      colsInput.value = String(columnsCount);
    }

    // Load tabs
    loadTabs();
  });
}

// Setup event handlers
function setupEventListeners() {
  if (!shadowRoot) return;
  
  const toggleBtn = shadowRoot.getElementById('tabs-panel-toggle');
  const refreshBtn = shadowRoot.getElementById('tabs-panel-refresh');
  const layoutToggleBtn = shadowRoot.getElementById('tabs-panel-layout-toggle');
  const languageToggleBtn = shadowRoot.getElementById('tabs-panel-language-toggle');
  const launcherToggleBtn = shadowRoot.getElementById('tabs-panel-enable-launcher');
  const searchToggleBtn = shadowRoot.getElementById('tabs-panel-search-toggle');
  const collapsedPeekExpandBtn = shadowRoot.getElementById('tabs-panel-peek-expand');
  const collapsedPeekCloseBtn = shadowRoot.getElementById('tabs-panel-peek-close');
  const searchInput = shadowRoot.getElementById('tabs-panel-search-input');
   const colsInput = shadowRoot.getElementById('tabs-panel-cols-input');

  toggleBtn?.addEventListener('click', () => {
    togglePanel();
  });

  layoutToggleBtn?.addEventListener('click', () => {
    spreadLayoutEnabled = !spreadLayoutEnabled;
    storeSpreadLayoutEnabled(spreadLayoutEnabled);
    applyColumnsSetting();
    updateLayoutToggleButton();
  });

  languageToggleBtn?.addEventListener('click', () => {
    // Language toggle temporarily disabled (English only)
    currentLanguage = 'en';
    storeLanguage(currentLanguage);
    applyLanguageUI({ rerenderTabs: true });
  });

  refreshBtn?.addEventListener('click', () => {
    refreshTabsPanel();
  });

  launcherToggleBtn?.addEventListener('click', () => {
    collapsedLauncherEnabled = !collapsedLauncherEnabled;
    storeCollapsedLauncherEnabled(collapsedLauncherEnabled);
    updatePanelDomVisibility();
  });

  searchToggleBtn?.addEventListener('click', () => {
    setSearchVisibility(!searchVisible, { persist: true });
  });

  collapsedPeekExpandBtn?.addEventListener('click', () => {
    setPanelVisibility(true, { notifyBackground: true });
  });

  collapsedPeekCloseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    collapsedLauncherEnabled = false;
    storeCollapsedLauncherEnabled(false);
    setPanelVisibility(false, { notifyBackground: true });
  });

  const toggleAllBtn = shadowRoot.getElementById('tabs-panel-toggle-all');
  toggleAllBtn?.addEventListener('click', () => {
    toggleAllGroups();
  });

  searchInput?.addEventListener('input', (e) => {
    filterTabs(e.target.value);
  });

  if (colsInput) {
    colsInput.value = String(columnsCount);
    colsInput.addEventListener('change', () => {
      const value = parseInt(colsInput.value, 10);
      if (Number.isNaN(value)) {
        colsInput.value = String(columnsCount);
        return;
      }

      columnsCount = Math.max(1, Math.min(12, value));
      colsInput.value = String(columnsCount);
      applyColumnsSetting();
      storeColumnsCount(columnsCount);
    });
  }
}

function setupResizeHandle() {
  if (!shadowRoot) return;
  const handle = shadowRoot.querySelector('.tabs-resize-handle');
  if (!handle) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.clientX;
    startWidth = panelWidth;
    handle.classList.add('active');
    document.body.style.transition = 'none';
    document.documentElement.style.transition = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = startX - e.clientX;
    panelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, startWidth + delta));
    applyPanelWidth();
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (!isResizing) return;
    e.stopPropagation();
    isResizing = false;
    handle.classList.remove('active');
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    if (pageShiftApplied) {
      shiftedPageRootElements.forEach(({ el }) => {
        if (el && el.isConnected) {
          el.style.transition = 'margin-right 0.3s ease';
        }
      });
    } else {
      shiftedPageRootElements.forEach(({ el }) => {
        if (el && el.isConnected) {
          el.style.transition = '';
        }
      });
    }
    storePanelWidth(panelWidth);
  }, true);
}

function setupCollapsedPeekDrag() {
  if (!shadowRoot) return;
  const dragHandle = shadowRoot.getElementById('tabs-panel-peek-drag');
  const peek = shadowRoot.getElementById('tabs-panel-collapsed-peek');
  if (!dragHandle || !peek) return;

  let isDragging = false;
  let startY = 0;
  let startTop = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    startY = e.clientY;
    startTop = collapsedPeekTop;
    peek.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    const deltaY = e.clientY - startY;
    collapsedPeekTop = getClampedCollapsedPeekTop(startTop + deltaY);
    applyCollapsedPeekPosition();
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    isDragging = false;
    peek.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    storeCollapsedPeekTop(collapsedPeekTop);
  }, true);

  window.addEventListener('resize', () => {
    applyCollapsedPeekPosition();
  });
}

// Toggle panel visibility (by clicking arrow in header)
function togglePanel() {
  setPanelVisibility(!panelVisible, { notifyBackground: true });
}

let allTabs = [];
let filteredTabs = [];
let allTabGroups = [];
let currentWindowId = null;
let draggedTabId = null;
let suppressTabClickUntil = 0;

// Auto-scroll management to active tab
let suppressAutoScrollRenders = 0;
let preservedScrollTop = 0;

// Tooltip element inside Shadow DOM
let tooltipElement = null;
let tooltipReappearTimeoutId = null;

function ensureTooltipElement() {
  if (!shadowRoot) return null;
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'tabs-tooltip';
    shadowRoot.appendChild(tooltipElement);
  }
  return tooltipElement;
}

function showTabTooltip(tabItem) {
  if (!tabItem || !shadowRoot) return;

  // Cancel delayed appearance if it was set
  if (tooltipReappearTimeoutId) {
    clearTimeout(tooltipReappearTimeoutId);
    tooltipReappearTimeoutId = null;
  }

  const tooltip = ensureTooltipElement();
  if (!tooltip) return;

  const title = tabItem.getAttribute('title');
  if (!title) return;

  tooltip.textContent = title;

  // Tab icon coordinates relative to window
  const rect = tabItem.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const topY = rect.top - 28;

  // Limit slightly by window edges
  const padding = 8;
  const maxLeft = window.innerWidth - padding;
  const minLeft = padding;
  const clampedX = Math.min(maxLeft, Math.max(minLeft, centerX));

  tooltip.style.left = `${clampedX}px`;
  tooltip.style.top = `${topY}px`;
  tooltip.style.opacity = '1';
}

function hideTabTooltip() {
  if (tooltipElement) {
    tooltipElement.style.opacity = '0';
  }

  if (tooltipReappearTimeoutId) {
    clearTimeout(tooltipReappearTimeoutId);
    tooltipReappearTimeoutId = null;
  }
}

// Function to get icon URL (initial source)
function getFaviconUrl(tab) {
  if (!tab) {
    return getFallbackIcon();
  }

  const tabId = typeof tab.id === 'number' ? tab.id : null;

  // 0. If tab already has cached URL - use it
  if (tabId !== null && faviconCache.has(tabId)) {
    const cached = faviconCache.get(tabId);
    return cached;
  }

  let resultUrl = null;

  // 1. First try using favIconUrl from tab object
  if (tab.favIconUrl) {
    resultUrl = tab.favIconUrl;
  } else if (tab.url) {
    // 2. If no favIconUrl, try to get via URL
    try {
      const url = new URL(tab.url);

      // For chrome:// and chrome-extension:// pages use fallback
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
        resultUrl = getFallbackIcon();
      } else {
        // For regular pages try to get favicon directly by URL
        const faviconUrls = getFaviconUrlsFromTabUrl(tab.url);
        if (faviconUrls.length > 0) {
          // Use Google Favicon Service as first option
          resultUrl = faviconUrls.find(u => u.includes('google.com/s2/favicons')) || faviconUrls[0];
        } else {
          resultUrl = getFallbackIcon();
        }
      }
    } catch (e) {
      resultUrl = getFallbackIcon();
    }
  } else {
    // 3. No favIconUrl or URL - fallback
    resultUrl = getFallbackIcon();
  }

  // Write to cache to avoid recalculation next time
  if (tabId !== null && resultUrl) {
    faviconCache.set(tabId, resultUrl);
  }

  return resultUrl || getFallbackIcon();
}

// Various methods to get favicon URL
function isLocalNetworkHost(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  const m = host.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function getFaviconUrlsFromTabUrl(tabUrl) {
  if (!tabUrl) return [];
  
  try {
    const url = new URL(tabUrl);
    
    // Skip chrome:// and chrome-extension://
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
      return [];
    }
    
    // Important: don't make direct requests to private/local hosts to avoid triggering
    // system requests for local network access in Chrome.
    if (isLocalNetworkHost(url.hostname)) {
      return [];
    }

    const urls = [];

    // 1. Google Favicon Service (works for most sites)
    urls.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`);
    
    // 2. DuckDuckGo Favicon Service (alternative)
    urls.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(url.hostname)}.ico`);
    
    return urls;
  } catch (e) {
    return [];
  }
}

// Async favicon loading for tab (for inactive tabs)
// Tries several methods in sequence
async function loadTabFavicon(tabId, imgElement) {
  // 0. Check cache: if we already know working URL - just set it and exit
  if (typeof tabId === 'number' && faviconCache.has(tabId)) {
    const cachedUrl = faviconCache.get(tabId);
    if (cachedUrl && imgElement.src !== cachedUrl) {
        imgElement.src = cachedUrl;
    }
    return;
  }
  
  // Method 1: Via background script (get favIconUrl from chrome.tabs)
  try {
    const result = await chrome.runtime.sendMessage({ action: 'getTabFavicon', tabId });
    if (result && result.favIconUrl && imgElement.src !== result.favIconUrl) {
      imgElement.src = result.favIconUrl;
      faviconCache.set(tabId, result.favIconUrl);
      return; // Successfully loaded via background script
    }
  } catch (e) {
    // Method 1 failed, try next
  }
  
  // Method 2: Get tab URL and try to load favicon directly
  try {
    const tabResult = await chrome.runtime.sendMessage({ action: 'getTabInfo', tabId });
    if (tabResult && tabResult.url) {
      const faviconUrls = getFaviconUrlsFromTabUrl(tabResult.url);
      // Try to set first URL (Google Favicon Service is usually most reliable)
      // Browser will try to load itself, error handler will try next
      if (faviconUrls.length > 0) {
        // Use Google Favicon Service as first option (usually most reliable)
        const preferredUrl = faviconUrls.find(url => url.includes('google.com/s2/favicons')) || faviconUrls[0];
        imgElement.src = preferredUrl;
        faviconCache.set(tabId, preferredUrl);
        // If load fails, error handler will try other options
        return;
      }
    }
  } catch (e) {
    // Method 2 failed
  }
}

// Get fallback icon
function getFallbackIcon() {
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999" rx="2"/></svg>';
}

// Load all tabs
async function loadTabs() {
  if (isLoadingTabs) return;
  isLoadingTabs = true;
  setRefreshButtonLoading(true);
  try {
    // Get current windowId
    if (!currentWindowId) {
      const windowInfo = await chrome.runtime.sendMessage({ action: 'getCurrentWindowId' });
      currentWindowId = windowInfo?.windowId;
    }
    
    const [tabs, groups] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'getAllTabs' }),
      chrome.runtime.sendMessage({ action: 'getAllTabGroups' }).catch(() => []),
    ]);

    allTabs = tabs || [];
    allTabGroups = groups || [];
    filteredTabs = allTabs;

    // Prune faviconCache if it grew beyond 500 — drop oldest entries (Map keeps insertion order)
    const FAVICON_CACHE_MAX = 500;
    if (faviconCache.size > FAVICON_CACHE_MAX) {
      const excess = faviconCache.size - FAVICON_CACHE_MAX;
      const iter = faviconCache.keys();
      for (let i = 0; i < excess; i++) {
        faviconCache.delete(iter.next().value);
      }
    }

    updateTotalTabsBadge();
    renderTabs();
  } catch (error) {
    showError(t('loadFailed'));
  } finally {
    isLoadingTabs = false;
    setRefreshButtonLoading(false);
  }
}

// Scroll to active tab
function scrollToActiveTab() {
  // Scroll only if panel is visible
  if (!panelVisible || !shadowRoot) return;
  
  const content = shadowRoot.getElementById('tabs-panel-content');
  if (!content) return;
  
  const activeTabItem = shadowRoot.querySelector('.tabs-tab-item.active');
  if (!activeTabItem) return;
  
  // Scroll to active tab with small offset from top
  const contentRect = content.getBoundingClientRect();
  const itemRect = activeTabItem.getBoundingClientRect();
  const scrollTop = content.scrollTop;
  const itemTop = itemRect.top - contentRect.top + scrollTop;
  
  // Scroll so element is visible with small offset
  content.scrollTo({
    top: itemTop - 12,
    behavior: 'smooth'
  });
}

// Display tabs
function renderTabs() {
  const content = shadowRoot?.getElementById('tabs-panel-content');
  if (!content) return;

  // Apply current column count setting
  applyColumnsSetting();

  if (filteredTabs.length === 0) {
    content.innerHTML = `
      <div class="tabs-empty-state">
        <div class="tabs-empty-icon">📑</div>
        <div class="tabs-empty-text">${t('tabsNotFound')}</div>
      </div>
    `;
    return;
  }

  chrome.runtime.sendMessage({ action: 'getActiveTab' }).then(([activeTab]) => {
    renderTabsList(content, filteredTabs, activeTab, currentWindowId);
    recalculateColumnsLayoutSoon();

    if (suppressAutoScrollRenders > 0) {
      // Restore previous scroll position (e.g., after closing tab)
      suppressAutoScrollRenders -= 1;
      content.scrollTop = preservedScrollTop;
    } else {
      // Scroll to active tab after rendering
      setTimeout(() => scrollToActiveTab(), 100);
    }
  }).catch(() => {
    // If failed to get active tab, just render without highlighting
    renderTabsList(content, filteredTabs, null, currentWindowId);
    recalculateColumnsLayoutSoon();

    if (suppressAutoScrollRenders > 0) {
      suppressAutoScrollRenders -= 1;
      content.scrollTop = preservedScrollTop;
    }
  });
}

// Rendering tab list - diff approach: reuse existing DOM elements,
// create only new ones, remove excess, update classes.
function renderTabsList(container, tabs, activeTab, currentWindowId) {
  if (!container) return;

  const groupById = new Map(allTabGroups.map(g => [g.id, g]));
  const insertedGroupMarkers = new Set();
  let previousRenderedSection = null; // 'grouped' | 'ungrouped'

  // 1. Collect desired element order (key = "tab-<id>" or "group-<id>")
  //    If group is collapsed - its tabs are not included
  const desiredOrder = [];
  tabs.forEach(tab => {
    const groupId = typeof tab.groupId === 'number' ? tab.groupId : -1;
    if (groupId !== -1 && !insertedGroupMarkers.has(groupId)) {
      insertedGroupMarkers.add(groupId);
      const group = groupById.get(groupId);
      if (group) {
        desiredOrder.push({ key: `group-${groupId}`, type: 'group', group, representativeTab: tab });
        previousRenderedSection = 'grouped';
      }
    }
    // Hide tabs of collapsed groups
    if (groupId !== -1 && collapsedGroups.has(groupId)) {
      previousRenderedSection = 'grouped';
      return;
    }
    if (groupId === -1 && previousRenderedSection === 'grouped') {
      desiredOrder.push({ key: `ungrouped-${tab.id}`, type: 'separator', separatorId: tab.id });
    }
    desiredOrder.push({ key: `tab-${tab.id}`, type: 'tab', tab });
    previousRenderedSection = groupId === -1 ? 'ungrouped' : 'grouped';
  });

  // 2. Index existing DOM elements by key
  const existingByKey = new Map();
  for (const child of Array.from(container.children)) {
    if (child.classList.contains('tabs-tab-item') && child.dataset.tabId) {
      existingByKey.set(`tab-${child.dataset.tabId}`, child);
    } else if (child.classList.contains('tabs-group-marker') && child.dataset.groupId) {
      existingByKey.set(`group-${child.dataset.groupId}`, child);
    } else if (child.classList.contains('tabs-ungrouped-separator') && child.dataset.separatorId) {
      existingByKey.set(`ungrouped-${child.dataset.separatorId}`, child);
    }
  }

  // 3. Remove elements no longer in desired list
  const desiredKeySet = new Set(desiredOrder.map(d => d.key));
  for (const [key, el] of existingByKey) {
    if (!desiredKeySet.has(key)) {
      el.remove();
      existingByKey.delete(key);
    }
  }

  // 4. Go through desired order: reuse or create
  let cursor = container.firstChild; // current "next expected" DOM child
  for (const entry of desiredOrder) {
    let el = existingByKey.get(entry.key);

    if (el) {
      // Element already exists - update only classes / data attributes
      if (entry.type === 'tab') {
        updateTabElementInPlace(el, entry.tab, activeTab, currentWindowId);
      } else if (entry.type === 'group') {
        updateGroupMarkerInPlace(el, entry.group, activeTab, currentWindowId);
      } else {
        updateUngroupedSeparatorInPlace(el);
      }

      // If element not in its place in order - move it
      if (el !== cursor) {
        container.insertBefore(el, cursor);
      } else {
        cursor = el.nextSibling;
      }
    } else {
      // Element doesn't exist - create new
      if (entry.type === 'tab') {
        el = createTabElement(entry.tab, activeTab, currentWindowId);
      } else if (entry.type === 'group') {
        el = createGroupMarkerElement(entry.group, entry.representativeTab, activeTab, currentWindowId);
      } else {
        el = createUngroupedSeparatorElement(entry.separatorId);
      }
      container.insertBefore(el, cursor);
    }
  }

  // 5. Remove remaining orphaned nodes (e.g., loading placeholder)
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }

  // 6. Attach listeners only to new elements (without data-listeners)
  attachTabListeners();
  updateToggleAllButton();
}

function updateUngroupedSeparatorInPlace(el) {
  if (!el) return;
  el.textContent = t('ungroupedTabs');
}

function createUngroupedSeparatorElement(separatorId) {
  const el = document.createElement('div');
  el.className = 'tabs-ungrouped-separator';
  el.dataset.separatorId = String(separatorId);
  el.textContent = t('ungroupedTabs');
  return el;
}

// Update existing tab element in place (without recreating <img>)
function updateTabElementInPlace(el, tab, activeTab, currentWindowId) {
  const isActive = activeTab && tab.id === activeTab.id;
  const isOtherWindow = currentWindowId && tab.windowId !== currentWindowId;

  let className = 'tabs-tab-item';
  if (isActive) className += ' active';
  if (isOtherWindow) className += ' other-window';
  if (el.className !== className) el.className = className;

  const tabTitle = tab.title || t('noTitle');
  if (el.title !== tabTitle) el.title = tabTitle;

  const titleSpan = el.querySelector('.tabs-tab-title');
  if (titleSpan && titleSpan.textContent !== tabTitle) titleSpan.textContent = tabTitle;

  if (el.dataset.tabUrl !== (tab.url || '')) el.dataset.tabUrl = tab.url || '';
  if (el.dataset.windowId !== String(tab.windowId || '')) el.dataset.windowId = tab.windowId || '';
  if (el.draggable !== true) el.draggable = true;
}

// Update existing group-marker in place
function updateGroupMarkerInPlace(el, group, activeTab, currentWindowId) {
  const isGroupActive = activeTab && activeTab.groupId === group.id;
  const isOtherWindow = currentWindowId && group.windowId && group.windowId !== currentWindowId;
  const isCollapsed = collapsedGroups.has(group.id);

  let className = 'tabs-group-marker';
  if (isGroupActive) className += ' active';
  if (isOtherWindow) className += ' other-window';
  if (isCollapsed) className += ' collapsed';
  if (el.className !== className) el.className = className;

  el.style.borderLeftColor = getGroupColorBorder(group.color);
  el.style.backgroundColor = isCollapsed ? '' : getGroupColorBackground(group.color);

  const indicator = el.querySelector('.tabs-group-indicator');
  if (indicator) {
    indicator.textContent = isCollapsed ? '▶' : '▼';
  }

  const titleSpan = el.querySelector('.tabs-group-title');
  if (titleSpan) {
    const titleText = group.title || t('group');
    if (titleSpan.textContent !== titleText) titleSpan.textContent = titleText;
    titleSpan.style.color = getGroupColorBorder(group.color);
  }

  const countBadge = el.querySelector('.tabs-group-count');
  if (countBadge) {
    const groupTabCount = allTabs.filter(t => t.groupId === group.id).length;
    const countStr = String(groupTabCount);
    if (countBadge.textContent !== countStr) countBadge.textContent = countStr;
    countBadge.style.backgroundColor = getGroupColorBorder(group.color);
  }
}

function createGroupMarkerElement(group, representativeTab, activeTab, currentWindowId) {
  const isGroupActive = activeTab && activeTab.groupId === group.id;
  const isOtherWindow = currentWindowId && group.windowId && group.windowId !== currentWindowId;
  const isCollapsed = collapsedGroups.has(group.id);

  const el = document.createElement('div');
  let className = 'tabs-group-marker';
  if (isGroupActive) className += ' active';
  if (isOtherWindow) className += ' other-window';
  if (isCollapsed) className += ' collapsed';
  el.className = className;
  el.dataset.groupId = group.id;
  el.title = group.title || t('groupTabs');

  el.style.borderLeftColor = getGroupColorBorder(group.color);
  el.style.backgroundColor = isCollapsed ? '' : getGroupColorBackground(group.color);

  const indicator = document.createElement('span');
  indicator.className = 'tabs-group-indicator';
  indicator.textContent = isCollapsed ? '▶' : '▼';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tabs-group-title';
  titleSpan.textContent = group.title || t('group');
  titleSpan.style.color = getGroupColorBorder(group.color);

  const countBadge = document.createElement('span');
  countBadge.className = 'tabs-group-count';
  const groupTabCount = allTabs.filter(t => t.groupId === group.id).length;
  countBadge.textContent = String(groupTabCount);
  countBadge.style.backgroundColor = getGroupColorBorder(group.color);

  el.appendChild(indicator);
  el.appendChild(titleSpan);
  el.appendChild(countBadge);
  return el;
}

function getGroupColorBorder(color) {
  const colorMap = {
    grey: '#9aa0a6',
    blue: '#4285f4',
    red: '#ea4335',
    yellow: '#fbbc04',
    green: '#34a853',
    pink: '#d01884',
    purple: '#a142f4',
    cyan: '#24c1e0',
  };
  return colorMap[color] || '#4285f4';
}

function getGroupColorBackground(color) {
  const colorMap = {
    grey: '#f1f3f4',
    blue: '#e8f0fe',
    red: '#fce8e6',
    yellow: '#fef7e0',
    green: '#e6f4ea',
    pink: '#fce8f3',
    purple: '#f3e8fd',
    cyan: '#e0f7fa',
  };
  return colorMap[color] || '#e8f0fe';
}

function createTabElement(tab, activeTab, currentWindowId) {
  const isActive = activeTab && tab.id === activeTab.id;
  const isOtherWindow = currentWindowId && tab.windowId !== currentWindowId;
  const faviconUrl = getFaviconUrl(tab);
  const tabTitle = tab.title || t('noTitle');

  // Create elements via DOM API
  const tabItem = document.createElement('div');
  let className = 'tabs-tab-item';
  if (isActive) className += ' active';
  if (isOtherWindow) className += ' other-window';
  tabItem.className = className;
  tabItem.dataset.tabId = tab.id;
  tabItem.dataset.tabUrl = tab.url || '';
  tabItem.dataset.windowId = tab.windowId || '';
  tabItem.title = tabTitle;
  tabItem.draggable = true;

  const faviconImg = document.createElement('img');
  faviconImg.className = 'tabs-tab-favicon';
  faviconImg.src = faviconUrl;
  faviconImg.alt = '';
  faviconImg.dataset.tabId = tab.id;

  if (
    !tab.favIconUrl &&
    tab.url &&
    !tab.url.startsWith('chrome://') &&
    !tab.url.startsWith('chrome-extension://') &&
    !faviconCache.has(tab.id)
  ) {
    setTimeout(() => {
      loadTabFavicon(tab.id, faviconImg);
    }, 250);
  }

  faviconImg.addEventListener('error', function() {
    // Don't retry for data: URIs (our fallback icon) — prevents infinite loop
    if (this.src.startsWith('data:')) return;
    handleFaviconError(this);
  });

  faviconImg.addEventListener('load', function() {
    const tabId = typeof tab.id === 'number' ? tab.id : null;

    // Save successfully loaded URL to cache to avoid recalculation / redundant background calls
    if (tabId !== null) {
      faviconCache.set(tabId, this.src);
    }
  });

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'tabs-tab-actions';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tabs-tab-action-btn';
  closeBtn.title = t('close');
  closeBtn.dataset.action = 'close';
  closeBtn.textContent = '✕';

  actionsDiv.appendChild(closeBtn);
  tabItem.appendChild(faviconImg);

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tabs-tab-title';
  titleSpan.textContent = tabTitle;
  tabItem.appendChild(titleSpan);

  tabItem.appendChild(actionsDiv);
  return tabItem;
}

// Attach handlers for tabs and groups (only to new elements without data-listeners)
function attachTabListeners() {
  if (!shadowRoot) {
    return;
  }

  // Handlers for group markers
  const groupMarkers = shadowRoot.querySelectorAll('.tabs-group-marker:not([data-listeners])');
  groupMarkers.forEach(marker => {
    marker.dataset.listeners = 'true';
    const groupId = parseInt(marker.dataset.groupId);
    marker.addEventListener('click', () => {
      toggleGroupCollapsed(groupId);
    });

    marker.addEventListener('dragover', (e) => {
      if (draggedTabId === null) return;
      e.preventDefault();
      marker.classList.add('drag-over-group');
    });

    marker.addEventListener('dragleave', () => {
      marker.classList.remove('drag-over-group');
    });

    marker.addEventListener('drop', (e) => {
      e.preventDefault();
      marker.classList.remove('drag-over-group');
      if (draggedTabId === null) return;
      chrome.runtime.sendMessage({
        action: 'moveTabToGroup',
        tabId: draggedTabId,
        groupId,
      }).then(() => {
        loadTabs();
      }).catch(() => {
        // Ignore tab group move errors
      });
    });
  });

  const tabItems = shadowRoot.querySelectorAll('.tabs-tab-item:not([data-listeners])');
  
  tabItems.forEach(item => {
    item.dataset.listeners = 'true';
    const tabId = parseInt(item.dataset.tabId);
    
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tabs-tab-actions')) return;
      if (Date.now() < suppressTabClickUntil) return;

      if (e.ctrlKey && e.shiftKey) {
        const content = shadowRoot?.getElementById('tabs-panel-content');
        if (content) {
          preservedScrollTop = content.scrollTop;
          // Closing tab usually triggers several updates in a row.
          // Suppress auto-scroll to active tab for next 2 renders.
          suppressAutoScrollRenders = Math.max(suppressAutoScrollRenders, 2);
        }
        chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
          loadTabs();
        }).catch(() => {
          // Ignore close errors
        });
        return;
      }

      chrome.runtime.sendMessage({ action: 'switchTab', tabId }).catch(() => {
        // Ignore switch errors
      });
    });

    item.addEventListener('dragstart', (e) => {
      draggedTabId = tabId;
      item.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(tabId));
      }
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('is-dragging');
      draggedTabId = null;
      suppressTabClickUntil = Date.now() + 200;
      shadowRoot.querySelectorAll('.drag-over-tab').forEach(el => el.classList.remove('drag-over-tab'));
      shadowRoot.querySelectorAll('.drag-over-group').forEach(el => el.classList.remove('drag-over-group'));
    });

    item.addEventListener('dragover', (e) => {
      if (draggedTabId === null || draggedTabId === tabId) return;
      e.preventDefault();
      item.classList.add('drag-over-tab');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-tab');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over-tab');
      if (draggedTabId === null || draggedTabId === tabId) return;
      chrome.runtime.sendMessage({
        action: 'moveTabBefore',
        tabId: draggedTabId,
        beforeTabId: tabId,
      }).then(() => {
        loadTabs();
      }).catch(() => {
        // Ignore tab move errors
      });
    });

    item.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const content = shadowRoot?.getElementById('tabs-panel-content');
      if (content) {
        preservedScrollTop = content.scrollTop;
        suppressAutoScrollRenders = Math.max(suppressAutoScrollRenders, 2);
      }
      chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
        loadTabs();
      }).catch(() => {
        // Ignore close errors
      });
    });

    item.addEventListener('mouseenter', () => {
      showTabTooltip(item);
    });

    item.addEventListener('mouseleave', () => {
      hideTabTooltip();
    });
  });

  const actionButtons = shadowRoot.querySelectorAll('.tabs-tab-item:not([data-listeners-btn]) .tabs-tab-action-btn');
  
  actionButtons.forEach(btn => {
    const tabItem = btn.closest('.tabs-tab-item');
    if (tabItem) tabItem.dataset.listenersBtn = 'true';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabItem = btn.closest('.tabs-tab-item');
      const tabId = parseInt(tabItem.dataset.tabId);
      const action = btn.dataset.action;

      if (action === 'close') {
        const content = shadowRoot?.getElementById('tabs-panel-content');
        if (content) {
          preservedScrollTop = content.scrollTop;
          suppressAutoScrollRenders = Math.max(suppressAutoScrollRenders, 2);
        }

        chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
          loadTabs();
        }).catch(() => {
          // Ignore close errors
        });
      }
    });

    btn.addEventListener('mouseenter', () => {
      hideTabTooltip();
    });

    btn.addEventListener('mouseleave', () => {
      const tabItem = btn.closest('.tabs-tab-item');
      if (!tabItem) return;

      if (tooltipReappearTimeoutId) {
        clearTimeout(tooltipReappearTimeoutId);
      }

      tooltipReappearTimeoutId = setTimeout(() => {
        tooltipReappearTimeoutId = null;
        if (tabItem.matches(':hover')) {
          showTabTooltip(tabItem);
        }
      }, 500);
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

// Handle favicon loading error (tries alternative sources)
function handleFaviconError(img) {
  const tabItem = img.closest('.tabs-tab-item');
  if (!tabItem) {
    img.src = getFallbackIcon();
    return;
  }
  
  const tabUrl = tabItem.dataset.tabUrl;
  const currentSrc = img.src;
  const triedUrls = img.dataset.triedUrls ? JSON.parse(img.dataset.triedUrls) : [];
  
  // Add current URL to tried list
  if (currentSrc && !triedUrls.includes(currentSrc)) {
    triedUrls.push(currentSrc);
    img.dataset.triedUrls = JSON.stringify(triedUrls);
  }
  
  // Get list of alternative URLs
  if (tabUrl) {
    const alternativeUrls = getFaviconUrlsFromTabUrl(tabUrl);
    
    // Try next URL from list that hasn't been tried yet
    for (const url of alternativeUrls) {
      if (!triedUrls.includes(url)) {
        img.src = url;
        triedUrls.push(url);
        img.dataset.triedUrls = JSON.stringify(triedUrls);
        return; // Try this URL
      }
    }
  }
  
  // All options exhausted — show fallback (data: URI won't trigger error)
  img.src = getFallbackIcon();

  // Remember fallback in cache to avoid reloading icon for this tab
  const tabId = parseInt(tabItem.dataset.tabId, 10);
  if (Number.isFinite(tabId)) {
    faviconCache.set(tabId, img.src);
  }
}

// HTML escaping
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show error
function showError(message) {
  const content = shadowRoot?.getElementById('tabs-panel-content');
  if (content) {
    content.innerHTML = `
      <div class="tabs-empty-state">
        <div class="tabs-empty-icon">⚠️</div>
        <div class="tabs-empty-text">${escapeHtml(message)}</div>
      </div>
    `;
  }
}

// Synchronize settings between tabs
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;

    // Synchronize column count
    const colsChange = changes[COLUMNS_STORAGE_KEY];
    if (colsChange) {
      const newValue = colsChange.newValue;
      if (typeof newValue === 'number' && Number.isFinite(newValue)) {
        columnsCount = Math.max(1, Math.min(12, newValue));
        if (shadowRoot) {
          const colsInput = shadowRoot.getElementById('tabs-panel-cols-input');
          if (colsInput) colsInput.value = String(columnsCount);
        }
        applyColumnsSetting();
      }
    }

    const spreadLayoutChange = changes[SPREAD_LAYOUT_STORAGE_KEY];
    if (spreadLayoutChange && typeof spreadLayoutChange.newValue === 'boolean') {
      spreadLayoutEnabled = spreadLayoutChange.newValue;
      applyColumnsSetting();
      updateLayoutToggleButton();
    }

    // Synchronize panel width
    const widthChange = changes[PANEL_WIDTH_STORAGE_KEY];
    if (widthChange) {
      const newValue = widthChange.newValue;
      if (typeof newValue === 'number' && Number.isFinite(newValue)) {
        panelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newValue));
        applyPanelWidth();
      }
    }

    const launcherChange = changes[COLLAPSED_LAUNCHER_STORAGE_KEY];
    if (launcherChange && typeof launcherChange.newValue === 'boolean') {
      collapsedLauncherEnabled = launcherChange.newValue;
      updatePanelDomVisibility();
    }

    const searchChange = changes[SEARCH_VISIBLE_STORAGE_KEY];
    if (searchChange && typeof searchChange.newValue === 'boolean') {
      searchVisible = searchChange.newValue;
      updatePanelDomVisibility();
    }

    const languageChange = changes[LANGUAGE_STORAGE_KEY];
    if (languageChange && (languageChange.newValue === 'ru' || languageChange.newValue === 'en')) {
      currentLanguage = languageChange.newValue;
      applyLanguageUI({ rerenderTabs: true });
    }

    const peekTopChange = changes[COLLAPSED_PEEK_TOP_STORAGE_KEY];
    if (peekTopChange && typeof peekTopChange.newValue === 'number' && Number.isFinite(peekTopChange.newValue)) {
      collapsedPeekTop = peekTopChange.newValue;
      applyCollapsedPeekPosition();
    }

    // Synchronize collapsed groups
    const groupsChange = changes[COLLAPSED_GROUPS_STORAGE_KEY];
    if (groupsChange) {
      const arr = groupsChange.newValue;
      if (Array.isArray(arr)) {
        collapsedGroups = new Set(arr.filter(id => typeof id === 'number'));
      } else {
        collapsedGroups = new Set();
      }
      renderTabs();
    }
  });
}

// Initialize on load
if (document.body) {
  createTabsPanel();
} else {
  document.addEventListener('DOMContentLoaded', createTabsPanel);
}

// Listen to messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'togglePanel') {
    // Support legacy action if still used somewhere
    togglePanel();
  }
  if (message.action === 'setPanelVisibility') {
    const visible = !!message.visible;
    setPanelVisibility(visible, { notifyBackground: false });
  }
  if (message.action === 'refreshTabs') {
    if (tabsPanel && panelVisible) {
      // Update only if panel is visible and there was no recent update
      const now = Date.now();
      if (!window.lastTabRefresh || now - window.lastTabRefresh > 500) {
        window.lastTabRefresh = now;
        loadTabs();
      }
    }
  }
  return true;
});
}
