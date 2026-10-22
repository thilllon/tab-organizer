import { describe, expect, it, vi } from 'vitest';

import { t } from '@/lib/i18n';
import { openTabInBackground } from '@/lib/open-in-background';

import { getChromeFake } from './chrome-fake';

describe('openTabInBackground', () => {
  it('refuses an unsupported url without calling tabs.create', async () => {
    const result = await openTabInBackground('data:text/html,<h1>hi</h1>');

    expect(result).toEqual({ ok: false, reason: 'This tab cannot be opened (unsupported URL).' });
    expect(getChromeFake().state.createdTabs).toEqual([]);
  });

  it('refuses a foreign extension page but allows our own', async () => {
    const foreign = await openTabInBackground('chrome-extension://otherextid/page.html');
    expect(foreign.ok).toBe(false);
    expect(getChromeFake().state.createdTabs).toEqual([]);

    const own = await openTabInBackground('chrome-extension://fakeextid/app.html');
    expect(own).toEqual({ ok: true });
    expect(getChromeFake().state.createdTabs).toHaveLength(1);
  });

  it('opens an http url in an inactive background tab', async () => {
    // A decoy occupies "active": the fake always activates the sole tab of a window.
    await chrome.tabs.create({ url: 'https://decoy.test' });
    const fake = getChromeFake();
    fake.state.createdTabs.length = 0;

    const result = await openTabInBackground('https://example.com/a');

    expect(result).toEqual({ ok: true });
    expect(fake.state.createdTabs).toEqual([{ url: 'https://example.com/a', active: false }]);
    const created = [...fake.state.tabs.values()].find(
      (tab) => tab.url === 'https://example.com/a',
    );
    expect(created?.active).toBe(false);
  });

  it('unwraps a suspended url before opening it', async () => {
    const fake = getChromeFake();

    const result = await openTabInBackground(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/suspended.html#uri=https://real.example/x',
    );

    expect(result).toEqual({ ok: true });
    expect(fake.state.createdTabs).toEqual([{ url: 'https://real.example/x', active: false }]);
  });

  it('reports a rejected tabs.create instead of throwing', async () => {
    getChromeFake().failNext('tabs.create', 1, 'Tabs cannot be edited right now');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await openTabInBackground('https://example.com/a');

    // Chrome's English message is shown in the UI language; the original goes to the console.
    expect(result).toEqual({ ok: false, reason: t('errorTabsBusy') });
  });
});
