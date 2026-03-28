# privacy

## purpose

Sort and organize browser tabs by URL, title, or domain, and optionally group or remove duplicate tabs in the current window

## permissions

### tabs

Required to read tab URLs and titles in the current window for sorting. The extension uses chrome.tabs.query() to retrieve tab information and chrome.tabs.move() to reorder them. No tab data is stored or transmitted externally.

### tabGroups

Required to sort existing tab groups by title and to group duplicate tabs when the user enables that option. The extension uses chrome.tabGroups.query(), chrome.tabGroups.move(), and chrome.tabGroups.update() to organize groups within the current window.

### storage

Required to persist user preferences (sort method, grouping mode, duplicate handling) across sessions using chrome.storage.sync. No personal or browsing data is stored — only the extension's settings.
