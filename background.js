// Background script для управления вкладками и панелью

// Переключение панели при клике на иконку
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Отправляем сообщение в content script для переключения панели
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch (error) {
    // Если content script еще не загружен, инжектируем его
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await chrome.tabs.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
      // Ждем немного и отправляем сообщение
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
      }, 100);
    } catch (err) {
      console.error('Ошибка инжекции скрипта:', err);
    }
  }
});

// Обработка сообщений от content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getAllTabs') {
    chrome.tabs.query({}).then(tabs => {
      sendResponse(tabs);
    });
    return true; // Асинхронный ответ
  }

  if (message.action === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      sendResponse(tabs);
    });
    return true;
  }

  if (message.action === 'getCurrentWindowId') {
    chrome.windows.getCurrent().then(window => {
      sendResponse({ windowId: window.id });
    });
    return true;
  }

  if (message.action === 'switchTab') {
    chrome.tabs.get(message.tabId).then(tab => {
      chrome.tabs.update(message.tabId, { active: true });
      chrome.windows.update(tab.windowId, { focused: true }).then(() => {
        // Обновляем панели во всех окнах после переключения
        setTimeout(() => {
          broadcastToAllTabs({ action: 'refreshTabs' });
        }, 200);
      });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'closeTab') {
    chrome.tabs.remove(message.tabId).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Обновление панели при изменении вкладок
chrome.tabs.onCreated.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

chrome.tabs.onRemoved.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Обновляем только при изменении favicon или статуса загрузки
  if (changeInfo.favIconUrl || changeInfo.status === 'complete') {
    broadcastToAllTabs({ action: 'refreshTabs' });
  }
});

chrome.tabs.onActivated.addListener(() => {
  // Обновляем панели при переключении активной вкладки
  broadcastToAllTabs({ action: 'refreshTabs' });
});

// Отправка сообщения во все вкладки
function broadcastToAllTabs(message) {
  chrome.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Игнорируем ошибки для вкладок без content script
      });
    });
  });
}
