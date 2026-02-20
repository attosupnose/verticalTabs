# Chrome Web Store Listing Text

## Short Description

Manage all open tabs in a compact vertical panel with fast search, tab groups, drag-and-drop, and quick actions.

## Detailed Description

Vertical Tabs: compact, float helps you manage many open tabs in Chrome with a compact, resizable vertical panel.

### Key Features

- In-page vertical tabs panel (collapsible and resizable)
- Fast search by tab title and URL
- Tab group management:
  - collapse/expand groups
  - toggle all groups
- Drag and drop:
  - reorder tabs by dragging
  - move tabs into groups
- Quick close actions:
  - close button
  - middle-click
  - Ctrl+Shift+click
- Adjustable icon layout
- Settings sync via Chrome storage

### Why Permissions Are Needed

- `tabs` - display and manage open tabs
- `tabGroups` - display and manage tab groups
- `storage` - save UI preferences
- `scripting`, `activeTab` - initialize and display the panel UI on the active page
- Host access (`<all_urls>`) - allow the panel to work on pages where users manage tabs

### Host Permission Justification

This extension has a single purpose: tab management. Host access is used only to inject and run local panel UI code on user-visited pages, so users can view, search, group, reorder, activate, and close tabs in context. The extension does not execute remote code and does not use page access for advertising or profiling.

### Privacy

The extension processes tab metadata (such as title and URL) locally to provide core tab-management functionality. It does not sell personal data and does not transfer personal data for advertising. Add your public privacy policy URL in the Chrome Web Store listing.
