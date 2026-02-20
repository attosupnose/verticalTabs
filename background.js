// Background script for managing tabs and panel
//
// Panel visibility state by windows (windowId -> boolean)
const panelVisibilityByWindow = {};

// Toggle panel on icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const windowId = tab.windowId;
    const currentVisible = !!panelVisibilityByWindow[windowId];
    const newVisible = !currentVisible;
    panelVisibilityByWindow[windowId] = newVisible;

    // Send message to content script to set panel state
    await chrome.tabs.sendMessage(tab.id, {
      action: 'setPanelVisibility',
      visible: newVisible,
    });
  } catch (error) {
    // If content script not loaded yet, inject it
    try {
      const windowId = tab.windowId;
      const desiredVisible = !!panelVisibilityByWindow[windowId];
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await chrome.tabs.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
      // Send same target state, without re-toggling
      await chrome.tabs.sendMessage(tab.id, {
        action: 'setPanelVisibility',
        visible: desiredVisible,
      });
    } catch (err) {
      console.error('Script injection error:', err);
    }
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getAllTabs') {
    chrome.tabs.query({}).then(tabs => {
      sendResponse(tabs);
    });
    return true; // Async response
  }

  if (message.action === 'getAllTabGroups') {
    chrome.tabGroups.query({}).then(groups => {
      sendResponse(groups);
    }).catch(() => {
      sendResponse([]);
    });
    return true;
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

  if (message.action === 'getTabFavicon') {
    chrome.tabs.get(message.tabId).then(tab => {
      sendResponse({ favIconUrl: tab.favIconUrl || null });
    }).catch(() => {
      sendResponse({ favIconUrl: null });
    });
    return true;
  }

  if (message.action === 'getTabInfo') {
    chrome.tabs.get(message.tabId).then(tab => {
      sendResponse({ url: tab.url || null, title: tab.title || null });
    }).catch(() => {
      sendResponse({ url: null, title: null });
    });
    return true;
  }

  if (message.action === 'switchTab') {
    chrome.tabs.get(message.tabId).then(tab => {
      chrome.tabs.update(message.tabId, { active: true });
      chrome.windows.update(tab.windowId, { focused: true }).then(() => {
        // Update panels in all windows after switching
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

  if (message.action === 'moveTabBefore') {
    (async () => {
      try {
        const tab = await chrome.tabs.get(message.tabId);
        const beforeTab = await chrome.tabs.get(message.beforeTabId);

        let targetIndex = beforeTab.index;
        if (tab.windowId === beforeTab.windowId && tab.index < beforeTab.index) {
          targetIndex = Math.max(0, targetIndex - 1);
        }

        await chrome.tabs.move(tab.id, {
          windowId: beforeTab.windowId,
          index: targetIndex,
        });

        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  if (message.action === 'moveTabToGroup') {
    (async () => {
      try {
        const tab = await chrome.tabs.get(message.tabId);
        const group = await chrome.tabGroups.get(message.groupId);
        const windowTabs = await chrome.tabs.query({ windowId: group.windowId });
        const groupTabs = windowTabs
          .filter(t => t.groupId === group.id)
          .sort((a, b) => a.index - b.index);

        const lastGroupIndex = groupTabs.length > 0
          ? groupTabs[groupTabs.length - 1].index
          : windowTabs.length;
        let targetIndex = lastGroupIndex + 1;

        if (tab.windowId === group.windowId && tab.index < targetIndex) {
          targetIndex = Math.max(0, targetIndex - 1);
        }

        await chrome.tabs.move(tab.id, {
          windowId: group.windowId,
          index: targetIndex,
        });

        await chrome.tabs.group({
          groupId: group.id,
          tabIds: [tab.id],
        });

        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
    })();
    return true;
  }

  if (message.action === 'panelVisibilityChanged') {
    if (sender && sender.tab && typeof sender.tab.windowId === 'number') {
      panelVisibilityByWindow[sender.tab.windowId] = !!message.visible;
    }
    return;
  }

  if (message.action === 'getPanelVisibility') {
    if (sender && sender.tab && typeof sender.tab.windowId === 'number') {
      sendResponse({ visible: !!panelVisibilityByWindow[sender.tab.windowId] });
    } else {
      sendResponse({ visible: false });
    }
    return true;
  }
});

// Update panel on tab changes
chrome.tabs.onCreated.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

chrome.tabs.onRemoved.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Update only on favicon change or loading status
  if (changeInfo.favIconUrl || changeInfo.status === 'complete') {
    broadcastToAllTabs({ action: 'refreshTabs' });
  }
});

chrome.tabGroups.onCreated?.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

chrome.tabGroups.onUpdated?.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

chrome.tabGroups.onRemoved?.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  // Update panels when switching active tab
  broadcastToAllTabs({ action: 'refreshTabs' });

  const windowId = activeInfo.windowId;
  const tabId = activeInfo.tabId;
  const visible = !!panelVisibilityByWindow[windowId];

  chrome.tabs.sendMessage(tabId, {
    action: 'setPanelVisibility',
    visible,
  }).catch(() => {
    // Tab may not have content script - ignore error
  });
});

chrome.tabs.onMoved.addListener(() => {
  broadcastToAllTabs({ action: 'refreshTabs' });
});

// Send message to all tabs
function broadcastToAllTabs(message) {
  chrome.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Ignore errors for tabs without content script
      });
    });
  });
}
