// Side panel script для отображения всех вкладок

let allTabs = [];
let filteredTabs = [];

// Загрузка всех вкладок
async function loadTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    allTabs = tabs;
    filteredTabs = tabs;
    renderTabs();
  } catch (error) {
    console.error('Ошибка загрузки вкладок:', error);
    showError('Не удалось загрузить вкладки');
  }
}

// Отображение вкладок
function renderTabs() {
  const tabsList = document.getElementById('tabsList');
  
  if (filteredTabs.length === 0) {
    tabsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📑</div>
        <div class="empty-state-text">Вкладки не найдены</div>
      </div>
    `;
    return;
  }

  // Получаем текущую активную вкладку
  chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
    tabsList.innerHTML = filteredTabs.map(tab => {
      const isActive = tab.id === activeTab?.id;
      const faviconUrl = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23999"/></svg>';
      
      return `
        <div class="tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}">
          <img src="${faviconUrl}" alt="" class="tab-favicon" onerror="this.style.display='none'">
          <div class="tab-content">
            <div class="tab-title">${escapeHtml(tab.title || 'Без названия')}</div>
            <div class="tab-url">${escapeHtml(tab.url || 'chrome://newtab/')}</div>
          </div>
          <div class="tab-actions">
            <button class="tab-action-btn" title="Закрыть" data-action="close">✕</button>
          </div>
        </div>
      `;
    }).join('');

    // Добавляем обработчики событий
    attachEventListeners();
  });
}

// Прикрепление обработчиков событий
function attachEventListeners() {
  // Клик по вкладке - переключение на неё
  document.querySelectorAll('.tab-item').forEach(item => {
    const tabId = parseInt(item.dataset.tabId);
    
    item.addEventListener('click', (e) => {
      // Игнорируем клики по кнопкам действий
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

  // Кнопки действий
  document.querySelectorAll('.tab-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabItem = btn.closest('.tab-item');
      const tabId = parseInt(tabItem.dataset.tabId);
      const action = btn.dataset.action;

      if (action === 'close') {
        chrome.tabs.remove(tabId).then(() => {
          loadTabs(); // Перезагружаем список
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

// Экранирование HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Показать ошибку
function showError(message) {
  const tabsList = document.getElementById('tabsList');
  tabsList.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">${escapeHtml(message)}</div>
    </div>
  `;
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  // Загружаем вкладки при открытии
  loadTabs();

  // Обработчик поиска
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    filterTabs(e.target.value);
  });

  // Кнопка обновления
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.addEventListener('click', () => {
    loadTabs();
  });

  // Слушаем изменения вкладок
  chrome.tabs.onCreated.addListener(() => loadTabs());
  chrome.tabs.onRemoved.addListener(() => loadTabs());
  chrome.tabs.onUpdated.addListener(() => loadTabs());
});
