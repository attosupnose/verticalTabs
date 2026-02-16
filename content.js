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
  // Для неактивных вкладок favIconUrl часто пустой, поэтому используем Google Favicon Service
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
        return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%234285f4" rx="2"/></svg>';
      }
      // Для обычных страниц используем Google Favicon Service (надежнее для неактивных вкладок)
      return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
    } catch (e) {
      // Если URL невалидный, пробуем favIconUrl
      if (tab.favIconUrl) {
        return tab.favIconUrl;
      }
    }
  }
  
  // Если есть favIconUrl, используем его
  if (tab.favIconUrl) {
    return tab.favIconUrl;
  }
  
  // Fallback иконка
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
    content.innerHTML = filteredTabs.map(tab => {
      const isActive = tab.id === activeTab?.id;
      const faviconUrl = getFaviconUrl(tab);
      const tabTitle = tab.title || 'Без названия';
      
      return `
        <div class="tabs-tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" data-tab-url="${escapeHtml(tab.url || '')}" title="${escapeHtml(tabTitle)}">
          <img src="${faviconUrl}" alt="" class="tabs-tab-favicon" crossorigin="anonymous" onerror="handleFaviconError(this)">
          <div class="tabs-tab-actions">
            <button class="tabs-tab-action-btn" title="Закрыть" data-action="close">✕</button>
          </div>
        </div>
      `;
    }).join('');

    attachTabListeners();
  }).catch(() => {
    // Если не удалось получить активную вкладку, просто рендерим без выделения
    content.innerHTML = filteredTabs.map(tab => {
      const faviconUrl = getFaviconUrl(tab);
      const tabTitle = tab.title || 'Без названия';
      
      return `
        <div class="tabs-tab-item" data-tab-id="${tab.id}" data-tab-url="${escapeHtml(tab.url || '')}" title="${escapeHtml(tabTitle)}">
          <img src="${faviconUrl}" alt="" class="tabs-tab-favicon" crossorigin="anonymous" onerror="handleFaviconError(this)">
          <div class="tabs-tab-actions">
            <button class="tabs-tab-action-btn" title="Закрыть" data-action="close">✕</button>
          </div>
        </div>
      `;
    }).join('');

    attachTabListeners();
  });
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

    // Повторная попытка загрузки иконки при ошибке
    const faviconImg = item.querySelector('.tabs-tab-favicon');
    if (faviconImg) {
      faviconImg.addEventListener('error', function() {
        // Если иконка не загрузилась, пробуем обновить через некоторое время
        const tab = allTabs.find(t => t.id === tabId);
        if (tab && tab.url) {
          setTimeout(() => {
            // Пробуем загрузить через chrome://favicon/ если еще не пробовали
            if (!this.src.startsWith('chrome://favicon/')) {
              this.src = `chrome://favicon/${tab.url}`;
            }
          }, 1000);
        }
      });
    }
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
  if (!tabItem) return;
  
  const tabUrl = tabItem.dataset.tabUrl;
  if (tabUrl) {
    try {
      const url = new URL(tabUrl);
      // Пробуем загрузить через Google Favicon Service с другим размером
      img.src = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
      img.onerror = function() {
        // Если и это не сработало, пробуем еще раз с другим размером
        this.src = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=16`;
        this.onerror = function() {
          // В крайнем случае показываем fallback
          this.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999" rx="2"/></svg>';
          this.onerror = null;
        };
      };
    } catch (e) {
      img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999" rx="2"/></svg>';
      img.onerror = null;
    }
  } else {
    img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999" rx="2"/></svg>';
    img.onerror = null;
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
