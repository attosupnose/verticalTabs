# Google Web Store Publish Checklist (Free Extension)

## 0) One-time prerequisites

- Create/confirm Google account
- Pay one-time Chrome Web Store developer fee (currently USD 5)
- Prepare support contact email

## 1) Final technical checks (before ZIP)

- Reload extension in `chrome://extensions`
- Verify no manifest errors
- Verify icons are valid:
  - `icons/icon16.png`
  - `icons/icon48.png`
  - `icons/icon128.png`
- Test core flows:
  - Open/close panel
  - Drag tabs and move to groups
  - Language toggle RU/EN
  - Search toggle, group toggle, refresh
  - Collapsed mini-button behavior
- Confirm no broken paths in `manifest.json`

## 2) Prepare store assets

Required for listing:

- Extension icon: 128x128 (already in `icons/icon128.png`)
- At least 1 screenshot (recommended 1280x800 or 640x400)

Recommended:

- 4-6 screenshots covering key features
- Short promo image and marquee promo image (optional, but improves listing quality)

## 3) Privacy and compliance

- Host privacy policy publicly (GitHub Pages/Gist/site) using `PRIVACY_POLICY.md`
- In listing, provide privacy policy URL
- In listing "Privacy practices", declare what is accessed and why:
  - Tabs metadata
  - User settings in Chrome storage
  - Favicon fetch via Google/DuckDuckGo endpoints
- Ensure "Single purpose" is clear: tab management

## 4) Create release ZIP

From project root, build ZIP with extension files (exclude `.git`, local notes, etc.).

Simple safe method:

1. Create a new temporary folder (e.g. `dist/webstore-package`)
2. Copy only runtime files:
   - `manifest.json`
   - `background.js`
   - `content.js`
   - `content.css`
   - `icons/`
   - `popup.*` / `sidepanel.*` only if intentionally shipped
3. Zip that folder content into `all-tabs-webstore-v1.0.0.zip`

## 5) Fill Web Store listing

- Name: extension display name
- Short description: 1 sentence value proposition
- Detailed description: key features + permissions rationale
- Category: Productivity
- Language(s): RU and/or EN (depending on target audience)
- Support URL (optional but recommended)
- Privacy policy URL (recommended, often required by policy flow)

## 6) Permissions rationale (copy into listing)

- `tabs`: to display and manage open tabs
- `tabGroups`: to show and manage tab groups
- `storage`: to save panel preferences
- `scripting`/`activeTab`: to initialize content UI on current tab
- Host access (`<all_urls>`): required to display panel on sites where user uses the extension

## 7) Submit and monitor

- Submit for review
- Monitor "Developer Dashboard" for policy feedback
- If rejected:
  - read exact policy item
  - patch code/listing
  - increment `version`
  - re-upload ZIP

---

## Suggested publish order (quick)

1. Reload + test in Chrome
2. Make screenshots
3. Publish privacy policy page
4. Build clean ZIP
5. Fill listing + permissions rationale
6. Submit
