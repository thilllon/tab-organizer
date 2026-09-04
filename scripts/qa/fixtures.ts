/**
 * Realistic `Session` fixtures for release screenshots and QA, plus the code that writes them
 * straight into `chrome.storage.local` through the extension service worker.
 *
 * The shapes here mirror `src/types.ts` (imported by relative path — these scripts run under
 * `tsx`, which does not know Vite's `@/` alias). Chrome runtime ids are never part of a snapshot,
 * so nothing in here needs a live browser to be built: the fixtures are plain data.
 */

import type { Worker } from '@playwright/test';
import {
  type GroupSnapshot,
  SESSION_SCHEMA_VERSION,
  type Session,
  type SessionIndex,
  type SessionSummary,
  type TabSnapshot,
  type WindowSnapshot,
} from '../../src/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface TabSeed {
  url: string;
  title: string;
}

/** A pool of plausible, boring, work-day tabs. Nothing here is ever fetched. */
const TAB_POOL: TabSeed[] = [
  { url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox (12) — Gmail' },
  { url: 'https://calendar.google.com/calendar/u/0/r/week', title: 'Team calendar — Week' },
  {
    url: 'https://github.com/acme/tab-organizer/pulls',
    title: 'Pull requests · acme/tab-organizer',
  },
  {
    url: 'https://github.com/acme/tab-organizer/issues/412',
    title: 'Restore order is wrong · Issue #412',
  },
  { url: 'https://github.com/acme/tab-organizer/actions', title: 'Actions · acme/tab-organizer' },
  {
    url: 'https://developer.chrome.com/docs/extensions/reference/api/tabGroups',
    title: 'chrome.tabGroups — Chrome for Developers',
  },
  {
    url: 'https://developer.chrome.com/docs/extensions/reference/api/storage',
    title: 'chrome.storage — Chrome for Developers',
  },
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API',
    title: 'Web Locks API — MDN',
  },
  {
    url: 'https://stackoverflow.com/questions/tagged/google-chrome-extension',
    title: 'Newest questions — Stack Overflow',
  },
  { url: 'https://news.ycombinator.com/', title: 'Hacker News' },
  { url: 'https://www.figma.com/file/sessions-dashboard', title: 'Sessions dashboard — Figma' },
  {
    url: 'https://linear.app/acme/issue/TAB-118',
    title: 'TAB-118 Session import preview — Linear',
  },
  { url: 'https://linear.app/acme/team/TAB/cycle/active', title: 'Active cycle — Linear' },
  {
    url: 'https://docs.google.com/document/d/sessions-spec/edit',
    title: 'Sessions spec — Google Docs',
  },
  { url: 'https://www.notion.so/acme/Release-checklist', title: 'Release checklist — Notion' },
  { url: 'https://vitejs.dev/guide/build.html', title: 'Building for Production — Vite' },
  { url: 'https://react.dev/reference/react/useEffect', title: 'useEffect — React' },
  { url: 'https://tailwindcss.com/docs/upgrade-guide', title: 'Upgrade guide — Tailwind CSS' },
  {
    url: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
    title: 'Narrowing — TypeScript',
  },
  { url: 'https://biomejs.dev/linter/rules/', title: 'Lint rules — Biome' },
  { url: 'https://vitest.dev/api/expect.html', title: 'expect — Vitest' },
  { url: 'https://playwright.dev/docs/chrome-extensions', title: 'Chrome extensions — Playwright' },
  {
    url: 'https://chromewebstore.google.com/category/extensions/productivity',
    title: 'Productivity — Chrome Web Store',
  },
  { url: 'https://www.youtube.com/watch?v=extension-deep-dive', title: 'MV3 deep dive — YouTube' },
  { url: 'https://en.wikipedia.org/wiki/Tab_(interface)', title: 'Tab (interface) — Wikipedia' },
  {
    url: 'https://www.google.com/search?q=chrome+session+manager',
    title: 'chrome session manager — Google Search',
  },
  { url: 'https://excalidraw.com/#room=restore-flow', title: 'Restore flow — Excalidraw' },
  { url: 'https://sentry.io/organizations/acme/issues/?query=restore', title: 'Issues — Sentry' },
  {
    url: 'https://analytics.google.com/analytics/web/#/report-home',
    title: 'Reports snapshot — Analytics',
  },
  { url: 'https://www.reddit.com/r/chrome_extensions/', title: 'r/chrome_extensions' },
];

function seedAt(index: number): TabSeed {
  const seed = TAB_POOL[index % TAB_POOL.length];
  const round = Math.floor(index / TAB_POOL.length);
  if (round === 0) {
    return seed;
  }
  // Keep every url distinct once the pool wraps, without inventing new hostnames.
  const separator = seed.url.includes('?') ? '&' : '?';
  return { url: `${seed.url}${separator}page=${round + 1}`, title: `${seed.title} (${round + 1})` };
}

interface GroupPlan extends GroupSnapshot {
  /** How many of this window's tabs belong to the group. */
  size: number;
}

interface WindowPlan {
  pinned: number;
  groups: GroupPlan[];
  /** Tabs outside any group. */
  loose: number;
  state?: WindowSnapshot['state'];
  focused?: boolean;
  bounds?: WindowSnapshot['bounds'];
}

/**
 * Builds one window: pinned tabs first (a Chrome invariant the snapshot keeps), then each group's
 * tabs contiguously, then the ungrouped ones. Exactly one tab is active, and it is never inside a
 * collapsed group — the same invariants `planRestore` enforces.
 */
function buildWindow(plan: WindowPlan, cursor: { index: number }): WindowSnapshot {
  const tabs: TabSnapshot[] = [];
  const groups: GroupSnapshot[] = plan.groups.map(({ size: _size, ...group }) => group);

  for (let i = 0; i < plan.pinned; i++) {
    const seed = seedAt(cursor.index++);
    tabs.push({ url: seed.url, title: seed.title, pinned: true, active: false });
  }

  plan.groups.forEach((group, groupIndex) => {
    for (let i = 0; i < group.size; i++) {
      const seed = seedAt(cursor.index++);
      tabs.push({ url: seed.url, title: seed.title, pinned: false, active: false, groupIndex });
    }
  });

  for (let i = 0; i < plan.loose; i++) {
    const seed = seedAt(cursor.index++);
    tabs.push({ url: seed.url, title: seed.title, pinned: false, active: false });
  }

  // Prefer a loose tab, then a tab in an expanded group, then a pinned one.
  const activeIndex = tabs.findIndex(
    (tab) => !tab.pinned && tab.groupIndex === undefined && tab.active === false,
  );
  const fallbackIndex = tabs.findIndex(
    (tab) => tab.groupIndex === undefined || groups[tab.groupIndex].collapsed === false,
  );
  const chosen = activeIndex >= 0 ? activeIndex : Math.max(fallbackIndex, 0);
  if (tabs.length > 0) {
    tabs[chosen] = { ...tabs[chosen], active: true };
  }

  const snapshot: WindowSnapshot = {
    state: plan.state ?? 'normal',
    focused: plan.focused ?? false,
    groups,
    tabs,
  };
  if (snapshot.state === 'normal') {
    snapshot.bounds = plan.bounds ?? { left: 60, top: 40, width: 1440, height: 900 };
  }
  return snapshot;
}

interface SessionPlan {
  id: string;
  name: string;
  kind: Session['kind'];
  origin: Session['origin'];
  /** Milliseconds before `now`. */
  ago: number;
  windows: WindowPlan[];
  protected?: boolean;
}

function buildSession(plan: SessionPlan, now: number): Session {
  const cursor = { index: 0 };
  const at = now - plan.ago;
  const session: Session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: plan.id,
    kind: plan.kind,
    name: plan.name,
    origin: plan.origin,
    createdAt: at,
    updatedAt: at,
    windows: plan.windows.map((window) => buildWindow(window, cursor)),
  };
  if (plan.protected !== undefined) {
    session.protected = plan.protected;
  }
  return session;
}

/**
 * The dashboard screenshot fixture: two saved sessions (one small enough to read when expanded,
 * one large enough — over 100 tabs — to trigger the restore confirm dialog) and three automatic
 * history snapshots.
 */
export function buildDashboardFixtures(now: number = Date.now()): Session[] {
  const plans: SessionPlan[] = [
    {
      id: 'ffffffff-0000-4000-8000-000000000001',
      name: 'Work — Monday morning',
      kind: 'saved',
      origin: 'manual',
      ago: 4 * MINUTE,
      windows: [
        {
          pinned: 2,
          groups: [
            { title: 'Review', color: 'blue', collapsed: false, size: 4 },
            { title: 'Docs', color: 'green', collapsed: true, size: 3 },
          ],
          loose: 2,
          focused: true,
          bounds: { left: 40, top: 40, width: 1512, height: 945 },
        },
        {
          pinned: 1,
          groups: [{ title: 'Reading', color: 'purple', collapsed: false, size: 3 }],
          loose: 2,
          bounds: { left: 200, top: 120, width: 1280, height: 800 },
        },
      ],
    },
    {
      id: 'ffffffff-0000-4000-8000-000000000002',
      name: 'Research — everything open',
      kind: 'saved',
      origin: 'manual',
      ago: 25 * MINUTE,
      windows: [
        {
          pinned: 3,
          groups: [
            { title: 'Chrome APIs', color: 'cyan', collapsed: false, size: 14 },
            { title: 'Prior art', color: 'orange', collapsed: true, size: 12 },
          ],
          loose: 11,
        },
        {
          pinned: 2,
          groups: [
            { title: 'Specs', color: 'pink', collapsed: false, size: 16 },
            { title: 'Benchmarks', color: 'yellow', collapsed: false, size: 9 },
          ],
          loose: 10,
        },
        {
          pinned: 1,
          groups: [{ title: 'Inbox zero', color: 'red', collapsed: true, size: 18 }],
          loose: 16,
        },
      ],
    },
    {
      id: 'ffffffff-0000-4000-8000-000000000003',
      name: 'Snapshot — 40 minutes ago',
      kind: 'history',
      origin: 'alarm',
      ago: 40 * MINUTE,
      windows: [
        {
          pinned: 2,
          groups: [{ title: 'Review', color: 'blue', collapsed: false, size: 5 }],
          loose: 4,
          focused: true,
        },
        { pinned: 0, groups: [], loose: 6 },
      ],
    },
    {
      id: 'ffffffff-0000-4000-8000-000000000004',
      name: 'Snapshot — 2 hours ago',
      kind: 'history',
      origin: 'alarm',
      ago: 2 * HOUR,
      windows: [
        {
          pinned: 2,
          groups: [{ title: 'Review', color: 'blue', collapsed: false, size: 4 }],
          loose: 5,
        },
      ],
    },
    {
      id: 'ffffffff-0000-4000-8000-000000000005',
      name: 'Recovered — before the crash',
      kind: 'history',
      origin: 'recovered',
      ago: 26 * HOUR,
      protected: true,
      windows: [
        {
          pinned: 1,
          groups: [{ title: 'Docs', color: 'green', collapsed: false, size: 6 }],
          loose: 7,
        },
        { pinned: 0, groups: [], loose: 3 },
      ],
    },
  ];

  return plans.map((plan) => buildSession(plan, now));
}

/** Session ids of the fixture, by role, so callers do not hard-code the UUIDs. */
export const FIXTURE_IDS = {
  small: 'ffffffff-0000-4000-8000-000000000001',
  large: 'ffffffff-0000-4000-8000-000000000002',
} as const;

export function countTabs(session: Session): number {
  return session.windows.reduce((sum, window) => sum + window.tabs.length, 0);
}

/** Mirrors `sessionRepo`'s index entry so the dashboard's `reconcile()` finds nothing to repair. */
export function toSummary(session: Session, bytes: number): SessionSummary {
  const summary: SessionSummary = {
    id: session.id,
    kind: session.kind,
    name: session.name,
    origin: session.origin,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    windowCount: session.windows.length,
    tabCount: countTabs(session),
    bytes,
  };
  if (session.protected !== undefined) {
    summary.protected = session.protected;
  }
  if (session.contentHash !== undefined) {
    summary.contentHash = session.contentHash;
  }
  return summary;
}

/**
 * Replaces whatever the profile holds with `sessions`: every `session:<id>` body plus the
 * `sessionIndex` entry that lists them, written from inside the extension service worker so the
 * dashboard sees exactly what a real save would have left behind.
 */
export async function seedSessions(worker: Worker, sessions: Session[]): Promise<void> {
  const index: SessionIndex = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessions: sessions
      .map((session) =>
        toSummary(session, new TextEncoder().encode(JSON.stringify(session)).length),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };

  await worker.evaluate(
    async (payload: { sessions: Session[]; index: SessionIndex }) => {
      const area = chrome.storage.local;
      const existing =
        typeof area.getKeys === 'function'
          ? await area.getKeys()
          : Object.keys(await area.get(null));
      const stale = existing.filter((key) => key.startsWith('session:'));
      if (stale.length > 0) {
        await area.remove(stale);
      }
      const records: Record<string, unknown> = { sessionIndex: payload.index };
      for (const session of payload.sessions) {
        records[`session:${session.id}`] = session;
      }
      await area.set(records);
    },
    { sessions, index },
  );
}
