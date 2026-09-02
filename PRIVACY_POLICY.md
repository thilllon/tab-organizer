# Privacy Policy - Tab Organizer

Last Updated: September 2, 2026

## Overview

Tab Organizer is a Chrome extension that sorts and organizes your browser tabs and lets you save, restore, search, import and export sets of windows and tabs as sessions. Your privacy is important to us: everything the extension does happens inside your browser, on your device.

## Data Collection

Tab Organizer does **not** collect or transmit any personal data. It makes no network requests, has no host permissions, injects no scripts into web pages, and uses no analytics, tracking or telemetry. All operations are performed locally within your browser.

### What is stored, and where

When you save a session, and while automatic snapshots are enabled (see below), the extension stores the following about your open windows in Chrome's local extension storage (`chrome.storage.local`) on this device only:

- for each tab: its URL, page title, whether it is pinned, and whether it was the active tab
- for each tab group: its name, color and whether it was collapsed
- for each window: its state (normal, minimized, maximized or fullscreen), size and position, and whether it was the focused window
- for each session: the name you gave it (or the generated default), when it was saved and last changed, and a short fingerprint of its tab layout that is used to avoid storing identical snapshots twice
- session settings: whether automatic snapshots are on, their interval, how many to keep, and how large restores are handled

Incognito windows, empty windows and the extension's own pages are never captured. Site icons shown in the dashboard come from Chrome's own favicon cache and are not stored by the extension.

This data never leaves your device: it is not synced through your Google account, not uploaded to any server, and not accessible to web pages. The only way session data leaves the extension is when you choose to export it — Export writes a file or copies text to your clipboard, on your explicit action only.

Your sorting preferences (sort method, grouping mode, duplicate handling) are stored with Chrome's sync storage. If you have Chrome sync enabled, those preferences — and nothing else — may sync across devices signed into the same Chrome account. Session data and session settings are never placed in sync storage.

### Automatic snapshots

Automatic snapshots are **on by default**. Every 5 minutes (you can choose 10 or 30 instead), and right before each sort when you click the icon, the extension records the layout of your open windows as described above, but only when something changed since the last snapshot. Snapshots are stored in the same local storage as saved sessions and are subject to the same rules.

To turn snapshots off, open Options (right-click the icon → Options) or the settings in the Sessions dashboard and switch automatic snapshots off. With snapshots off, no timer exists and the extension runs only when you use it.

## Data Retention

- Saved sessions are kept until you delete them in the Sessions dashboard.
- Automatic snapshots are kept in a rolling set: only the 20 most recent unprotected snapshots are retained, and older ones are removed automatically. A snapshot you mark as protected, and the "Previous session (recovered)" snapshot created after a browser restart, are kept until you delete them. Snapshots can be deleted one at a time or all at once.
- "Delete all session data" in the Sessions dashboard removes every saved session and snapshot immediately.
- Uninstalling the extension makes Chrome delete all of its stored data.

## Permissions

This extension requires the following permissions:

- **tabs**: Used to read tab URLs and titles for sorting, for saving sessions and for the dashboard's list of open windows, and to create tabs when restoring a session.
- **tabGroups**: Used to sort and organize tab groups within the current window and to recreate tab groups when restoring a session.
- **storage**: Used to save your sorting preferences using Chrome's sync storage, and to store saved sessions, snapshots and session settings in local storage on this device only.
- **contextMenus**: Used to add "Save this window as session", "Save all windows as session" and "Open Sessions" to the extension icon's right-click menu. No menu items are added to web pages.
- **unlimitedStorage**: Allows large saved sessions to exceed Chrome's default local storage quota. It does not change where data is stored — everything stays on your device.
- **favicon**: Used to display site icons next to tabs in the Sessions dashboard from Chrome's local favicon cache. No icons are fetched from the network and no icon data is stored by the extension.
- **alarms**: Used as the timer for automatic snapshots on the interval you choose. When automatic snapshots are turned off, no timer exists.

The extension requests no host permissions and uses no content scripts. It requires Chrome 123 or newer.

## Data Usage

- Tab URLs and titles are read during sorting and are **not** stored as part of sorting.
- When you save a session, or while automatic snapshots are enabled, the data listed above is stored **only** in local extension storage on your device and is **not** transmitted to any external server.
- Sorting preferences are stored using Chrome's built-in storage API and are never shared with third parties or external servers.
- Nothing is ever sold, shared, or used for any purpose other than sorting tabs and saving, restoring, searching, importing and exporting sessions.

## Third-Party Services

Tab Organizer does **not** use any third-party analytics, tracking, or data collection services.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be posted on this page with an updated "Last Updated" date.

## Contact

If you have any questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/thilllon/tab-organizer/issues).
