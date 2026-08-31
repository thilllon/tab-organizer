# Privacy Policy - Tab Organizer

Last Updated: August 30, 2026

## Overview

Tab Organizer is a Chrome extension that sorts and organizes your browser tabs and lets you save and restore sets of windows and tabs as sessions. Your privacy is important to us.

## Data Collection

Tab Organizer does **not** collect or transmit any personal data. It makes no network requests and uses no analytics, tracking or telemetry. All operations are performed locally within your browser.

When you save a session (and, from version 7.0.0 / Phase 3, while automatic snapshots are enabled — they will be on by default and can be turned off in Options), the extension stores the following about your open windows **locally on your device only**, in Chrome's extension storage (`chrome.storage.local`):

- tab URLs and page titles
- pinned state and which tab was active
- tab group names, colors and collapsed state
- window size, position and state

This data never leaves your device: it is not synced through your Google account, not uploaded to any server, and not accessible to web pages. Incognito windows are never captured.

## Permissions

This extension requires the following permissions:

- **tabs**: Used to read tab URLs and titles for sorting and for saving sessions, and to create tabs when restoring a session.
- **tabGroups**: Used to sort and organize tab groups within the current window and to recreate tab groups when restoring a session.
- **storage**: Used to save your sorting preferences using Chrome's sync storage (if you have Chrome sync enabled, these preferences may sync across your devices signed into the same Chrome account) and to store saved sessions and snapshots in local storage on this device only. Session data is never synced.
- **contextMenus**: Used to add "Save this window as session", "Save all windows as session" and "Open Sessions" to the extension icon's right-click menu. No menu items are added to web pages.
- **unlimitedStorage**: Allows large saved sessions to exceed Chrome's default local storage quota. It does not change where data is stored — everything stays on your device.
- **favicon**: Used to display site icons next to saved tabs in the Sessions dashboard from Chrome's local favicon cache. No icons are fetched from the network and no icon data is stored by the extension.
- **alarms** (from version 7.0.0, Phase 3): Used as a timer for automatic snapshots on the interval you choose. When automatic snapshots are turned off, no timer exists.

## Data Usage

- Tab URLs and titles are read during sorting and are **not** stored as part of sorting.
- When you save a session or automatic snapshots are enabled, tab URLs, titles and window/group layout are stored **only** in local extension storage on your device and are **not** transmitted to any external server.
- Sorting preferences are stored using Chrome's built-in storage API and are never shared with third parties or external servers.
- Nothing is ever sold, shared, or used for any purpose other than sorting tabs and saving/restoring sessions.

## Data Retention

- Saved sessions are kept until you delete them in the Sessions dashboard.
- Uninstalling the extension makes Chrome delete all of its stored data.

## Third-Party Services

Tab Organizer does **not** use any third-party analytics, tracking, or data collection services.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be posted on this page with an updated "Last Updated" date.

## Contact

If you have any questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/thilllon/tab-organizer/issues).
