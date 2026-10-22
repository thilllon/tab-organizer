import { describe, expect, it } from 'vitest';

import { isSuspendedUrl, unwrapSuspendedUrl } from '@/lib/suspended-url';

/** The Marvellous Suspender's placeholder page. */
const MARVELLOUS = 'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#';
/** Another suspender of the Great Suspender family: any extension id, the same page and format. */
const OTHER = 'chrome-extension://klbibkeccnjlkjkiokjodocebajanakg/suspended.html#';
/** An id standing for our own extension in the tests that pass it explicitly. */
const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('isSuspendedUrl', () => {
  it('recognises The Marvellous Suspender', () => {
    expect(isSuspendedUrl(`${MARVELLOUS}ttl=Docs&pos=0&uri=https://docs.example/`)).toBe(true);
  });

  it('recognises another suspender by the shape of its page, not by a configured id', () => {
    expect(isSuspendedUrl(`${OTHER}ttl=Docs&pos=0&uri=https://docs.example/`)).toBe(true);
  });

  it('recognises a raw uri holding & and # (appended unencoded by the suspender)', () => {
    const url = `${OTHER}ttl=V&pos=2&uri=https://v.example/watch?v=1&list=2#t=30`;
    expect(isSuspendedUrl(url)).toBe(true);
  });

  it('rejects a chrome-extension url that is not suspended.html', () => {
    expect(
      isSuspendedUrl(
        'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/options.html#uri=https://a.example/',
      ),
    ).toBe(false);
    expect(
      isSuspendedUrl(
        'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.htm#uri=https://a.example/',
      ),
    ).toBe(false);
  });

  it('rejects suspended.html without a uri= parameter, or with an empty one', () => {
    expect(isSuspendedUrl(`${MARVELLOUS}ttl=Docs&pos=0`)).toBe(false);
    expect(isSuspendedUrl(MARVELLOUS)).toBe(false);
    expect(isSuspendedUrl(`${MARVELLOUS}ttl=Docs&uri=`)).toBe(false);
    expect(isSuspendedUrl(`${MARVELLOUS}ttl=securi=1&pos=0`)).toBe(false);
  });

  it('rejects suspended.html with uri= outside the fragment', () => {
    expect(
      isSuspendedUrl(
        'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html?uri=https://a.example/',
      ),
    ).toBe(false);
  });

  it('rejects a host that is not an extension id', () => {
    expect(isSuspendedUrl('chrome-extension://suspenderid/suspended.html#uri=https://a/')).toBe(
      false,
    );
    expect(
      isSuspendedUrl(
        'chrome-extension://NOOGAFOOFPEBIMAJPFPAMCFHOAIFEMOA/suspended.html#uri=https://a/',
      ),
    ).toBe(false);
    expect(
      isSuspendedUrl(`chrome-extension://${'q'.repeat(32)}/suspended.html#uri=https://a/`),
    ).toBe(false);
    expect(isSuspendedUrl('https://evil.example/suspended.html#uri=https://a.example/')).toBe(
      false,
    );
  });

  it('rejects ordinary pages, even with a uri= in their own query', () => {
    expect(isSuspendedUrl('https://a.example/?uri=https://b.example/')).toBe(false);
    expect(isSuspendedUrl('chrome://settings/')).toBe(false);
    expect(isSuspendedUrl('')).toBe(false);
    expect(isSuspendedUrl(undefined)).toBe(false);
  });

  it('never treats a page of our own extension as suspended', () => {
    const own = `chrome-extension://${OWN_ID}/suspended.html#uri=https://a.example/`;
    expect(isSuspendedUrl(own, OWN_ID)).toBe(false);
    // Another id with the same page still is one.
    expect(isSuspendedUrl(`${MARVELLOUS}uri=https://a.example/`, OWN_ID)).toBe(true);
  });

  it('asks chrome.runtime for our own id by default', () => {
    // The fake's runtime id is not shaped like a real one, so give this test's fake one that is.
    Object.assign(chrome.runtime, { id: OWN_ID });
    const own = `chrome-extension://${OWN_ID}/suspended.html#uri=https://a.example/`;

    expect(isSuspendedUrl(own)).toBe(false);
    expect(unwrapSuspendedUrl(own)).toBe(own);
  });
});

describe('unwrapSuspendedUrl', () => {
  it('returns a url that is not a suspended page unchanged', () => {
    const url = 'https://a.com/?uri=https://evil.com/';

    expect(unwrapSuspendedUrl(url)).toBe(url);
    expect(unwrapSuspendedUrl('chrome-extension://otherid/suspended.html#uri=x')).toBe(
      'chrome-extension://otherid/suspended.html#uri=x',
    );
  });

  it('returns everything after uri= for the usual ttl/pos/uri wrapper', () => {
    expect(
      unwrapSuspendedUrl(
        `${MARVELLOUS}ttl=Docs%20-%20Home&pos=120&uri=https://docs.example.com/p?x=1`,
      ),
    ).toBe('https://docs.example.com/p?x=1');
  });

  it('unwraps any suspender of the family the same way', () => {
    expect(unwrapSuspendedUrl(`${OTHER}ttl=Docs&pos=1&uri=https://docs.example.com/`)).toBe(
      'https://docs.example.com/',
    );
  });

  it("keeps a query containing '&' intact (URLSearchParams would cut it at the first '&')", () => {
    const real = 'https://www.youtube.com/watch?v=abc&list=PL123&index=4';

    expect(unwrapSuspendedUrl(`${MARVELLOUS}ttl=YouTube&pos=0&uri=${real}`)).toBe(real);
  });

  it("keeps '+' and percent-escapes verbatim (no decoding)", () => {
    const real = 'https://example.com/search?q=a+b&path=%2Fusr%2Fbin&x=100%25';

    expect(unwrapSuspendedUrl(`${MARVELLOUS}ttl=Search&pos=0&uri=${real}`)).toBe(real);
  });

  it('keeps a #fragment on the inner url', () => {
    const real = 'https://example.com/doc?a=1&b=2#section-2';

    expect(unwrapSuspendedUrl(`${MARVELLOUS}ttl=Doc&pos=0&uri=${real}`)).toBe(real);
  });

  it("keeps '=' inside the inner query, including a nested uri= parameter", () => {
    const real = 'https://example.com/?redirect=https://b.com/?uri=nested&k=v=w';

    expect(unwrapSuspendedUrl(`${MARVELLOUS}ttl=T&pos=0&uri=${real}`)).toBe(real);
  });

  it('works when uri= is the only parameter', () => {
    expect(unwrapSuspendedUrl(`${MARVELLOUS}uri=https://real.com/`)).toBe('https://real.com/');
  });

  it("does not mistake a 'uri=' inside another parameter's value for the marker", () => {
    expect(unwrapSuspendedUrl(`${MARVELLOUS}ttl=securi=1&pos=0&uri=https://real.com/`)).toBe(
      'https://real.com/',
    );
  });

  it('returns suspended.html without a usable uri= unchanged (callers decide)', () => {
    expect(unwrapSuspendedUrl(`${MARVELLOUS}ttl=Docs&pos=0`)).toBe(`${MARVELLOUS}ttl=Docs&pos=0`);
    expect(unwrapSuspendedUrl(MARVELLOUS)).toBe(MARVELLOUS);
    expect(unwrapSuspendedUrl(`${MARVELLOUS}uri=`)).toBe(`${MARVELLOUS}uri=`);
  });

  it('returns a relative or otherwise malformed inner value verbatim (callers validate)', () => {
    expect(unwrapSuspendedUrl(`${MARVELLOUS}uri=/foo`)).toBe('/foo');
  });

  it('leaves a page of our own extension alone', () => {
    const own = `chrome-extension://${OWN_ID}/suspended.html#uri=https://a.example/`;
    expect(unwrapSuspendedUrl(own, OWN_ID)).toBe(own);
  });
});
