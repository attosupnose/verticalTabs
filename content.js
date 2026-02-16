// Content script для отображения панели вкладок внизу страницы

let panelVisible = false;
let tabsPanel = null;
let shadowRoot = null;

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
      <button id="tabs-panel-toggle" class="tabs-panel-toggle">▼</button>
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
      toggleBtn.textContent = panelVisible ? '▼' : '▲';
    }
  }
}

let allTabs = [];
let filteredTabs = [];
let currentWindowId = null;

// Функция для получения URL иконки
function getFaviconUrl(tab) {
  // Сначала пробуем использовать favIconUrl из объекта tab
  if (tab.favIconUrl) {
    return tab.favIconUrl;
  }
  
  // Если favIconUrl нет, пробуем получить через URL
  if (tab.url) {
    try {
      const url = new URL(tab.url);
      
      // Для chrome:// и chrome-extension:// страниц используем fallback
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
        return getFallbackIcon();
      }
      
      // Для обычных страниц используем data URL placeholder
      // Реальная загрузка произойдет через background script если нужно
      return getFallbackIcon();
    } catch (e) {
      // Если URL невалидный, используем fallback
      return getFallbackIcon();
    }
  }
  
  // Fallback иконка
  return getFallbackIcon();
}

// Асинхронная загрузка favicon для вкладки (для неактивных вкладок)
async function loadTabFavicon(tabId, imgElement) {
  try {
    const result = await chrome.runtime.sendMessage({ action: 'getTabFavicon', tabId });
    if (result && result.favIconUrl && imgElement.src !== result.favIconUrl) {
      imgElement.src = result.favIconUrl;
    }
  } catch (e) {
    // Игнорируем ошибки
  }
}

// Получить fallback иконку
function getFallbackIcon() {
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999" rx="2"/></svg>';
}

// Загрузка всех вкладок
async function loadTabs() {
  try {
    // Получаем текущий windowId
    if (!currentWindowId) {
      const windowInfo = await chrome.runtime.sendMessage({ action: 'getCurrentWindowId' });
      currentWindowId = windowInfo?.windowId;
    }
    
    const tabs = await chrome.runtime.sendMessage({ action: 'getAllTabs' });
    allTabs = tabs || [];
    filteredTabs = allTabs;
    renderTabs();
  } catch (error) {
    console.error('Ошибка загрузки вкладок:', error);
    showError('Не удалось загрузить вкладки');
  }
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
  }).catch(() => {
    // Если не удалось получить активную вкладку, просто рендерим без выделения
    renderTabsList(content, filteredTabs, null, currentWindowId);
  });
}

// Рендеринг списка вкладок через DOM API для правильного экранирования
function renderTabsList(container, tabs, activeTab, currentWindowId) {
  if (!container) return;
  
  // Очищаем контейнер безопасным способом
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  
  tabs.forEach(tab => {
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
    
    // Создаем изображение
    const faviconImg = document.createElement('img');
    faviconImg.className = 'tabs-tab-favicon';
    faviconImg.src = faviconUrl;
    faviconImg.alt = '';
    // Убираем crossOrigin, чтобы избежать проблем с CORS и запросами доступа
    // Добавляем флаг, чтобы отслеживать, была ли уже попытка исправления
    faviconImg.dataset.errorHandled = 'false';
    faviconImg.dataset.tabId = tab.id;
    
    // Если favIconUrl нет, пробуем загрузить через background script
    if (!tab.favIconUrl && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      setTimeout(() => {
        loadTabFavicon(tab.id, faviconImg);
      }, 500);
    }
    
    faviconImg.addEventListener('error', function() {
      if (this.dataset.errorHandled === 'false') {
        this.dataset.errorHandled = 'true';
        handleFaviconError(this);
      }
    });
    
    // Создаем контейнер для действий
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
    container.appendChild(tabItem);
  });

  attachTabListeners();
}

// Прикрепление обработчиков для вкладок
function attachTabListeners() {
  document.querySelectorAll('.tabs-tab-item').forEach(item => {
    const tabId = parseInt(item.dataset.tabId);
    
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tabs-tab-actions')) {
        return;
      }
      
      chrome.runtime.sendMessage({ action: 'switchTab', tabId }).then(() => {
        // Обновление произойдет автоматически через broadcastToAllTabs
      });
    });
  });

  document.querySelectorAll('.tabs-tab-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabItem = btn.closest('.tabs-tab-item');
      const tabId = parseInt(tabItem.dataset.tabId);
      const action = btn.dataset.action;

      if (action === 'close') {
        chrome.runtime.sendMessage({ action: 'closeTab', tabId }).then(() => {
          loadTabs();
        });
      }
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

// Обработка ошибки загрузки favicon
function handleFaviconError(img) {
  const tabItem = img.closest('.tabs-tab-item');
  if (!tabItem) {
    img.src = getFallbackIcon();
    return;
  }
  
  const tabUrl = tabItem.dataset.tabUrl;
  const currentSrc = img.src;
  
  // Если уже пробовали favicon.ico, показываем fallback
  if (currentSrc.includes('/favicon.ico')) {
    img.src = getFallbackIcon();
    img.onerror = null; // Отключаем дальнейшие попытки
    return;
  }
  
  // Если это был favIconUrl или другой источник, пробуем favicon.ico
  if (tabUrl) {
    try {
      const url = new URL(tabUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        img.src = `${url.protocol}//${url.hostname}/favicon.ico`;
        img.dataset.errorHandled = 'true';
        return;
      }
    } catch (e) {
      // Если не удалось распарсить URL, показываем fallback
    }
  }
  
  // В любом другом случае показываем fallback
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
      }
    }
  }
  return true;
});
