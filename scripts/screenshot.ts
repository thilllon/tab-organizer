import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BrowserContext, chromium, type Worker } from '@playwright/test'

/*
 * Types
 */

interface WindowBounds {
  id: number
  x: number
  y: number
  width: number
  height: number
}

interface TabInfo {
  url: string
  title: string
  favIconUrl: string
  active: boolean
  groupColor?: string | null
}

/*
 * Constants
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const EXTENSION_PATH = path.join(ROOT, 'dist')
const DIR = path.join(ROOT, 'screenshots')
const TEMPLATE_PATH = path.join(__dirname, 'tab-bar-template.html')
const GET_WINDOW_ID_SCRIPT = path.join(__dirname, 'get-window-id.py')

const GROUP_COLORS: Record<string, string> = {
  blue: '#8ab4f8',
  red: '#f28b82',
  yellow: '#fdd663',
  green: '#81c995',
  pink: '#ff8bcb',
  purple: '#c58af9',
  cyan: '#78d9ec',
  orange: '#fcad70',
}

const DEMO_SITES = [
  'https://news.ycombinator.com',
  'https://www.youtube.com',
  'https://www.youtube.com/feed/trending',
  'https://github.com',
  'https://github.com/trending',
  'https://www.google.com',
  'https://www.google.com/maps',
  'https://www.amazon.com',
  'https://en.wikipedia.org',
  'https://stackoverflow.com',
  'https://www.reddit.com',
  'https://www.reddit.com/r/programming',
]

/*
 * Entry point
 */

async function main(): Promise<void> {
  const screenshot = new Screenshot()
  await screenshot.run()
}

/*
 * Screenshot class
 */

class Screenshot {
  private context: BrowserContext | null = null
  private sw: Worker | null = null
  private extensionId = ''

  constructor() {
    mkdirSync(DIR, { recursive: true })
  }

  /* Utility methods */

  private static delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  private getWindowBounds(): WindowBounds | null {
    const venvPython = path.join(ROOT, '.venv', 'bin', 'python')
    const cmds = [
      `"${venvPython}" "${GET_WINDOW_ID_SCRIPT}" --bounds`,
      `uv run "${GET_WINDOW_ID_SCRIPT}" --bounds`,
      `python3 "${GET_WINDOW_ID_SCRIPT}" --bounds`,
    ]
    for (const cmd of cmds) {
      try {
        const json = execSync(cmd, { encoding: 'utf-8', cwd: ROOT }).trim()
        return JSON.parse(json)
      } catch {
        /* try next */
      }
    }
    return null
  }

  private tryMacCapture(filename: string): boolean {
    try {
      const bounds = this.getWindowBounds()
      if (!bounds) {
        return false
      }
      execSync(`screencapture -l${bounds.id} -x "${filename}"`, { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  private buildTabBarHtml(tabs: TabInfo[], title: string): string {
    const template = readFileSync(TEMPLATE_PATH, 'utf-8')
    const tabItems = tabs
      .map(
        (t) => `
    <div class="tab ${t.active ? 'active' : ''}" ${t.groupColor ? `style="border-top: 3px solid ${t.groupColor}"` : ''}>
      <img src="${t.favIconUrl || `https://www.google.com/s2/favicons?domain=${new URL(t.url).hostname}&sz=32`}" width="16" height="16" onerror="this.style.display='none'"/>
      <span class="title">${t.title?.slice(0, 28) || new URL(t.url).hostname}</span>
    </div>`,
      )
      .join('\n')

    return template.replace(/\{\{TITLE\}\}/g, title).replace('{{TABS}}', tabItems)
  }

  /* Step methods */

  private async launchBrowser(): Promise<void> {
    console.log('Launching Chromium with extension...')
    this.context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
        '--window-size=1400,900',
        '--window-position=100,50',
      ],
    })

    let sw = this.context.serviceWorkers()[0]
    if (!sw) {
      sw = await this.context.waitForEvent('serviceworker', { timeout: 5000 })
    }
    this.sw = sw
    this.extensionId = sw.url().split('/')[2]
    console.log(`Extension ID: ${this.extensionId}`)
  }

  private async takeOptionsScreenshots(): Promise<void> {
    if (!this.context) {
      return
    }
    console.log('Taking options page screenshots...')
    const optionsUrl = `chrome-extension://${this.extensionId}/options.html`

    for (const { width, height } of [
      { width: 1280, height: 800 },
      { width: 640, height: 400 },
    ]) {
      const page = await this.context.newPage()
      await page.setViewportSize({ width, height })
      await page.goto(optionsUrl)
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('main', { timeout: 5000 })
      await page.waitForTimeout(500)

      const filepath = path.join(DIR, `screenshot-${width}x${height}.png`)
      await page.screenshot({ path: filepath, fullPage: false })
      console.log(`  Saved: ${filepath}`)
      await page.close()
    }
  }

  private async openDemoTabs(): Promise<void> {
    if (!this.context) {
      return
    }
    console.log('Opening tabs...')

    for (const url of DEMO_SITES) {
      const page = await this.context.newPage()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    }

    const allPages = this.context.pages()
    if (allPages.length > DEMO_SITES.length) {
      await allPages[0].close()
    }

    console.log('Waiting for pages to settle...')
    await Screenshot.delay(5000)
    await this.context.pages()[0].bringToFront()
    await Screenshot.delay(1000)
  }

  private async captureTabInfo(): Promise<TabInfo[]> {
    if (!this.sw) {
      return []
    }
    return this.sw.evaluate(async () => {
      const win = await chrome.windows.getCurrent()
      const tabs = await chrome.tabs.query({ windowId: win.id })
      return tabs.map((t) => ({
        url: t.url ?? '',
        title: t.title ?? '',
        favIconUrl: t.favIconUrl ?? '',
        active: t.active,
      }))
    })
  }

  private async startVideoRecording(): Promise<ChildProcess | null> {
    try {
      const deviceInfo = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', {
        encoding: 'utf-8',
      })
      const screenMatch = deviceInfo.match(/\[(\d+)] Capture screen/)
      const screenIndex = screenMatch ? screenMatch[1] : '1'

      const bounds = this.getWindowBounds()
      const isRetina = execSync('system_profiler SPDisplaysDataType 2>/dev/null || true', {
        encoding: 'utf-8',
      }).includes('Retina')
      const scale = isRetina ? 2 : 1
      const cropFilter = bounds
        ? `-vf crop=${bounds.width * scale}:${bounds.height * scale}:${bounds.x * scale}:${bounds.y * scale}`
        : ''

      const proc = spawn(
        'ffmpeg',
        [
          '-y',
          '-f',
          'avfoundation',
          '-capture_cursor',
          '0',
          '-framerate',
          '30',
          '-i',
          `${screenIndex}:none`,
          '-t',
          '15',
          ...(cropFilter ? cropFilter.split(' ') : []),
          '-vcodec',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          path.join(DIR, 'demo.mp4'),
        ],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      )
      console.log(
        `Video recording started...${bounds ? ` (cropped to ${bounds.width}x${bounds.height})` : ''}`,
      )
      await Screenshot.delay(2000)
      return proc
    } catch {
      console.log('ffmpeg not available, skipping video')
      return null
    }
  }

  private async stopVideoRecording(proc: ChildProcess): Promise<void> {
    await Screenshot.delay(2000)
    proc.stdin?.write('q')
    await new Promise<void>((resolve) => {
      proc.on('close', resolve)
      setTimeout(resolve, 5000)
    })
    console.log('  Video saved: screenshots/demo.mp4')
  }

  private async sortAndGroupTabs(): Promise<TabInfo[]> {
    if (!this.sw) {
      return []
    }
    return this.sw.evaluate(async () => {
      const currentWindow = await chrome.windows.getCurrent()
      const tabs = await chrome.tabs.query({ windowId: currentWindow.id })

      const sorted = [...tabs].sort((a, b) => {
        try {
          const hostA = new URL(a.url || '').hostname.replace('www.', '')
          const hostB = new URL(b.url || '').hostname.replace('www.', '')
          return hostA.localeCompare(hostB)
        } catch {
          return 0
        }
      })

      for (let i = 0; i < sorted.length; i++) {
        const tabId = sorted[i].id
        if (tabId !== undefined) {
          await chrome.tabs.move(tabId, { index: i })
        }
      }

      const domainMap = new Map<string, number[]>()
      const updatedTabs = await chrome.tabs.query({ windowId: currentWindow.id })
      for (const tab of updatedTabs) {
        try {
          const host = new URL(tab.url || '').hostname.replace('www.', '')
          if (!domainMap.has(host)) {
            domainMap.set(host, [])
          }
          const ids = domainMap.get(host)
          if (ids && tab.id !== undefined) {
            ids.push(tab.id)
          }
        } catch {
          /* skip */
        }
      }

      const colors = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const
      const groupInfo: { domain: string; color: string }[] = []
      let idx = 0
      for (const [domain, tabIds] of domainMap) {
        if (tabIds.length > 1 && tabIds.every((id) => id !== undefined)) {
          const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] })
          const color = colors[idx % colors.length]
          await chrome.tabGroups.update(groupId, { title: domain.split('.')[0], color })
          groupInfo.push({ domain, color })
          idx++
        }
      }

      const finalTabs = await chrome.tabs.query({ windowId: currentWindow.id })
      return finalTabs.map((t) => {
        const host = new URL(t.url || '').hostname.replace('www.', '')
        const group = groupInfo.find((g) => g.domain === host)
        return {
          url: t.url ?? '',
          title: t.title ?? '',
          favIconUrl: t.favIconUrl ?? '',
          active: t.active,
          groupColor: group?.color || null,
        }
      })
    })
  }

  private async takeMockupScreenshots(beforeTabs: TabInfo[], afterTabs: TabInfo[]): Promise<void> {
    if (!this.context) {
      return
    }
    console.log('Rendering tab bar mockups...')

    const afterTabsWithColors = afterTabs.map((t) => ({
      ...t,
      groupColor: t.groupColor ? GROUP_COLORS[t.groupColor] || t.groupColor : null,
    }))

    const beforeHtml = this.buildTabBarHtml(beforeTabs, 'Before \u2014 Tabs in random order')
    const afterHtml = this.buildTabBarHtml(
      afterTabsWithColors,
      'After \u2014 Sorted and grouped by domain',
    )

    const beforePath = path.join(DIR, 'before-sort.html')
    const afterPath = path.join(DIR, 'after-sort.html')
    writeFileSync(beforePath, beforeHtml)
    writeFileSync(afterPath, afterHtml)

    const screenshotPage = await this.context.newPage()
    await screenshotPage.setViewportSize({ width: 1280, height: 800 })

    await screenshotPage.goto(`file://${beforePath}`)
    await screenshotPage.waitForTimeout(1000)
    await screenshotPage.screenshot({
      path: path.join(DIR, 'before-sort.png'),
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    })
    console.log('  Saved: screenshots/before-sort.png')

    await screenshotPage.goto(`file://${afterPath}`)
    await screenshotPage.waitForTimeout(1000)
    await screenshotPage.screenshot({
      path: path.join(DIR, 'after-sort.png'),
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    })
    console.log('  Saved: screenshots/after-sort.png')
  }

  /* Main runner */

  async run(): Promise<void> {
    await this.launchBrowser()
    await this.takeOptionsScreenshots()
    await this.openDemoTabs()

    const beforeTabs = await this.captureTabInfo()
    console.log(`  ${beforeTabs.length} tabs open`)

    const nativeBefore = this.tryMacCapture(path.join(DIR, 'before-sort-native.png'))
    if (nativeBefore) {
      console.log('  Native BEFORE screenshot captured!')
    }

    const ffmpeg = await this.startVideoRecording()

    console.log('Sorting and grouping tabs...')
    const afterTabs = await this.sortAndGroupTabs()

    await Screenshot.delay(3000)
    this.context?.pages()[0]?.bringToFront()
    await Screenshot.delay(1000)

    const nativeAfter = this.tryMacCapture(path.join(DIR, 'after-sort-native.png'))
    if (nativeAfter) {
      console.log('  Native AFTER screenshot captured!')
    }

    // Stop video BEFORE opening HTML mockup pages
    if (ffmpeg) {
      await this.stopVideoRecording(ffmpeg)
    }

    await this.takeMockupScreenshots(beforeTabs, afterTabs)

    await this.context?.close()
    console.log('\nDone! Screenshots saved to screenshots/')
    if (!nativeBefore) {
      console.log(
        '\nTip: Grant screen recording permission to Terminal for native browser screenshots:',
      )
      console.log(
        '  System Settings \u2192 Privacy & Security \u2192 Screen Recording \u2192 Toggle on your terminal',
      )
    }
  }
}

main()
