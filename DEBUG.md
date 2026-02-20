# Отладка расширения "Vertical Tabs: compact, float" ("Вертикальные вкладки: компактные, растяжимые")

## Как открыть DevTools для отладки

### 1. Открыть DevTools для Content Script

1. Откройте любую веб-страницу
2. Откройте DevTools (F12 или Ctrl+Shift+I)
3. Перейдите на вкладку **Console**
4. Все логи с префиксом `[Tabs Extension]` будут видны здесь

### 2. Открыть DevTools для Background Script

1. Откройте `chrome://extensions/`
2. Найдите расширение "Vertical Tabs: compact, float"
3. Нажмите на ссылку **"service worker"** (или "background page" для MV2)
4. Откроется DevTools для background script

### 3. Проверить Shadow DOM

1. Откройте DevTools на странице
2. Перейдите на вкладку **Elements**
3. Найдите элемент `#tabs-extension-panel`
4. Раскройте его - внутри будет `#shadow-root (closed)`
5. Раскройте shadow root, чтобы увидеть внутреннюю структуру

## Что логируется

### Загрузка вкладок
- `[Tabs Extension] Loading tabs...` - начало загрузки
- `[Tabs Extension] Loaded X tabs` - количество загруженных вкладок
- `[Tabs Extension] Tabs with favIconUrl: X` - сколько вкладок имеют favIconUrl

### Загрузка иконок
- `[Tabs Extension] Using favIconUrl for tab X` - используется favIconUrl из объекта tab
- `[Tabs Extension] No favIconUrl for tab X, will try async load` - нет favIconUrl, будет попытка асинхронной загрузки
- `[Tabs Extension] Attempting to load favicon for tab X` - начало асинхронной загрузки
- `[Tabs Extension] Favicon result for tab X` - результат запроса favicon
- `[Tabs Extension] Setting favicon for tab X to URL` - установка favicon
- `[Tabs Extension] Favicon loaded successfully for tab X` - успешная загрузка
- `[Tabs Extension] Favicon load error for tab X` - ошибка загрузки

### Клики по вкладкам
- `[Tabs Extension] Tab item clicked: X` - клик по вкладке
- `[Tabs Extension] Switching to tab X` - переключение на вкладку
- `[Tabs Extension] Tab switch result: X` - результат переключения
- `[Tabs Extension] Action button clicked: close for tab X` - клик по кнопке закрытия
- `[Tabs Extension] Closing tab X` - закрытие вкладки

### Ошибки
- Все ошибки логируются с префиксом `[Tabs Extension] Error:`

## Полезные команды в Console

```javascript
// Проверить текущее состояние
console.log('All tabs:', allTabs);
console.log('Filtered tabs:', filteredTabs);
console.log('Current window ID:', currentWindowId);
console.log('Panel visible:', panelVisible);

// Проверить Shadow DOM
const panel = document.getElementById('tabs-extension-panel');
const shadowRoot = panel?.shadowRoot;
console.log('Shadow root:', shadowRoot);

// Проверить элементы в Shadow DOM
const tabItems = shadowRoot?.querySelectorAll('.tabs-tab-item');
console.log('Tab items:', tabItems);

// Проверить favicon для конкретной вкладки
chrome.runtime.sendMessage({ action: 'getTabFavicon', tabId: 123 }).then(console.log);
```

## Проверка загрузки иконок

1. Откройте Console в DevTools
2. Найдите логи с `[Tabs Extension] Favicon`
3. Проверьте, какие вкладки имеют `favIconUrl`
4. Проверьте ошибки загрузки изображений

## Проверка кликов

1. Откройте Console в DevTools
2. Кликните на вкладку в панели
3. Проверьте логи `[Tabs Extension] Tab item clicked`
4. Проверьте результат переключения
