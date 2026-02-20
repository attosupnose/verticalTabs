# Debug Guide for "Vertical Tabs: compact, float"

## Open DevTools for Debugging

### 1. Content Script DevTools

1. Open any web page
2. Open DevTools (`F12` or `Ctrl+Shift+I`)
3. Go to the **Console** tab
4. Logs with prefix `[Tabs Extension]` are shown there

### 2. Background Script DevTools

1. Open `chrome://extensions/`
2. Find the extension "Vertical Tabs: compact, float"
3. Click **service worker** (or background page for MV2)
4. DevTools for the background script will open

### 3. Inspect Shadow DOM

1. Open DevTools on a page
2. Go to **Elements**
3. Find `#tabs-extension-panel`
4. Expand it to see `#shadow-root (closed)`
5. Expand the shadow root to inspect internal structure

## What Gets Logged

### Tab Loading
- `[Tabs Extension] Loading tabs...` - loading started
- `[Tabs Extension] Loaded X tabs` - number of loaded tabs
- `[Tabs Extension] Tabs with favIconUrl: X` - tabs that contain `favIconUrl`

### Favicon Loading
- `[Tabs Extension] Using favIconUrl for tab X` - using `favIconUrl` from tab object
- `[Tabs Extension] No favIconUrl for tab X, will try async load` - fallback to async load
- `[Tabs Extension] Attempting to load favicon for tab X` - async load started
- `[Tabs Extension] Favicon result for tab X` - favicon request result
- `[Tabs Extension] Setting favicon for tab X to URL` - favicon URL set
- `[Tabs Extension] Favicon loaded successfully for tab X` - load success
- `[Tabs Extension] Favicon load error for tab X` - load error

### Tab Clicks
- `[Tabs Extension] Tab item clicked: X` - tab click
- `[Tabs Extension] Switching to tab X` - tab activation
- `[Tabs Extension] Tab switch result: X` - activation result
- `[Tabs Extension] Action button clicked: close for tab X` - close button click
- `[Tabs Extension] Closing tab X` - tab closing

### Errors
- All errors are logged with prefix `[Tabs Extension] Error:`

## Useful Console Commands

```javascript
// Check current state
console.log('All tabs:', allTabs);
console.log('Filtered tabs:', filteredTabs);
console.log('Current window ID:', currentWindowId);
console.log('Panel visible:', panelVisible);

// Check Shadow DOM
const panel = document.getElementById('tabs-extension-panel');
const shadowRoot = panel?.shadowRoot;
console.log('Shadow root:', shadowRoot);

// Check elements in Shadow DOM
const tabItems = shadowRoot?.querySelectorAll('.tabs-tab-item');
console.log('Tab items:', tabItems);

// Check favicon for a specific tab
chrome.runtime.sendMessage({ action: 'getTabFavicon', tabId: 123 }).then(console.log);
```

## Verify Favicon Loading

1. Open Console in DevTools
2. Filter logs with `[Tabs Extension] Favicon`
3. Check which tabs include `favIconUrl`
4. Check image loading errors

## Verify Click Handling

1. Open Console in DevTools
2. Click a tab in the panel
3. Verify `[Tabs Extension] Tab item clicked` logs
4. Verify tab switch result logs
