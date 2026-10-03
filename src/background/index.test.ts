import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';

/** Lets every pending promise chain in the worker run to its end. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 200; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function openTabs(keys: string[]): Promise<void> {
  for (const key of keys) {
    await chrome.tabs.create({ url: `https://example.com/${key}`, active: false });
  }
}

async function strip(): Promise<string[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .sort((a, b) => a.index - b.index)
    .map((tab) => new URL(tab.url ?? 'about:blank').pathname.slice(1));
}

describe('icon click', () => {
  beforeEach(async () => {
    // The listeners must land on this test's fake, so the worker is imported after it exists.
    vi.resetModules();
    await import('./index');
  });

  it('sorts the focused window by url', async () => {
    await openTabs(['b', 'd', 'a', 'c']);
    getChromeFake().fire.actionClicked();
    await settle();
    expect(await strip()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves nothing when the window is already sorted', async () => {
    await openTabs(['a', 'b', 'c', 'd']);
    const move = vi.spyOn(chrome.tabs, 'move');
    getChromeFake().fire.actionClicked();
    await settle();
    expect(move).not.toHaveBeenCalled();
    expect(await strip()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves only the tab that is out of place', async () => {
    await openTabs(['d', 'a', 'b', 'c']);
    const move = vi.spyOn(chrome.tabs, 'move');
    getChromeFake().fire.actionClicked();
    await settle();
    expect(await strip()).toEqual(['a', 'b', 'c', 'd']);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0][0]).toHaveLength(1);
  });

  it('ends sorted after a double click', async () => {
    // A move plan is only right for the order it was made from. Two runs side by side would both
    // plan from the same order and the second would undo part of the first.
    await openTabs(['b', 'd', 'a', 'c']);
    getChromeFake().fire.actionClicked();
    getChromeFake().fire.actionClicked();
    await settle();
    expect(await strip()).toEqual(['a', 'b', 'c', 'd']);
  });
});
