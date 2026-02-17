// Content script для отображения панели вкладок внизу страницы

let panelVisible = false;
let tabsPanel = null;
let shadowRoot = null;

// Параметры сдвига страницы при открытии панели
const PANEL_WIDTH = 350; // должен совпадать с width панели в content.css
let pageShiftApplied = false;
let originalBodyMarginRight = '';
let originalBodyTransition = '';

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

  body.style.marginRight = `${PANEL_WIDTH}px`;
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
      <h2>Все вкладки</h2>
      <button id="tabs-panel-toggle" class="tabs-panel-toggle">◀</button>
      <button id="tabs-panel-refresh" class="tabs-panel-refresh" title="Обновить">🔄</button>
    </div>
    <div class="tabs-panel-search">
      <input type="text" id="tabs-panel-search-input" placeholder="Поиск вкладок...">
    </div>
    <div id="tabs-panel-content" class="tabs-panel-content">
      <div class="tabs-loading">Загрузка вкладок...</div>
    </div>
  `;
  
  shadowRoot.appendChild(panelContainer);
  document.body.appendChild(tabsPanel);

  // Обработчики событий
  setupEventListeners();
  
  // Загружаем вкладки
  loadTabs();
}

// Настройка обработчиков событий
function setupEventListeners() {
  if (!shadowRoot) return;
  
  const toggleBtn = shadowRoot.getElementById('tabs-panel-toggle');
  const refreshBtn = shadowRoot.getElementById('tabs-panel-refresh');
  const searchInput = shadowRoot.getElementById('tabs-panel-search-input');

  toggleBtn?.addEventListener('click', () => {
    togglePanel();
  });

  refreshBtn?.addEventListener('click', () => {
    loadTabs();
  });

  searchInput?.addEventListener('input', (e) => {
    filterTabs(e.target.value);
  });
}

// Переключение видимости панели
function togglePanel() {
  panelVisible = !panelVisible;
  const panel = document.getElementById('tabs-extension-panel');
  const toggleBtn = shadowRoot?.getElementById('tabs-panel-toggle');
  
  if (panel) {
    panel.classList.toggle('collapsed', !panelVisible);
    if (toggleBtn) {
      toggleBtn.textContent = panelVisible ? '◀' : '▶';
    }

    // При открытии панели сдвигаем страницу, при закрытии — возвращаем назад
    if (panelVisible) {
      applyPageShift();
      // Прокручиваем до активной вкладки при открытии панели
      setTimeout(() => scrollToActiveTab(), 300);
    } else {
      removePageShift();
    }
  }
}

let allTabs = [];
let filteredTabs = [];
let allTabGroups = [];
let currentWindowId = null;

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
  const topY = rect.top - 8;

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
  // Сначала пробуем использовать favIconUrl из объекта tab
  if (tab.favIconUrl) {
    console.log('[Tabs Extension] Using favIconUrl for tab', tab.id, tab.favIconUrl);
    return tab.favIconUrl;
  }
  
  // Если favIconUrl нет, пробуем получить через URL
  if (tab.url) {
    try {
      const url = new URL(tab.url);
      
      // Для chrome:// и chrome-extension:// страниц используем fallback
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
        console.log('[Tabs Extension] Chrome page, using fallback for tab', tab.id);
        return getFallbackIcon();
      }
      
      // Для обычных страниц пробуем получить favicon напрямую по URL
      // Используем Google Favicon Service как начальный источник (быстро и надежно)
      const faviconUrls = getFaviconUrlsFromTabUrl(tab.url);
      if (faviconUrls.length > 0) {
        // Используем Google Favicon Service как первый вариант
        console.log('[Tabs Extension] Using Google Favicon Service for tab', tab.id);
        return faviconUrls[1] || faviconUrls[0]; // faviconUrls[1] это Google Favicon Service
      }
      
      console.log('[Tabs Extension] No favicon URLs generated for tab', tab.id);
      return getFallbackIcon();
    } catch (e) {
      console.warn('[Tabs Extension] Invalid URL for tab', tab.id, tab.url, e);
      return getFallbackIcon();
    }
  }
  
  // Fallback иконка
  console.log('[Tabs Extension] No URL, using fallback for tab', tab.id);
  return getFallbackIcon();
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
  console.log('[Tabs Extension] Attempting to load favicon for tab', tabId);
  
  // Метод 1: Через background script (получение favIconUrl из chrome.tabs)
  try {
    const result = await chrome.runtime.sendMessage({ action: 'getTabFavicon', tabId });
    console.log('[Tabs Extension] Method 1 (background script) result for tab', tabId, result);
    if (result && result.favIconUrl && imgElement.src !== result.favIconUrl) {
      console.log('[Tabs Extension] Setting favicon from background script:', result.favIconUrl);
      imgElement.src = result.favIconUrl;
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
        console.log('[Tabs Extension] Setting favicon URL (will try to load):', preferredUrl);
        imgElement.src = preferredUrl;
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
  console.log('[Tabs Extension] Loading tabs...');
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
    // Прокручиваем до активной вкладки после рендеринга
    setTimeout(() => scrollToActiveTab(), 100);
  }).catch(() => {
    // Если не удалось получить активную вкладку, просто рендерим без выделения
    renderTabsList(content, filteredTabs, null, currentWindowId);
  });
}

// Рендеринг списка вкладок (с маркерами групп) без изменения порядка
function renderTabsList(container, tabs, activeTab, currentWindowId) {
  if (!container) return;
  
  // Очищаем контейнер безопасным способом
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const groupById = new Map(allTabGroups.map(g => [g.id, g]));
  const insertedGroupMarkers = new Set(); // groupId, чтобы вставить маркер один раз

  tabs.forEach(tab => {
    const groupId = typeof tab.groupId === 'number' ? tab.groupId : -1;

    // Вставляем маркер группы ровно перед первой вкладкой группы (сохраняя порядок)
    if (groupId !== -1 && !insertedGroupMarkers.has(groupId)) {
      insertedGroupMarkers.add(groupId);
      const group = groupById.get(groupId);
      if (group) {
        const marker = createGroupMarkerElement(group, tab, activeTab, currentWindowId);
        container.appendChild(marker);
      }
    }

    const tabElement = createTabElement(tab, activeTab, currentWindowId);
    container.appendChild(tabElement);
  });

  attachTabListeners();
}

function createGroupMarkerElement(group, representativeTab, activeTab, currentWindowId) {
  const isGroupActive = activeTab && activeTab.groupId === group.id;
  const isOtherWindow = currentWindowId && group.windowId && group.windowId !== currentWindowId;

  const el = document.createElement('div');
  let className = 'tabs-group-marker';
  if (isGroupActive) className += ' active';
  if (isOtherWindow) className += ' other-window';
  el.className = className;
  el.dataset.groupId = group.id;
  el.title = group.title || 'Группа вкладок';

  // Цвет группы (Chrome: grey/blue/red/yellow/green/pink/purple/cyan)
  const borderColor = getGroupColorBorder(group.color);
  el.style.borderColor = borderColor;
  el.style.backgroundColor = getGroupColorBackground(group.color);

  // Пытаемся показать favicon первой вкладки группы как “иконку группы”
  const img = document.createElement('img');
  img.className = 'tabs-tab-favicon';
  img.alt = '';
  img.src = getFaviconUrl(representativeTab);
  img.dataset.errorHandled = 'false';

  if (!representativeTab.favIconUrl && representativeTab.url && !representativeTab.url.startsWith('chrome://') && !representativeTab.url.startsWith('chrome-extension://')) {
    setTimeout(() => loadTabFavicon(representativeTab.id, img), 300);
  }

  img.addEventListener('error', function () {
    if (this.dataset.errorHandled === 'false') {
      this.dataset.errorHandled = 'true';
      handleFaviconError(this);
    }
  });

  el.appendChild(img);
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

  if (!tab.favIconUrl && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
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
    console.log('[Tabs Extension] Favicon loaded successfully for tab', tab.id, 'src:', this.src);
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
  tabItem.appendChild(actionsDiv);
  return tabItem;
}

// Прикрепление обработчиков для вкладок
function attachTabListeners() {
  if (!shadowRoot) {
    console.error('[Tabs Extension] Shadow root not available');
    return;
  }
  
  const tabItems = shadowRoot.querySelectorAll('.tabs-tab-item');
  console.log('[Tabs Extension] Attaching listeners to', tabItems.length, 'tab items');
  
  tabItems.forEach(item => {
    const tabId = parseInt(item.dataset.tabId);
    
    item.addEventListener('click', (e) => {
      console.log('[Tabs Extension] Tab item clicked:', tabId, 'target:', e.target);
      if (e.target.closest('.tabs-tab-actions')) {
        console.log('[Tabs Extension] Click was on action button, ignoring');
        return;
      }
      
      console.log('[Tabs Extension] Switching to tab', tabId);
      chrome.runtime.sendMessage({ action: 'switchTab', tabId }).then((result) => {
        console.log('[Tabs Extension] Tab switch result:', result);
        // Обновление произойдет автоматически через broadcastToAllTabs
      }).catch((error) => {
        console.error('[Tabs Extension] Error switching tab:', error);
      });
    });

    item.addEventListener('mouseenter', () => {
      showTabTooltip(item);
    });

    item.addEventListener('mouseleave', () => {
      hideTabTooltip();
    });
  });

  const actionButtons = shadowRoot.querySelectorAll('.tabs-tab-action-btn');
  console.log('[Tabs Extension] Attaching listeners to', actionButtons.length, 'action buttons');
  
  actionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabItem = btn.closest('.tabs-tab-item');
      const tabId = parseInt(tabItem.dataset.tabId);
      const action = btn.dataset.action;

      console.log('[Tabs Extension] Action button clicked:', action, 'for tab', tabId);

      if (action === 'close') {
        console.log('[Tabs Extension] Closing tab', tabId);
        chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
          console.log('[Tabs Extension] Tab closed, reloading tabs');
          loadTabs();
        }).catch((error) => {
          console.error('[Tabs Extension] Error closing tab:', error);
        });
      }
    });

    // При наведении на кнопку закрытия скрываем тултип, чтобы кнопка была видна
    btn.addEventListener('mouseenter', () => {
      hideTabTooltip();
    });

    // Когда уводим мышь с кнопки, если курсор снова над плиткой вкладки —
    // показываем тултип с задержкой 0.5 сек
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

// Инициализация при загрузке
if (document.body) {
  createTabsPanel();
} else {
  document.addEventListener('DOMContentLoaded', createTabsPanel);
}

// Слушаем сообщения от background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'togglePanel') {
    if (!tabsPanel) {
      createTabsPanel();
    } else {
      togglePanel();
    }
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
