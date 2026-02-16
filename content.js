// Content script для отображения панели вкладок внизу страницы

let panelVisible = false;
let tabsPanel = null;

// Создание панели
function createTabsPanel() {
  if (tabsPanel) return;

  // Создаем контейнер панели
  tabsPanel = document.createElement('div');
  tabsPanel.id = 'tabs-extension-panel';
  tabsPanel.innerHTML = `
    <div class="tabs-panel-container">
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
    </div>
  `;

  document.body.appendChild(tabsPanel);

  // Обработчики событий
  setupEventListeners();
  
  // Загружаем вкладки
  loadTabs();
}

// Настройка обработчиков событий
function setupEventListeners() {
  const toggleBtn = document.getElementById('tabs-panel-toggle');
  const refreshBtn = document.getElementById('tabs-panel-refresh');
  const searchInput = document.getElementById('tabs-panel-search-input');

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
  const toggleBtn = document.getElementById('tabs-panel-toggle');
  
  if (panel) {
    panel.classList.toggle('collapsed', !panelVisible);
    if (toggleBtn) {
      toggleBtn.textContent = panelVisible ? '▼' : '▲';
    }
  }
}

let allTabs = [];
let filteredTabs = [];

// Функция для получения URL иконки
function getFaviconUrl(tab) {
  // Сначала пробуем использовать favIconUrl из объекта tab (если есть)
  if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
    return tab.favIconUrl;
  }
  
  // Для неактивных вкладок favIconUrl часто пустой, используем альтернативные методы
  if (tab.url) {
    try {
      const url = new URL(tab.url);
      // Для chrome:// и chrome-extension:// страниц используем специальную обработку
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
        // Для системных страниц пробуем использовать favIconUrl, если есть
        if (tab.favIconUrl) {
          return tab.favIconUrl;
        }
        // Иначе используем fallback
        return getFallbackIcon();
      }
      // Для обычных страниц используем Google Favicon Service (надежнее для неактивных вкладок)
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`;
    } catch (e) {
      // Если URL невалидный, пробуем favIconUrl
      if (tab.favIconUrl) {
        return tab.favIconUrl;
      }
    }
  }
  
  // Fallback иконка
  return getFallbackIcon();
}

// Получить fallback иконку
function getFallbackIcon() {
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999" rx="2"/></svg>';
}

// Загрузка всех вкладок
async function loadTabs() {
  try {
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
  const content = document.getElementById('tabs-panel-content');
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
    renderTabsList(content, filteredTabs, activeTab);
  }).catch(() => {
    // Если не удалось получить активную вкладку, просто рендерим без выделения
    renderTabsList(content, filteredTabs, null);
  });
}

// Рендеринг списка вкладок через DOM API для правильного экранирования
function renderTabsList(container, tabs, activeTab) {
  // Очищаем контейнер
  container.innerHTML = '';
  
  tabs.forEach(tab => {
    const isActive = activeTab && tab.id === activeTab.id;
    const faviconUrl = getFaviconUrl(tab);
    const tabTitle = tab.title || 'Без названия';
    
    // Создаем элементы через DOM API
    const tabItem = document.createElement('div');
    tabItem.className = `tabs-tab-item ${isActive ? 'active' : ''}`;
    tabItem.dataset.tabId = tab.id;
    tabItem.dataset.tabUrl = tab.url || '';
    tabItem.title = tabTitle;
    
    // Создаем изображение
    const faviconImg = document.createElement('img');
    faviconImg.className = 'tabs-tab-favicon';
    faviconImg.src = faviconUrl;
    faviconImg.alt = '';
    faviconImg.crossOrigin = 'anonymous';
    // Добавляем флаг, чтобы отслеживать, была ли уже попытка исправления
    faviconImg.dataset.errorHandled = 'false';
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
      
      chrome.runtime.sendMessage({ action: 'switchTab', tabId });
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

// Обработка ошибки загрузки favicon (только одна попытка исправления)
function handleFaviconError(img) {
  const tabItem = img.closest('.tabs-tab-item');
  if (!tabItem) {
    img.src = getFallbackIcon();
    return;
  }
  
  const tabUrl = tabItem.dataset.tabUrl;
  const currentSrc = img.src;
  
  // Если текущий источник - это Google Favicon Service, сразу показываем fallback
  if (currentSrc.includes('google.com/s2/favicons')) {
    img.src = getFallbackIcon();
    return;
  }
  
  // Если текущий источник - это favIconUrl, пробуем Google Favicon Service один раз
  if (tabUrl) {
    try {
      const url = new URL(tabUrl);
      // Пробуем загрузить через Google Favicon Service один раз
      img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=32`;
      // Если и это не сработает, обработчик ошибки больше не сработает из-за флага errorHandled
    } catch (e) {
      img.src = getFallbackIcon();
    }
  } else {
    img.src = getFallbackIcon();
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
  const content = document.getElementById('tabs-panel-content');
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
      loadTabs();
    }
  }
  return true;
});
