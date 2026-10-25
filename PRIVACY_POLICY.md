# Privacy Policy - Tab Organizer

Last Updated: October 25, 2026

## Overview

Tab Organizer is a Chrome extension that sorts and organizes your browser tabs and lets you save, restore, search, import and export sets of windows and tabs as sessions. On request it also pauses the videos in your YouTube tabs. Your privacy is important to us: everything the extension does happens inside your browser, on your device.

## Data Collection

Tab Organizer does **not** collect or transmit any personal data. It makes no network requests, reads nothing from the pages you visit, and uses no analytics, tracking or telemetry. All operations are performed locally within your browser. The only thing it ever runs inside a web page is a pause for YouTube videos, and only after you allow it (see "Pausing YouTube videos" below).

### What is stored, and where

When you save a session, and while automatic snapshots are enabled (see below), the extension stores the following about your open windows in Chrome's local extension storage (`chrome.storage.local`) on this device only:

- for each tab: its URL, page title, whether it is pinned, and whether it was the active tab
- for each tab group: its name, color and whether it was collapsed
- for each window: its state (normal, minimized, maximized or fullscreen), size and position, and whether it was the focused window
- for each session: the name you gave it (or the generated default), when it was saved and last changed, and a short fingerprint of its tab layout that is used to avoid storing identical snapshots twice
- session settings: whether automatic snapshots are on, their interval, how many to keep, and how large restores are handled

Incognito windows, empty windows and the extension's own pages are never captured. Site icons shown on the Tab Organizer page come from Chrome's own favicon cache and are not stored by the extension.

This data never leaves your device: it is not synced through your Google account, not uploaded to any server, and not accessible to web pages. The only way session data leaves the extension is when you choose to export it: Export writes a file or copies text to your clipboard, on your explicit action only.

Your sorting preferences (the grouping mode and how duplicate tabs are handled) and the language you chose for the extension in Settings (if any) are stored with Chrome's sync storage, together with the version number recorded when the extension was installed or updated. If you have Chrome sync enabled, those preferences, and nothing else, may sync across devices signed into the same Chrome account. Session data and session settings are never placed in sync storage.

### Automatic snapshots

Automatic snapshots are **on by default**. Every 5 minutes (or another interval you choose, from 1 minute to 24 hours), and each time you click the icon to sort, the extension records the layout of your open windows as described above, but only when something changed since the last snapshot. Snapshots are stored in the same local storage as saved sessions and are subject to the same rules.

To turn snapshots off, open Tab Organizer (right-click the icon → Options) and switch automatic snapshots off in Settings. With snapshots off, no timer exists. The extension still wakes briefly when Chrome starts, when it is installed or updated, and when you change a setting, to keep its own saved data tidy; none of that touches the network.

### Pausing YouTube videos

"Pause all YouTube videos", in the icon's right-click menu and as a keyboard shortcut, pauses every video and audio that is playing in your open YouTube tabs, in every window. Each video keeps its place; nothing is muted, closed or reloaded.

For this the extension needs access to youtube.com (`https://*.youtube.com/*`, which covers www, m and music). It is never requested at install: Chrome asks you when you click "Allow access" in Settings (choosing the menu item before that opens Settings), and you can remove the access there, or at chrome://extensions, at any time. With that access, each time you ask, the extension runs one small function that is part of the extension itself in each YouTube tab: it presses pause and counts how many videos it paused. It does not read the page, what you watch or anything else on YouTube, and nothing about YouTube is stored or transmitted. Without the access, nothing runs in any web page.

## Data Retention

- Saved sessions are kept until you delete them in the Tab Organizer page.
- Automatic snapshots are kept in a rolling set: only the most recent unprotected snapshots are retained (20 by default; you choose how many in Settings on the Tab Organizer page), and older ones are removed automatically. A snapshot you mark as protected is kept until you delete it. The "Previous session (recovered)" snapshot created after a browser restart is protected automatically, as is the one before it; older recovered snapshots return to the rolling set and age out of it like any other. Marking one as protected yourself makes it yours to keep. Snapshots can be deleted one at a time or all at once.
- "Delete all session data" in the Tab Organizer page removes every saved session and snapshot immediately; your settings are kept.
- Uninstalling the extension makes Chrome delete all of its stored data.

## Permissions

This extension requires the following permissions:

- **tabs**: Used to read tab URLs and titles for sorting, for saving sessions and for the Tab Organizer page's list of open windows, and to create tabs when restoring a session.
- **tabGroups**: Used to sort and organize tab groups within the current window and to recreate tab groups when restoring a session.
- **storage**: Used to save your sorting preferences and language choice using Chrome's sync storage, and to store saved sessions, snapshots and session settings in local storage on this device only.
- **contextMenus**: Used to add "Assemble!", "Save all windows as session" and "Pause all YouTube videos" to the extension icon's right-click menu. No menu items are added to web pages.
- **unlimitedStorage**: Allows large saved sessions to exceed Chrome's default local storage quota. It does not change where data is stored: everything stays on your device.
- **favicon**: Used to display site icons next to tabs in the Tab Organizer page from Chrome's local favicon cache. No icons are fetched from the network and no icon data is stored by the extension.
- **alarms**: Used as the timer for automatic snapshots on the interval you choose. When automatic snapshots are turned off, no timer exists.
- **scripting**: Used only to pause YouTube videos when you ask, as described in "Pausing YouTube videos". It works only on the sites you allowed below.
- **Access to youtube.com** (optional, `https://*.youtube.com/*`): requested only when you click "Allow access" in Settings, and removable there. Used only to pause videos; nothing is read from YouTube pages.

The extension requests no host permissions at install and declares no content scripts; access to youtube.com is optional and only yours to grant. It requires Chrome 123 or newer.

## Data Usage

- Tab URLs and titles are read during sorting and are **not** stored as part of sorting.
- When you save a session, or while automatic snapshots are enabled, the data listed above is stored **only** in local extension storage on your device and is **not** transmitted to any external server.
- Sorting preferences are stored using Chrome's built-in storage API and are never shared with third parties or external servers.
- Nothing is ever sold, shared, or used for any purpose other than sorting tabs, pausing YouTube videos when you ask, and saving, restoring, searching, importing and exporting sessions.

## Third-Party Services

Tab Organizer does **not** use any third-party analytics, tracking, or data collection services.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be posted on this page with an updated "Last Updated" date.

## Contact

If you have any questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/thilllon/tab-organizer/issues).
