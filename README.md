# Tab Organizer

Chrome extension that sorts and organizes your browser tabs.

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

### Build

```shell
pnpm build
```

The `dist` folder will contain the production-ready extension.
