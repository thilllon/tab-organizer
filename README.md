# Tab Organizer

Chrome extension that sorts and organizes your browser tabs.

[![GitHub](https://img.shields.io/github/v/release/thilllon/tab-organizer)](https://github.com/thilllon/tab-organizer)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/bmbpmnfhfbdjdjpblimidmbohgccmjdg)](https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg)

Pin the extension icon and click it to instantly sort all tabs in the current window by URL.

## Features

- One-click tab sorting (by URL, title, or custom grouping)
- Tab group sorting support
- Configurable via options page

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
pnpm build                  # TypeScript check + Vite build -> dist/
pnpm typecheck              # Type check only (tsc --noEmit)
pnpm format                 # Biome check --write + Ruff format
pnpm release                # Bump version, build, and package into ZIP (via release-it)
pnpm screenshot             # Generate automated screenshots
pnpm prepare-registration   # Chrome Web Store registration helper
```

The `dist` folder will contain the production-ready extension.
