# Favicon Loading Methods

## Current Implementation

The extension uses multiple favicon loading methods with priority order.

### Method 1: Chrome Tabs API (via background script)
**How it works:**
- Uses `chrome.tabs.get(tabId)` to read `favIconUrl`
- Works for active and inactive tabs
- Most reliable when Chrome already has favicon data

**Pros:**
- Works for all tabs
- Uses favicon data already available in Chrome
- No extra network parsing

**Cons:**
- `favIconUrl` can be empty for some inactive tabs
- Requires messaging between content script and background script

### Method 2: Direct loading by site URL
**How it works:**
- Builds potential favicon URLs from tab URL
- Tries URLs in sequence

**URL options used:**
1. Google Favicon Service: `https://www.google.com/s2/favicons?domain=...`
2. DuckDuckGo Favicon Service: `https://icons.duckduckgo.com/ip3/...`

**Pros:**
- Works even when `favIconUrl` is missing
- Provides fallback options
- Google service works for many websites

**Cons:**
- Can be slower due to additional requests
- Some domains can fail due to availability/CORS-related behavior

## Loading Priority

1. `favIconUrl` from tab object (if present)
2. Google Favicon Service (initial source)
3. Async load via background script (if `favIconUrl` is empty)
4. Direct load by URL (if background script did not help)
5. Fallback icon (if all methods fail)

## Alternative Methods (Not Implemented)

### Method 3: Parse page HTML
Could parse page HTML for `<link rel="icon">`, but:
- Requires reading page content
- Slower with many tabs
- Not ideal for this architecture

### Method 4: `chrome://favicon/`
Chrome protocol for favicon access, but:
- Not suitable for content script usage
- More limited for this extension flow

### Method 5: Other external services
- **Favicon.io** (API-based)
- **Icon Horse** (public API)
- **Favicon Grabber** (page parsing approach)

## Recommendations

The current approach is a practical balance:
- Fast initial load through Google Favicon Service
- Reliable fallback through background-script flow
- Multiple URL options for broader coverage

Possible future improvements:
1. Better favicon URL caching strategy
2. Preload strategy in service worker
3. Retry strategy with exponential backoff
