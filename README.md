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

|                               |                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **▸ One-click sorting**       | Click the toolbar icon. No menus, no dialogs — the current window is organized instantly.                                                                                                                                                                                                                                             |
| **▸ Three sort modes**        | By URL, by title, or custom grouping that keeps sites in the order you first opened them.                                                                                                                                                                                                                                             |
| **▸ Smart grouping**          | Group by full hostname (`mail.google.com` ≠ `drive.google.com`) or by domain (all of Google together, `.co.uk`-style TLDs handled).                                                                                                                                                                                                   |
| **▸ Native tab groups**       | Existing Chrome tab groups are sorted by name (prefix with `1-`, `2-` to pin an order) and tidied inside.                                                                                                                                                                                                                             |
| **▸ Duplicate detection**     | Leave duplicates alone, close all but one, or collect them into a labeled group to review first.                                                                                                                                                                                                                                      |
| **▸ Pinned & suspended tabs** | Pinned tabs stay put unless you say otherwise; tabs suspended by The Marvellous Suspender sort by their real URL.                                                                                                                                                                                                                     |
| **▸ Sessions**                | Right-click the icon → save this window or all windows. The full-page Sessions dashboard lists open windows, saved sessions and history, restores exactly (order, pinned, groups, active tab, window state) into new windows or the current one, searches every tab, and imports/exports JSON, Markdown, text, HTML bookmarks or CSV. |
| **▸ Snapshots & recovery**    | Every 5 minutes (only when something changed) a snapshot of all open windows is kept locally — the 20 most recent by default, and you choose the interval and how many to keep; protect any to keep it for good. After a crash, "Previous session (recovered)" is one click away. On by default, off in one click.                    |

## Settings

Right-click the icon → **Options** to choose the grouping level, how duplicates are handled, and the session settings: automatic snapshots on/off, their interval, how many to keep, and the lazy-restore mode.

<p align="center">
  <img src="screenshots/screenshot-1280x800.png" alt="Options page" width="640" />
</p>

## Sessions

Three ways in, none of them on the icon click (a left-click only ever sorts):

1. **Right-click the icon** → _Save this window as session_, _Save all windows as session_, _Open Sessions_. A ✓ badge confirms a save.
2. **Keyboard shortcuts** — _Save the current window as a session_ and _Open the Sessions dashboard_ are registered as Chrome commands with no preset keys; bind them at `chrome://extensions/shortcuts` (there is a button for it in Options and in the dashboard).
3. **Options** → _Open Sessions dashboard_.

The dashboard is a full extension page (`dashboard.html`), opened once and re-focused thereafter. It shows:

- **Open windows** — a live view of every window and tab; save, close or jump to any of them, or restore a saved window _into_ the current one.
- **Saved sessions** — rename inline, expand to windows → groups → tabs with site icons, open a single tab in the background, remove a tab or window from a session, restore a session or one window (new windows, exact order, pinned tabs, groups incl. collapsed, active tab, window state), delete with confirmation. Restores run in batches with progress and Cancel; more than 50 tabs load lazily, more than 100 ask first; unopenable URLs are skipped and reported.
- **History** — automatic snapshots every 5 min (or 10/30; on by default, off in Options or the dashboard settings), deduplicated, the newest 20 kept by default, protect / save as session / delete / delete all unprotected, and a "Previous session (recovered)" entry after Chrome restarts.
- **Search** — one box across open tabs, saved sessions and (optionally) history; `/` focuses it from anywhere on the page, `Esc` clears, arrows move, `Enter` opens the highlighted result.
- **Import / Export** — per group / window / session: JSON (round-trips exactly), Markdown, plain text, Netscape HTML (imports into Chrome bookmarks) or CSV; _Export all_ in the header writes every saved session as one JSON backup. Plus _Copy links_ and _Copy as Markdown_. Import from a file or pasted text with a preview.
- **Settings and storage** — snapshots on/off, the interval, how many snapshots to keep and the lazy-restore mode (the same four controls as the Options page), plus a storage meter splitting saved sessions from snapshots and a two-step _Delete all session data_ that keeps your settings. Light and dark follow your system setting; there is no theme switch.

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
