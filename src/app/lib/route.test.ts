import { describe, expect, it } from 'vitest';
import { formatRoute, HOME, parseRoute, routeSessionId, sameRoute } from './route';

describe('parseRoute', () => {
  it('reads every view from its hash, with or without the leading #', () => {
    expect(parseRoute('')).toEqual(HOME);
    expect(parseRoute('#')).toEqual(HOME);
    expect(parseRoute('#open')).toEqual(HOME);
    expect(parseRoute('#settings')).toEqual({ view: 'settings' });
    expect(parseRoute('#saved/abc-123')).toEqual({ view: 'saved', id: 'abc-123' });
    expect(parseRoute('auto/abc-123')).toEqual({ view: 'auto', id: 'abc-123' });
    expect(parseRoute('#search/tab%20organizer')).toEqual({
      view: 'search',
      query: 'tab organizer',
    });
  });

  it('falls back to the open tabs view for anything it does not recognise', () => {
    expect(parseRoute('#nope')).toEqual(HOME);
    expect(parseRoute('#saved/')).toEqual(HOME);
    expect(parseRoute('#saved')).toEqual(HOME);
    expect(parseRoute('#search/')).toEqual(HOME);
  });

  it('keeps a malformed escape as typed instead of throwing', () => {
    expect(parseRoute('#search/%E0%A4%A')).toEqual({ view: 'search', query: '%E0%A4%A' });
  });

  it('round-trips ids and queries that need escaping', () => {
    for (const route of [
      HOME,
      { view: 'settings' },
      { view: 'saved', id: 'a/b #c' },
      { view: 'auto', id: '0914-0912' },
      { view: 'search', query: '모두의 창업 #1' },
    ] as const) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
  });
});

describe('routeSessionId and sameRoute', () => {
  it('names the record a route points at', () => {
    expect(routeSessionId({ view: 'saved', id: 'x' })).toBe('x');
    expect(routeSessionId({ view: 'auto', id: 'y' })).toBe('y');
    expect(routeSessionId(HOME)).toBeUndefined();
    expect(routeSessionId({ view: 'search', query: 'x' })).toBeUndefined();
  });

  it('compares routes by their address', () => {
    expect(sameRoute(HOME, { view: 'open' })).toBe(true);
    expect(sameRoute({ view: 'saved', id: 'x' }, { view: 'saved', id: 'x' })).toBe(true);
    expect(sameRoute({ view: 'saved', id: 'x' }, { view: 'auto', id: 'x' })).toBe(false);
  });
});
