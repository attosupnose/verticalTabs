// Content script для отображения панели вкладок внизу страницы

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
    toggleBtn.title = panelVisible ? 'Свернуть панель' : 'Развернуть панель';
  }
  if (launcherToggleBtn) {
    launcherToggleBtn.classList.toggle('active', collapsedLauncherEnabled);
    launcherToggleBtn.title = collapsedLauncherEnabled
      ? 'Мини-кнопка включена'
      : 'Включить мини-кнопку в свернутом режиме';
  }
  if (searchToggleBtn) {
    searchToggleBtn.classList.toggle('active', searchVisible);
  }
  if (searchContainer) {
    searchContainer.classList.toggle('visible', searchVisible);
  }

  // При открытии панели сдвигаем страницу, при закрытии — возвращаем назад
  if (panelVisible) {
    applyPageShift();
    // Прокручиваем до активной вкладки при открытии панели
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
      // Игнорируем ошибки, если background недоступен
    });
  }
}

// Параметры сдвига страницы при открытии панели
const PANEL_WIDTH_STORAGE_KEY = 'tabsExtensionPanelWidth';
const MIN_PANEL_WIDTH = 150;
const MAX_PANEL_WIDTH = 800;
let panelWidth = 350;
let pageShiftApplied = false;
let originalBodyMarginRight = '';
let originalBodyTransition = '';

// Настройки количества столбцов с иконками вкладок
const COLUMNS_STORAGE_KEY = 'tabsExtensionColumnsCount';
let columnsCount = 6;
const SPREAD_LAYOUT_STORAGE_KEY = 'tabsExtensionSpreadLayoutEnabled';
let spreadLayoutEnabled = false;
const SPREAD_LAYOUT_TITLE_MIN_CELL_WIDTH = 40;

// Свёрнутые группы (Set<number> — groupId)
const COLLAPSED_GROUPS_STORAGE_KEY = 'tabsExtensionCollapsedGroups';
let collapsedGroups = new Set();
const COLLAPSED_LAUNCHER_STORAGE_KEY = 'tabsExtensionCollapsedLauncherEnabled';
let collapsedLauncherEnabled = true;
const SEARCH_VISIBLE_STORAGE_KEY = 'tabsExtensionSearchVisible';
let searchVisible = false;
const COLLAPSED_PEEK_TOP_STORAGE_KEY = 'tabsExtensionCollapsedPeekTop';
let collapsedPeekTop = 8;

// Кэш favicon по id вкладки (в рамках одной страницы)
const faviconCache = new Map();

function applyPageShift() {
  const body = document.body;
  if (!body) return;

  if (!pageShiftApplied) {
    originalBodyMarginRight = body.style.marginRight;
    originalBodyTransition = body.style.transition;
  }

  // Добавляем/расширяем transition так, чтобы margin-right анимировался
  const currentTransition = body.style.transition || '';
  if (!currentTransition.includes('margin-right')) {
    body.style.transition = currentTransition
      ? `${currentTransition}, margin-right 0.3s ease`
      : 'margin-right 0.3s ease';
  }

  body.style.marginRight = `${panelWidth}px`;
  pageShiftApplied = true;
}

function removePageShift() {
  const body = document.body;
  if (!body || !pageShiftApplied) return;

  body.style.marginRight = originalBodyMarginRight;
  body.style.transition = originalBodyTransition;
  pageShiftApplied = false;
}

// Загрузка CSS в Shadow DOM
function loadPanelCSS() {
  return chrome.runtime.getURL('content.css');
}

// Загрузка сохранённого количества столбцов
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

// Сохранение количества столбцов
function storeColumnsCount(value) {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [COLUMNS_STORAGE_KEY]: value });
  } catch (e) {
    // Молча игнорируем ошибки хранения
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

// Ширина панели — storage + применение
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
  if (pageShiftApplied && document.body) {
    document.body.style.marginRight = `${panelWidth}px`;
  }
  applyColumnsSetting();
}

// Загрузка свёрнутых групп из storage
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

// Сохранение свёрнутых групп в storage
function storeCollapsedGroups() {
  try {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.set({ [COLLAPSED_GROUPS_STORAGE_KEY]: [...collapsedGroups] });
  } catch (e) { /* ignore */ }
}

// Переключение свёрнутости группы
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
  btn.textContent = allCollapsed ? '▸▸' : '▾▾';
  btn.title = allCollapsed ? 'Развернуть все группы' : 'Свернуть все группы';
  btn.style.display = hasGroups ? '' : 'none';
}

// Применение настройки количества столбцов
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

function updateLayoutToggleButton() {
  if (!shadowRoot) return;
  const btn = shadowRoot.getElementById('tabs-panel-layout-toggle');
  if (!btn) return;
  btn.classList.toggle('active', spreadLayoutEnabled);
  btn.textContent = spreadLayoutEnabled ? '↔' : '↤';
  btn.title = spreadLayoutEnabled
    ? 'Выключить равномерную раскладку'
    : 'Включить равномерную раскладку';
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

// Создание панели с Shadow DOM для изоляции стилей
function createTabsPanel() {
  if (tabsPanel) return;

  // Создаем контейнер панели
  tabsPanel = document.createElement('div');
  tabsPanel.id = 'tabs-extension-panel';
  
  // Создаем Shadow DOM для изоляции стилей
  shadowRoot = tabsPanel.attachShadow({ mode: 'closed' });
  
  // Загружаем CSS
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('content.css');
  shadowRoot.appendChild(styleLink);
  
  // Создаем контейнер панели
  const panelContainer = document.createElement('div');
  panelContainer.className = 'tabs-panel-container';
  panelContainer.innerHTML = `
    <div class="tabs-panel-header">
      <button id="tabs-panel-layout-toggle" class="tabs-panel-layout-toggle" title="Включить равномерную раскладку">↤</button>
      <button id="tabs-panel-enable-launcher" class="tabs-panel-icon-btn" title="Включить мини-кнопку в свернутом режиме">📌</button>
      <button id="tabs-panel-search-toggle" class="tabs-panel-icon-btn" title="Показать/скрыть поиск">🔍</button>
      <button id="tabs-panel-toggle-all" class="tabs-panel-toggle-all" title="Свернуть/развернуть все группы" style="display:none">▾▾</button>
      <input
        type="number"
        id="tabs-panel-cols-input"
        class="tabs-panel-cols-input"
        min="1"
        max="12"
        value="6"
        title="Количество столбцов с иконками"
        aria-label="Количество столбцов с иконками"
      >
      <button id="tabs-panel-toggle" class="tabs-panel-toggle" title="Свернуть панель">❯</button>
      <button id="tabs-panel-refresh" class="tabs-panel-refresh" title="Обновить">🔄</button>
    </div>
    <div id="tabs-panel-collapsed-peek" class="tabs-panel-collapsed-peek">
      <div id="tabs-panel-peek-drag" class="tabs-panel-peek-drag" title="Переместить мини-кнопку" aria-label="Переместить мини-кнопку">⋮⋮</div>
      <button id="tabs-panel-peek-expand" class="tabs-panel-peek-expand" title="Развернуть панель" aria-label="Развернуть панель">❮</button>
      <button id="tabs-panel-peek-close" class="tabs-panel-peek-close" title="Скрыть мини-кнопку" aria-label="Скрыть мини-кнопку">✕</button>
    </div>
    <div class="tabs-panel-search">
      <input type="text" id="tabs-panel-search-input" placeholder="Поиск вкладок...">
    </div>
    <div id="tabs-panel-content" class="tabs-panel-content">
      <div class="tabs-loading">Загрузка вкладок...</div>
    </div>
  `;
  
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'tabs-resize-handle';
  panelContainer.appendChild(resizeHandle);

  shadowRoot.appendChild(panelContainer);
  document.body.appendChild(tabsPanel);

  // Применяем стартовое состояние без анимации, чтобы не мигало при инициализации
  updatePanelDomVisibility({ skipAnimation: true });

  // Синхронизируем фактическую видимость из background (по окну) тоже без анимации
  chrome.runtime.sendMessage({ action: 'getPanelVisibility' }).then((response) => {
    if (response && typeof response.visible === 'boolean') {
      setPanelVisibility(response.visible, { notifyBackground: false, skipAnimation: true });
    }
  }).catch(() => {
    // Если background недоступен, остаёмся в локальном состоянии
  });

  // Загружаем сохранённые настройки, затем инициализируем остальное
  Promise.all([
    loadStoredColumnsCount(),
    loadStoredSpreadLayoutEnabled(),
    loadCollapsedGroups(),
    loadStoredPanelWidth(),
    loadStoredCollapsedLauncherEnabled(),
    loadStoredSearchVisible(),
    loadStoredCollapsedPeekTop(),
  ]).then(([storedCols, storedSpreadLayout, storedCollapsed, storedWidth, storedLauncherEnabled, storedSearchVisible, storedPeekTop]) => {
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
    applyPanelWidth();
    applyCollapsedPeekPosition();
    updatePanelDomVisibility({ skipAnimation: true });
    updateLayoutToggleButton();

    // Обработчики событий
    setupEventListeners();
    setupResizeHandle();
    setupCollapsedPeekDrag();

    // Применяем настройку количества столбцов (уже с учётом сохранённого значения)
    applyColumnsSetting();

    // Обновляем значение в инпуте, если он уже есть
    const colsInput = shadowRoot.getElementById('tabs-panel-cols-input');
    if (colsInput) {
      colsInput.value = String(columnsCount);
    }

    // Загружаем вкладки
    loadTabs();
  });
}

// Настройка обработчиков событий
function setupEventListeners() {
  if (!shadowRoot) return;
  
  const toggleBtn = shadowRoot.getElementById('tabs-panel-toggle');
  const refreshBtn = shadowRoot.getElementById('tabs-panel-refresh');
  const layoutToggleBtn = shadowRoot.getElementById('tabs-panel-layout-toggle');
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
      document.body.style.transition = 'margin-right 0.3s ease';
    } else {
      document.body.style.transition = '';
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

// Переключение видимости панели (по клику на стрелку в хедере)
function togglePanel() {
  setPanelVisibility(!panelVisible, { notifyBackground: true });
}

let allTabs = [];
let filteredTabs = [];
let allTabGroups = [];
let currentWindowId = null;

// Управление автоскроллом к активной вкладке
let suppressAutoScrollOnce = false;
let preservedScrollTop = 0;

// Элемент тултипа внутри Shadow DOM
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

  // Отменяем отложенное появление, если оно было
  if (tooltipReappearTimeoutId) {
    clearTimeout(tooltipReappearTimeoutId);
    tooltipReappearTimeoutId = null;
  }

  const tooltip = ensureTooltipElement();
  if (!tooltip) return;

  const title = tabItem.getAttribute('title');
  if (!title) return;

  tooltip.textContent = title;

  // Координаты иконки вкладки относительно окна
  const rect = tabItem.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const topY = rect.top - 28;

  // Немного ограничим по краям окна
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

// Функция для получения URL иконки (начальный источник)
function getFaviconUrl(tab) {
  if (!tab) {
    return getFallbackIcon();
  }

  const tabId = typeof tab.id === 'number' ? tab.id : null;

  // 0. Если для вкладки уже есть закэшированный URL — используем его
  if (tabId !== null && faviconCache.has(tabId)) {
    const cached = faviconCache.get(tabId);
    console.log('[Tabs Extension] getFaviconUrl: using cached favicon for tab', tabId, cached);
    return cached;
  }

  let resultUrl = null;

  // 1. Сначала пробуем использовать favIconUrl из объекта tab
  if (tab.favIconUrl) {
    resultUrl = tab.favIconUrl;
    console.log('[Tabs Extension] getFaviconUrl: using tab.favIconUrl for tab', tabId, resultUrl);
  } else if (tab.url) {
    // 2. Если favIconUrl нет, пробуем получить через URL
    try {
      const url = new URL(tab.url);

      // Для chrome:// и chrome-extension:// страниц используем fallback
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
        resultUrl = getFallbackIcon();
        console.log('[Tabs Extension] getFaviconUrl: chrome*/extension page, using fallback for tab', tabId);
      } else {
        // Для обычных страниц пробуем получить favicon напрямую по URL
        const faviconUrls = getFaviconUrlsFromTabUrl(tab.url);
        if (faviconUrls.length > 0) {
          // Используем Google Favicon Service как первый вариант
          resultUrl = faviconUrls[1] || faviconUrls[0]; // faviconUrls[1] это Google Favicon Service
          console.log('[Tabs Extension] getFaviconUrl: using URL-derived favicon for tab', tabId, resultUrl);
        } else {
          resultUrl = getFallbackIcon();
          console.log('[Tabs Extension] getFaviconUrl: no favicon URLs, using fallback for tab', tabId);
        }
      }
    } catch (e) {
      console.warn('[Tabs Extension] Invalid URL for tab', tab.id, tab.url, e);
      resultUrl = getFallbackIcon();
      console.log('[Tabs Extension] getFaviconUrl: invalid URL, using fallback for tab', tabId);
    }
  } else {
    // 3. Нет ни favIconUrl, ни URL — fallback
    resultUrl = getFallbackIcon();
    console.log('[Tabs Extension] getFaviconUrl: no favIconUrl and no URL, using fallback for tab', tabId);
  }

  // Записываем в кэш, чтобы в следующий раз не пересчитывать
  if (tabId !== null && resultUrl) {
    faviconCache.set(tabId, resultUrl);
    console.log('[Tabs Extension] getFaviconUrl: caching favicon for tab', tabId, resultUrl);
  }

  return resultUrl || getFallbackIcon();
}

// Различные способы получения favicon URL
function getFaviconUrlsFromTabUrl(tabUrl) {
  if (!tabUrl) return [];
  
  try {
    const url = new URL(tabUrl);
    
    // Пропускаем chrome:// и chrome-extension://
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
      return [];
    }
    
    const urls = [];
    const baseUrl = `${url.protocol}//${url.hostname}`;
    
    // 1. Стандартный favicon.ico на корне домена
    urls.push(`${baseUrl}/favicon.ico`);
    
    // 2. Google Favicon Service (работает для большинства сайтов)
    urls.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`);
    
    // 3. DuckDuckGo Favicon Service (альтернатива)
    urls.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(url.hostname)}.ico`);
    
    // 4. Favicon через домен с размером (некоторые сайты поддерживают)
    urls.push(`${baseUrl}/favicon-32x32.png`);
    urls.push(`${baseUrl}/apple-touch-icon.png`);
    
    return urls;
  } catch (e) {
    console.warn('[Tabs Extension] Invalid URL for favicon:', tabUrl, e);
    return [];
  }
}

// Асинхронная загрузка favicon для вкладки (для неактивных вкладок)
// Пробует несколько методов по очереди
async function loadTabFavicon(tabId, imgElement) {
  // 0. Проверяем кэш: если уже знаем рабочий URL — просто ставим его и выходим
  if (typeof tabId === 'number' && faviconCache.has(tabId)) {
    const cachedUrl = faviconCache.get(tabId);
    if (cachedUrl && imgElement.src !== cachedUrl) {
      console.log('[Tabs Extension] loadTabFavicon: using cached favicon for tab', tabId, cachedUrl);
      imgElement.src = cachedUrl;
    }
    return;
  }
  
  console.log('[Tabs Extension] Attempting to load favicon for tab', tabId);
  // Метод 1: Через background script (получение favIconUrl из chrome.tabs)
  try {
    const result = await chrome.runtime.sendMessage({ action: 'getTabFavicon', tabId });
    console.log('[Tabs Extension] Method 1 (background script) result for tab', tabId, result);
    if (result && result.favIconUrl && imgElement.src !== result.favIconUrl) {
      console.log('[Tabs Extension] loadTabFavicon: no cache, will use background script favicon for tab', tabId, result.favIconUrl);
      imgElement.src = result.favIconUrl;
      faviconCache.set(tabId, result.favIconUrl);
      return; // Успешно загрузили через background script
    }
  } catch (e) {
    console.warn('[Tabs Extension] Method 1 failed for tab', tabId, e);
  }
  
  // Метод 2: Получаем URL вкладки и пробуем загрузить favicon напрямую
  try {
    const tabResult = await chrome.runtime.sendMessage({ action: 'getTabInfo', tabId });
    if (tabResult && tabResult.url) {
      const faviconUrls = getFaviconUrlsFromTabUrl(tabResult.url);
      console.log('[Tabs Extension] Method 2: Trying URLs from tab URL:', faviconUrls);
      
      // Пробуем установить первый URL (Google Favicon Service обычно самый надежный)
      // Браузер сам попробует загрузить, обработчик ошибок попробует следующий
      if (faviconUrls.length > 0) {
        // Используем Google Favicon Service как первый вариант (обычно самый надежный)
        const preferredUrl = faviconUrls.find(url => url.includes('google.com/s2/favicons')) || faviconUrls[0];
        console.log('[Tabs Extension] loadTabFavicon: no cache, will use URL-derived favicon for tab', tabId, preferredUrl);
        imgElement.src = preferredUrl;
        faviconCache.set(tabId, preferredUrl);
        // Если загрузка не удастся, обработчик ошибок попробует другие варианты
        return;
      }
    }
  } catch (e) {
    console.warn('[Tabs Extension] Method 2 failed for tab', tabId, e);
  }
  
  console.log('[Tabs Extension] All methods failed for tab', tabId);
}

// Получить fallback иконку
function getFallbackIcon() {
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999" rx="2"/></svg>';
}

// Загрузка всех вкладок
async function loadTabs() {
  if (isLoadingTabs) return;
  isLoadingTabs = true;
  setRefreshButtonLoading(true);
  console.log('[Tabs Extension] Loading tabs...');
  console.log('[Tabs Extension] Favicon cache size before loading tabs:', faviconCache.size);
  try {
    // Получаем текущий windowId
    if (!currentWindowId) {
      const windowInfo = await chrome.runtime.sendMessage({ action: 'getCurrentWindowId' });
      currentWindowId = windowInfo?.windowId;
      console.log('[Tabs Extension] Current window ID:', currentWindowId);
    }
    
    const [tabs, groups] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'getAllTabs' }),
      chrome.runtime.sendMessage({ action: 'getAllTabGroups' }).catch(() => []),
    ]);

    allTabs = tabs || [];
    allTabGroups = groups || [];
    filteredTabs = allTabs;
    console.log('[Tabs Extension] Loaded', allTabs.length, 'tabs');
    console.log('[Tabs Extension] Loaded', allTabGroups.length, 'tab groups');
    console.log('[Tabs Extension] Tabs with favIconUrl:', allTabs.filter(t => t.favIconUrl).length);
    renderTabs();
  } catch (error) {
    console.error('[Tabs Extension] Error loading tabs:', error);
    showError('Не удалось загрузить вкладки');
  } finally {
    isLoadingTabs = false;
    setRefreshButtonLoading(false);
  }
}

// Прокрутка до активной вкладки
function scrollToActiveTab() {
  // Прокручиваем только если панель видима
  if (!panelVisible || !shadowRoot) return;
  
  const content = shadowRoot.getElementById('tabs-panel-content');
  if (!content) return;
  
  const activeTabItem = shadowRoot.querySelector('.tabs-tab-item.active');
  if (!activeTabItem) return;
  
  // Прокручиваем до активной вкладки с небольшим отступом сверху
  const contentRect = content.getBoundingClientRect();
  const itemRect = activeTabItem.getBoundingClientRect();
  const scrollTop = content.scrollTop;
  const itemTop = itemRect.top - contentRect.top + scrollTop;
  
  // Прокручиваем так, чтобы элемент был виден с небольшим отступом
  content.scrollTo({
    top: itemTop - 12,
    behavior: 'smooth'
  });
}

// Отображение вкладок
function renderTabs() {
  const content = shadowRoot?.getElementById('tabs-panel-content');
  if (!content) return;

  // Применяем текущую настройку количества столбцов
  applyColumnsSetting();

  if (filteredTabs.length === 0) {
    content.innerHTML = `
      <div class="tabs-empty-state">
        <div class="tabs-empty-icon">📑</div>
        <div class="tabs-empty-text">Вкладки не найдены</div>
      </div>
    `;
    return;
  }

  chrome.runtime.sendMessage({ action: 'getActiveTab' }).then(([activeTab]) => {
    renderTabsList(content, filteredTabs, activeTab, currentWindowId);

    if (suppressAutoScrollOnce) {
      // Восстанавливаем предыдущую позицию скролла (например, после закрытия вкладки)
      suppressAutoScrollOnce = false;
      content.scrollTop = preservedScrollTop;
    } else {
      // Прокручиваем до активной вкладки после рендеринга
      setTimeout(() => scrollToActiveTab(), 100);
    }
  }).catch(() => {
    // Если не удалось получить активную вкладку, просто рендерим без выделения
    renderTabsList(content, filteredTabs, null, currentWindowId);

    if (suppressAutoScrollOnce) {
      suppressAutoScrollOnce = false;
      content.scrollTop = preservedScrollTop;
    }
  });
}

// Рендеринг списка вкладок — diff-подход: переиспользуем существующие DOM-элементы,
// создаём только новые, удаляем лишние, обновляем классы.
function renderTabsList(container, tabs, activeTab, currentWindowId) {
  if (!container) return;

  const groupById = new Map(allTabGroups.map(g => [g.id, g]));
  const insertedGroupMarkers = new Set();

  // 1. Собираем желаемый порядок элементов (ключ = "tab-<id>" или "group-<id>")
  //    Если группа свёрнута — её вкладки не включаются
  const desiredOrder = [];
  tabs.forEach(tab => {
    const groupId = typeof tab.groupId === 'number' ? tab.groupId : -1;
    if (groupId !== -1 && !insertedGroupMarkers.has(groupId)) {
      insertedGroupMarkers.add(groupId);
      const group = groupById.get(groupId);
      if (group) {
        desiredOrder.push({ key: `group-${groupId}`, type: 'group', group, representativeTab: tab });
      }
    }
    // Скрываем вкладки свёрнутых групп
    if (groupId !== -1 && collapsedGroups.has(groupId)) return;
    desiredOrder.push({ key: `tab-${tab.id}`, type: 'tab', tab });
  });

  // 2. Индексируем существующие DOM-элементы по ключу
  const existingByKey = new Map();
  for (const child of Array.from(container.children)) {
    if (child.classList.contains('tabs-tab-item') && child.dataset.tabId) {
      existingByKey.set(`tab-${child.dataset.tabId}`, child);
    } else if (child.classList.contains('tabs-group-marker') && child.dataset.groupId) {
      existingByKey.set(`group-${child.dataset.groupId}`, child);
    }
  }

  // 3. Удаляем элементы, которых больше нет в желаемом списке
  const desiredKeySet = new Set(desiredOrder.map(d => d.key));
  for (const [key, el] of existingByKey) {
    if (!desiredKeySet.has(key)) {
      el.remove();
      existingByKey.delete(key);
    }
  }

  // 4. Проходим по желаемому порядку: переиспользуем или создаём
  let cursor = container.firstChild; // текущий «следующий ожидаемый» DOM-ребёнок
  for (const entry of desiredOrder) {
    let el = existingByKey.get(entry.key);

    if (el) {
      // Элемент уже существует — обновляем только классы / data-атрибуты
      if (entry.type === 'tab') {
        updateTabElementInPlace(el, entry.tab, activeTab, currentWindowId);
      } else {
        updateGroupMarkerInPlace(el, entry.group, activeTab, currentWindowId);
      }

      // Если элемент не на своём месте в порядке — переставляем
      if (el !== cursor) {
        container.insertBefore(el, cursor);
      } else {
        cursor = el.nextSibling;
      }
    } else {
      // Элемента нет — создаём новый
      if (entry.type === 'tab') {
        el = createTabElement(entry.tab, activeTab, currentWindowId);
      } else {
        el = createGroupMarkerElement(entry.group, entry.representativeTab, activeTab, currentWindowId);
      }
      container.insertBefore(el, cursor);
    }
  }

  // 5. Удаляем оставшиеся «осиротевшие» узлы (например, placeholder загрузки)
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }

  // 6. Навешиваем обработчики только на новые элементы (без data-listeners)
  attachTabListeners();
  updateToggleAllButton();
}

// Обновление существующего tab-элемента на месте (без пересоздания <img>)
function updateTabElementInPlace(el, tab, activeTab, currentWindowId) {
  const isActive = activeTab && tab.id === activeTab.id;
  const isOtherWindow = currentWindowId && tab.windowId !== currentWindowId;

  let className = 'tabs-tab-item';
  if (isActive) className += ' active';
  if (isOtherWindow) className += ' other-window';
  if (el.className !== className) el.className = className;

  const tabTitle = tab.title || 'Без названия';
  if (el.title !== tabTitle) el.title = tabTitle;

  const titleSpan = el.querySelector('.tabs-tab-title');
  if (titleSpan && titleSpan.textContent !== tabTitle) titleSpan.textContent = tabTitle;

  if (el.dataset.tabUrl !== (tab.url || '')) el.dataset.tabUrl = tab.url || '';
  if (el.dataset.windowId !== String(tab.windowId || '')) el.dataset.windowId = tab.windowId || '';
}

// Обновление существующего group-marker на месте
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
    const titleText = group.title || 'Группа';
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
  el.title = group.title || 'Группа вкладок';

  el.style.borderLeftColor = getGroupColorBorder(group.color);
  el.style.backgroundColor = isCollapsed ? '' : getGroupColorBackground(group.color);

  const indicator = document.createElement('span');
  indicator.className = 'tabs-group-indicator';
  indicator.textContent = isCollapsed ? '▶' : '▼';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tabs-group-title';
  titleSpan.textContent = group.title || 'Группа';
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
  const tabTitle = tab.title || 'Без названия';

  // Создаем элементы через DOM API
  const tabItem = document.createElement('div');
  let className = 'tabs-tab-item';
  if (isActive) className += ' active';
  if (isOtherWindow) className += ' other-window';
  tabItem.className = className;
  tabItem.dataset.tabId = tab.id;
  tabItem.dataset.tabUrl = tab.url || '';
  tabItem.dataset.windowId = tab.windowId || '';
  tabItem.title = tabTitle;

  const faviconImg = document.createElement('img');
  faviconImg.className = 'tabs-tab-favicon';
  faviconImg.src = faviconUrl;
  faviconImg.alt = '';
  faviconImg.dataset.errorHandled = 'false';
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
    console.warn('[Tabs Extension] Favicon load error for tab', tab.id, 'src:', this.src);
    if (this.dataset.errorHandled === 'false') {
      this.dataset.errorHandled = 'true';
      handleFaviconError(this);
    }
  });

  faviconImg.addEventListener('load', function() {
    const tabId = typeof tab.id === 'number' ? tab.id : null;
    const wasInCacheBefore = tabId !== null ? faviconCache.has(tabId) : false;

    // Сохраняем успешно загруженный URL в кэш, чтобы не пересчитывать / не дёргать background лишний раз
    if (tabId !== null) {
      faviconCache.set(tabId, this.src);
    }

    // Логируем только при первом успешном получении иконки для вкладки
    if (!this.dataset.loadedLogged) {
      this.dataset.loadedLogged = 'true';
      console.log(
        '[Tabs Extension] Favicon loaded successfully for tab',
        tabId,
        'src:',
        this.src,
        '| wasInCacheBefore =',
        wasInCacheBefore
      );
    }
  });

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'tabs-tab-actions';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tabs-tab-action-btn';
  closeBtn.title = 'Закрыть';
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

// Прикрепление обработчиков для вкладок и групп (только к новым элементам без data-listeners)
function attachTabListeners() {
  if (!shadowRoot) {
    console.error('[Tabs Extension] Shadow root not available');
    return;
  }

  // Обработчики для маркеров групп
  const groupMarkers = shadowRoot.querySelectorAll('.tabs-group-marker:not([data-listeners])');
  groupMarkers.forEach(marker => {
    marker.dataset.listeners = 'true';
    const groupId = parseInt(marker.dataset.groupId);
    marker.addEventListener('click', () => {
      toggleGroupCollapsed(groupId);
    });
  });

  const tabItems = shadowRoot.querySelectorAll('.tabs-tab-item:not([data-listeners])');
  
  tabItems.forEach(item => {
    item.dataset.listeners = 'true';
    const tabId = parseInt(item.dataset.tabId);
    
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tabs-tab-actions')) return;

      if (e.ctrlKey && e.shiftKey) {
        const content = shadowRoot?.getElementById('tabs-panel-content');
        if (content) {
          preservedScrollTop = content.scrollTop;
          suppressAutoScrollOnce = true;
        }
        chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
          loadTabs();
        }).catch((error) => {
          console.error('[Tabs Extension] Error closing tab:', error);
        });
        return;
      }

      chrome.runtime.sendMessage({ action: 'switchTab', tabId }).then((result) => {
        console.log('[Tabs Extension] Tab switch result:', result);
      }).catch((error) => {
        console.error('[Tabs Extension] Error switching tab:', error);
      });
    });

    item.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const content = shadowRoot?.getElementById('tabs-panel-content');
      if (content) {
        preservedScrollTop = content.scrollTop;
        suppressAutoScrollOnce = true;
      }
      chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
        loadTabs();
      }).catch((error) => {
        console.error('[Tabs Extension] Error closing tab:', error);
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
          suppressAutoScrollOnce = true;
        }

        chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
          loadTabs();
        }).catch((error) => {
          console.error('[Tabs Extension] Error closing tab:', error);
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

// Поиск вкладок
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

// Обработка ошибки загрузки favicon (пробует альтернативные источники)
function handleFaviconError(img) {
  const tabItem = img.closest('.tabs-tab-item');
  if (!tabItem) {
    img.src = getFallbackIcon();
    return;
  }
  
  const tabUrl = tabItem.dataset.tabUrl;
  const currentSrc = img.src;
  const triedUrls = img.dataset.triedUrls ? JSON.parse(img.dataset.triedUrls) : [];
  
  console.log('[Tabs Extension] Favicon error, current src:', currentSrc, 'tried:', triedUrls);
  
  // Добавляем текущий URL в список попробованных
  if (currentSrc && !triedUrls.includes(currentSrc)) {
    triedUrls.push(currentSrc);
    img.dataset.triedUrls = JSON.stringify(triedUrls);
  }
  
  // Получаем список альтернативных URL
  if (tabUrl) {
    const alternativeUrls = getFaviconUrlsFromTabUrl(tabUrl);
    
    // Пробуем следующий URL из списка, который еще не пробовали
    for (const url of alternativeUrls) {
      if (!triedUrls.includes(url)) {
        console.log('[Tabs Extension] Trying alternative favicon URL:', url);
        img.src = url;
        triedUrls.push(url);
        img.dataset.triedUrls = JSON.stringify(triedUrls);
        return; // Пробуем этот URL
      }
    }
  }
  
  // Если все варианты испробованы, показываем fallback
  console.log('[Tabs Extension] All favicon URLs failed, using fallback');
  img.src = getFallbackIcon();
  img.onerror = null; // Отключаем дальнейшие попытки

  // Запоминаем fallback в кэше, чтобы не пытаться перезагружать иконку для этой вкладки
  const tabId = parseInt(tabItem.dataset.tabId, 10);
  if (Number.isFinite(tabId)) {
    faviconCache.set(tabId, img.src);
  }
}

// Экранирование HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Показать ошибку
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

// Синхронизация настроек между вкладками
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;

    // Синхронизация количества столбцов
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

    // Синхронизация ширины панели
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

    const peekTopChange = changes[COLLAPSED_PEEK_TOP_STORAGE_KEY];
    if (peekTopChange && typeof peekTopChange.newValue === 'number' && Number.isFinite(peekTopChange.newValue)) {
      collapsedPeekTop = peekTopChange.newValue;
      applyCollapsedPeekPosition();
    }

    // Синхронизация свёрнутых групп
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

// Инициализация при загрузке
if (document.body) {
  createTabsPanel();
} else {
  document.addEventListener('DOMContentLoaded', createTabsPanel);
}

// Слушаем сообщения от background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'togglePanel') {
    // Поддержка старого действия, если где-то еще используется
    togglePanel();
  }
  if (message.action === 'setPanelVisibility') {
    const visible = !!message.visible;
    setPanelVisibility(visible, { notifyBackground: false });
  }
  if (message.action === 'refreshTabs') {
    if (tabsPanel && panelVisible) {
      // Обновляем только если панель видима и не было недавнего обновления
      const now = Date.now();
      if (!window.lastTabRefresh || now - window.lastTabRefresh > 500) {
        window.lastTabRefresh = now;
        loadTabs();
        // Прокручиваем до активной вкладки после обновления
        setTimeout(() => scrollToActiveTab(), 200);
      }
    }
  }
  return true;
});
