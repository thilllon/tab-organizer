import { describe, expect, it } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import { captureSession } from './capture';

async function seedWindow(urls: string[], focused: boolean): Promise<number> {
  const win = await chrome.windows.create({ url: urls[0] });
  if (win === undefined || win.id === undefined) {
    throw new Error('fake windows.create returned nothing');
  }
  for (const url of urls.slice(1)) {
    await chrome.tabs.create({ windowId: win.id, url, active: false });
  }
  await chrome.windows.update(win.id, { focused });
  return win.id;
}

describe('captureSession', () => {
  it("'all' captures every normal window and fills the session envelope", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/'], true);

    const before = Date.now();
    const session = await captureSession('all');

    expect(session.schemaVersion).toBe(1);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.kind).toBe('saved');
    expect(session.origin).toBe('manual');
    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.updatedAt).toBe(session.createdAt);
    expect(session.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(session.windows).toHaveLength(2);
    expect(session.windows.map((w) => w.tabs.length)).toEqual([2, 1]);
    expect(session.name).toMatch(/^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 2 windows · 3 tabs$/);
  });

  it("'window' keeps only the last-focused window", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/'], true);

    const session = await captureSession('window');

    expect(session.windows).toHaveLength(1);
    expect(session.windows[0].tabs.map((t) => t.url)).toEqual(['https://b.example/']);
    expect(session.name).toMatch(/· 1 window · 1 tab$/);
  });

  it('uses the given name verbatim and drops own extension pages', async () => {
    const fake = getChromeFake();
    await seedWindow(['https://a.example/', chrome.runtime.getURL('dashboard.html')], true);

    const session = await captureSession('window', 'My tabs');

    expect(session.name).toBe('My tabs');
    expect(session.windows[0].tabs.map((t) => t.url)).toEqual(['https://a.example/']);
    expect(fake.state.tabs.size).toBe(2);
  });
});
