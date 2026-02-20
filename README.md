# Vertical Tabs: compact, float

A Google Chrome extension for managing many open tabs with a compact, resizable vertical panel.

## Project Structure

```
VerticalTabs/
├── manifest.json      # Extension manifest
├── content.js         # Main in-page tabs panel logic
├── content.css        # Tabs panel styles
├── background.js      # Background/service worker logic
├── popup.html         # Popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup behavior
├── icons/             # Extension icons
└── README.md          # This file
```

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project folder

## Development Notes

- `manifest.json` - main extension configuration
- `content.js` / `content.css` - in-page vertical tabs panel
- `background.js` - tab/group operations and messaging
- `popup.html/js/css` - popup UI files

## Icons

Place extension icons in the `icons/` folder:
- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels
- `icon128.png` - 128x128 pixels

## License

MIT
