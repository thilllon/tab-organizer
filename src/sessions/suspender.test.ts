import { describe, expect, it } from 'vitest';
import { unwrapSuspendedUrl } from './suspender';

const PREFIX = 'chrome-extension://suspenderid/suspended.html#';

describe('unwrapSuspendedUrl', () => {
  it('returns the url unchanged when it does not start with the prefix', () => {
    const url = 'https://a.com/?uri=https://evil.com/';

    expect(unwrapSuspendedUrl(url, PREFIX)).toBe(url);
    expect(unwrapSuspendedUrl('chrome-extension://otherid/suspended.html#uri=x', PREFIX)).toBe(
      'chrome-extension://otherid/suspended.html#uri=x',
    );
  });

  it('never unwraps when the prefix is empty', () => {
    const url = `${PREFIX}uri=https://real.com/`;

    expect(unwrapSuspendedUrl(url, '')).toBe(url);
  });

  it('returns everything after uri= for the usual ttl/pos/uri wrapper', () => {
    expect(
      unwrapSuspendedUrl(
        `${PREFIX}ttl=Docs%20-%20Home&pos=120&uri=https://docs.example.com/p?x=1`,
        PREFIX,
      ),
    ).toBe('https://docs.example.com/p?x=1');
  });

  it("keeps a query containing '&' intact (URLSearchParams would cut it at the first '&')", () => {
    const real = 'https://www.youtube.com/watch?v=abc&list=PL123&index=4';

    expect(unwrapSuspendedUrl(`${PREFIX}ttl=YouTube&pos=0&uri=${real}`, PREFIX)).toBe(real);
  });

  it("keeps '+' and percent-escapes verbatim (no decoding)", () => {
    const real = 'https://example.com/search?q=a+b&path=%2Fusr%2Fbin&x=100%25';

    expect(unwrapSuspendedUrl(`${PREFIX}ttl=Search&pos=0&uri=${real}`, PREFIX)).toBe(real);
  });

  it('keeps a #fragment on the inner url', () => {
    const real = 'https://example.com/doc#section-2';

    expect(unwrapSuspendedUrl(`${PREFIX}ttl=Doc&pos=0&uri=${real}`, PREFIX)).toBe(real);
  });

  it("keeps '=' inside the inner query, including a nested uri= parameter", () => {
    const real = 'https://example.com/?redirect=https://b.com/?uri=nested&k=v=w';

    expect(unwrapSuspendedUrl(`${PREFIX}ttl=T&pos=0&uri=${real}`, PREFIX)).toBe(real);
  });

  it('works when uri= is the only parameter', () => {
    expect(unwrapSuspendedUrl(`${PREFIX}uri=https://real.com/`, PREFIX)).toBe('https://real.com/');
  });

  it("does not mistake a 'uri=' inside another parameter's value for the marker", () => {
    expect(unwrapSuspendedUrl(`${PREFIX}ttl=securi=1&pos=0&uri=https://real.com/`, PREFIX)).toBe(
      'https://real.com/',
    );
  });

  it('returns null when there is no uri parameter', () => {
    expect(unwrapSuspendedUrl(`${PREFIX}ttl=Docs&pos=0`, PREFIX)).toBeNull();
    expect(unwrapSuspendedUrl(PREFIX, PREFIX)).toBeNull();
  });

  it('returns null when the uri parameter is empty', () => {
    expect(unwrapSuspendedUrl(`${PREFIX}ttl=Docs&uri=`, PREFIX)).toBeNull();
    expect(unwrapSuspendedUrl(`${PREFIX}uri=`, PREFIX)).toBeNull();
  });

  it('returns a relative or otherwise malformed inner value verbatim (callers validate)', () => {
    expect(unwrapSuspendedUrl(`${PREFIX}uri=/foo`, PREFIX)).toBe('/foo');
  });
});
