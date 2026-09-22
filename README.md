<p align="center">
  <a href="https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg">
    <img src="screenshots/promo-marquee-1400x560.png" alt="Tab Organizer — one-click tab sorting and grouping for Chrome" width="100%" />
  </a>
</p>

<h1 align="center">Tab Organizer</h1>

<p align="center">
  <strong>One click. Every tab sorted, grouped, and de-duplicated — plus sessions you can save and restore.</strong><br />
  No popup, no account, no data ever leaves your browser.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg"><img src="https://img.shields.io/chrome-web-store/v/bmbpmnfhfbdjdjpblimidmbohgccmjdg?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white" alt="Chrome Web Store" /></a>
  <a href="https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg"><img src="https://img.shields.io/chrome-web-store/users/bmbpmnfhfbdjdjpblimidmbohgccmjdg?label=users&logo=googlechrome&logoColor=white" alt="Users" /></a>
  <a href="https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg"><img src="https://img.shields.io/chrome-web-store/rating/bmbpmnfhfbdjdjpblimidmbohgccmjdg?label=rating&logo=googlechrome&logoColor=white" alt="Rating" /></a>
  <a href="https://github.com/thilllon/tab-organizer/releases"><img src="https://img.shields.io/github/v/release/thilllon/tab-organizer?logo=github" alt="GitHub release" /></a>
  <a href="https://github.com/thilllon/tab-organizer/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/thilllon/tab-organizer/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI" /></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg"><strong>➜ Install from the Chrome Web Store</strong></a>
</p>

## See it in action

Pin the icon, click it, done — every tab in the window is sorted and grouped by site:

<p align="center">
  <img src="screenshots/demo.gif" alt="Demo: one click sorts and groups all open tabs" width="800" />
</p>

<table>
  <tr>
    <th width="50%">Before</th>
    <th width="50%">After</th>
  </tr>
  <tr>
    <td><img src="screenshots/before-sort.png" alt="Before: tabs in random order" /></td>
    <td><img src="screenshots/after-sort.png" alt="After: tabs sorted and grouped by domain" /></td>
  </tr>
</table>

## Features

|                               |                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **▸ One-click sorting**       | Click the toolbar icon. No menus, no dialogs — the current window is organized instantly.                                                                                                                                                                                                                                                            |
| **▸ Three sort modes**        | By URL, by title, or custom grouping that keeps sites in the order you first opened them.                                                                                                                                                                                                                                                            |
| **▸ Smart grouping**          | Group by full hostname (`mail.google.com` ≠ `drive.google.com`) or by domain (all of Google together, `.co.uk`-style TLDs handled).                                                                                                                                                                                                                  |
| **▸ Native tab groups**       | Existing Chrome tab groups are sorted by name (prefix with `1-`, `2-` to pin an order) and tidied inside.                                                                                                                                                                                                                                            |
| **▸ Duplicate detection**     | Leave duplicates alone, close all but one, or collect them into a labeled group to review first.                                                                                                                                                                                                                                                     |
| **▸ Gather all windows**      | Right-click the icon → **Assemble!** (or a keyboard shortcut) pulls every other window's tabs into the one you are using. Tabs are moved, never reopened, so pinned tabs, groups, history and typed text stay as they were, and your current tab stays in front.                                                                                     |
| **▸ Pinned & suspended tabs** | Pinned tabs stay put unless you say otherwise; tabs suspended by The Marvellous Suspender sort by their real URL.                                                                                                                                                                                                                                    |
| **▸ Sessions**                | Right-click the icon → save all windows, or press Save on the app page. One page lists your open tabs, saved sessions and snapshots in the left column, restores exactly (order, pinned, groups, active tab, window state) into new windows or the current one, searches every tab, and imports/exports JSON, Markdown, text, HTML bookmarks or CSV. |
| **▸ Snapshots & recovery**    | Every 5 minutes (only when something changed) a snapshot of all open windows is kept locally — the 20 most recent by default, and you choose the interval and how many to keep; **Keep** moves one into your saved sessions for good. After a crash the recovered snapshot is marked in the sidebar. On by default, off in one click.                |

## The app page

Everything that is not the icon click lives on one page (`app.html`), opened once and re-focused thereafter. Three ways in, none of them on the icon click (a left-click only ever sorts):

1. **Right-click the icon → _Options_** — Chrome's own item, pointed at `app.html#settings`. The same menu carries _Assemble!_ and _Save all windows as session_ (a ✓ badge confirms a save); opening the page is left to Chrome's entry rather than repeated there.
2. **Keyboard shortcuts** — _Save the current window as a session_, _Open Tab Organizer_ and _Move the tabs of all other windows into this window_ are Chrome commands with no preset keys; bind them at `chrome://extensions/shortcuts` (Settings lists the keys you have assigned).
3. **`chrome://extensions` → Details → Extension options**.

<p align="center">
  <img src="screenshots/dashboard-sessions.png" alt="The Tab Organizer app page" width="640" />
</p>

The left column is what you have; the rest of the page is whatever you picked. Every view has its own address, so Back works and a session can be bookmarked:

| Address               | View                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.html`            | **Open tabs** — every window and tab live; one Save button, plus save, close or jump per window and tab.                                                                                                                                                     |
| `app.html#saved/<id>` | **A saved session** — click the title to rename; Open (new windows) or Open in this window; open one window or one tab; remove a tab or a window; export; delete. Clicking a saved tab that is already open switches to it instead of opening a second copy. |
| `app.html#auto/<id>`  | **A snapshot** — Open, or **Keep** to move it into the saved list. The snapshot taken before a crash is marked _recovered_ in the sidebar.                                                                                                                   |
| `app.html#search/<q>` | **Search** — open tabs and saved sessions; `/` focuses the box from anywhere, `Esc` clears, arrows move, `Enter` opens the highlighted row. Snapshots are searched only when a search finds nothing and you ask for them.                                    |
| `app.html#settings`   | **Settings** — sorting (three choices, the rest under Advanced), sessions, backup (export / import / storage / delete everything) and your keyboard shortcuts. Everything saves as you change it.                                                            |

Restores run in batches with progress and Cancel; more than 50 tabs load lazily, more than 100 ask first; unopenable URLs are skipped and reported. Export is per group / window / session: JSON (round-trips exactly), Markdown, plain text, Netscape HTML (imports into Chrome bookmarks) or CSV, plus _Copy links_ and _Copy as Markdown_; import takes a file or pasted text with a preview. Light and dark follow your system setting.

Everything lives in `chrome.storage.local` on the device — never synced, never uploaded.

## Privacy

- **Zero network requests** — works entirely offline, no analytics, no telemetry.
- **Seven permissions, no host permissions** — `tabs`, `tabGroups`, `storage` (settings via Chrome sync; sessions in local storage on this device only), `contextMenus` (icon menu), `unlimitedStorage` (large sessions), `favicon` (site icons from Chrome's local cache), `alarms` (snapshot timer; none exists when snapshots are off). Requires Chrome 123 or newer.
- **No content scripts** — nothing is ever injected into a web page.
- Full policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

Everything shown on the store page — the complete description, every asset, the privacy answers — is kept in [`docs/README.md`](docs/README.md); `docs/description.txt` is generated from it.

## Development

### Setup

```shell
pnpm install
pnpm dev
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist` folder

### Scripts

```shell
pnpm dev                    # Start Vite dev server (port 5173)
pnpm build                  # Vite build -> dist/ (no type check; run typecheck separately)
pnpm typecheck              # Type check only (tsc --noEmit)
pnpm format                 # Biome check --write + Prettier (md/mdx/yml/yaml) + mise format (ruff)
pnpm test                   # Run tests (vitest)
pnpm listing                # Regenerate docs/description.txt (Chrome Web Store text) from docs/README.md
pnpm release                # release-it: regenerate CWS assets, bump version, build, ZIP, GitHub release
```

The `dist` folder will contain the production-ready extension.
