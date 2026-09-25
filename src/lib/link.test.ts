import { describe, expect, it } from 'vitest';
import { browserHandlesClick, hrefFor } from './link';

describe('hrefFor', () => {
  it('links http and https', () => {
    expect(hrefFor('https://github.com/thilllon/tab-organizer')).toBe(
      'https://github.com/thilllon/tab-organizer',
    );
    expect(hrefFor('http://example.com/')).toBe('http://example.com/');
  });

  it('refuses the schemes that make a link dangerous', () => {
    // The whole reason this function exists: a stored url is whatever the page had at capture
    // time, and this page holds the `tabs` permission.
    expect(hrefFor('javascript:alert(1)')).toBeUndefined();
    expect(hrefFor('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(hrefFor('blob:https://example.com/abc')).toBeUndefined();
  });

  it('refuses the schemes Chrome will not follow from a link', () => {
    // Allowed by sanitizeRestoreUrl for chrome.tabs.create, but a dead link if rendered.
    expect(hrefFor('chrome://extensions')).toBeUndefined();
    expect(hrefFor('file:///Users/someone/notes.txt')).toBeUndefined();
    expect(hrefFor('about:blank')).toBeUndefined();
    expect(hrefFor('chrome-extension://abcdefghijklmnop/app.html')).toBeUndefined();
    expect(hrefFor('ftp://example.com/pub')).toBeUndefined();
  });

  it('refuses anything that is not a url at all', () => {
    expect(hrefFor('')).toBeUndefined();
    expect(hrefFor('not a url')).toBeUndefined();
    expect(hrefFor('example.com')).toBeUndefined();
  });
});

describe('browserHandlesClick', () => {
  it('keeps a plain left click for the app', () => {
    expect(browserHandlesClick({ button: 0 })).toBe(false);
    expect(browserHandlesClick({})).toBe(false);
  });

  it('hands every modified click to the browser', () => {
    expect(browserHandlesClick({ metaKey: true })).toBe(true);
    expect(browserHandlesClick({ ctrlKey: true })).toBe(true);
    expect(browserHandlesClick({ shiftKey: true })).toBe(true);
    expect(browserHandlesClick({ altKey: true })).toBe(true);
  });

  it('hands over any non-primary button', () => {
    expect(browserHandlesClick({ button: 1 })).toBe(true);
    expect(browserHandlesClick({ button: 2 })).toBe(true);
  });
});
