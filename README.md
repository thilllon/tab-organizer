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
pnpm build                  # Vite build -> dist/ (no type check; run typecheck separately)
pnpm typecheck              # Type check only (tsc --noEmit)
pnpm format                 # Biome check --write + Prettier (md/mdx/yml/yaml) + mise format (ruff)
pnpm test                   # Run tests (vitest)
pnpm listing                # Regenerate docs/description.txt (Chrome Web Store text) from docs/README.md
pnpm release                # release-it: regenerate CWS assets, bump version, build, ZIP, GitHub release
```

The `dist` folder will contain the production-ready extension.

## Chrome Web Store listing

Everything shown on the store page — description, screenshots, promo images, demo video, privacy disclosures — lives in [`docs/README.md`](docs/README.md). The plain-text description the store needs (`docs/description.txt`) is generated from it, so edit the Markdown and never the `.txt`.
