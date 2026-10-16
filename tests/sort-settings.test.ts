import { describe, expect, it } from 'vitest';
import { THE_MARVELLOUS_SUSPENDER_EXTENSION_ID } from '@/lib/session-capture';
import {
  CUSTOM_ONLY_SETTINGS,
  DEFAULT_SORT_SETTINGS,
  DUPLICATE_TAB_OPTIONS,
  GROUP_FROM_OPTIONS,
  GROUPING_MODE_OPTIONS,
  isDuplicateTabHandling,
  isExtensionId,
  isGroupFrom,
  isGroupingMode,
  isSortBy,
  normalizeSuspenderId,
  parseSortSettings,
  SORT_BY_OPTIONS,
  SORT_SETTING_KEYS,
  showsCustomSortOptions,
  suspenderIdStatus,
  toStoredSortSettings,
} from '@/lib/sort-settings';
import type { SortSettings } from '@/types';

const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop';

/** Every setting on a non-default value, so a fallback shows up as a changed field. */
const ALL_CHANGED: SortSettings = {
  sortBy: 'custom',
  groupFrom: 'rightToLeft',
  preserveOrderWithinGroups: true,
  groupSuspendedTabs: true,
  tabSuspenderExtensionId: VALID_ID,
  sortPinnedTabs: true,
  duplicateTabHandling: 'group',
  groupingMode: 'domain',
};

describe('DEFAULT_SORT_SETTINGS', () => {
  it('mirrors DEFAULT_SETTINGS in src/lib/sort-tabs.ts', () => {
    expect(DEFAULT_SORT_SETTINGS).toEqual({
      sortBy: 'url',
      groupFrom: 'leftToRight',
      preserveOrderWithinGroups: false,
      groupSuspendedTabs: false,
      tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
      sortPinnedTabs: false,
      duplicateTabHandling: 'none',
      groupingMode: 'subdomain',
    });
  });

  it('is covered key for key by SORT_SETTING_KEYS', () => {
    expect([...SORT_SETTING_KEYS].sort()).toEqual(Object.keys(DEFAULT_SORT_SETTINGS).sort());
  });
});

describe('type guards', () => {
  it('accept exactly the values the SortSettings unions allow', () => {
    expect(['url', 'title', 'custom'].every(isSortBy)).toBe(true);
    expect(['leftToRight', 'rightToLeft'].every(isGroupFrom)).toBe(true);
    expect(['none', 'closeAllButOne', 'group'].every(isDuplicateTabHandling)).toBe(true);
    expect(['subdomain', 'domain'].every(isGroupingMode)).toBe(true);
  });

  it('reject near-misses, other unions members and non-strings', () => {
    expect(isSortBy('URL')).toBe(false);
    expect(isSortBy('domain')).toBe(false);
    expect(isGroupFrom('lefttoright')).toBe(false);
    expect(isGroupFrom(0)).toBe(false);
    expect(isDuplicateTabHandling('closeAll')).toBe(false);
    expect(isDuplicateTabHandling(null)).toBe(false);
    expect(isGroupingMode('hostname')).toBe(false);
    expect(isGroupingMode(undefined)).toBe(false);
  });
});

describe('isExtensionId', () => {
  it('accepts 32 characters from a–p', () => {
    expect(isExtensionId(THE_MARVELLOUS_SUSPENDER_EXTENSION_ID)).toBe(true);
    expect(isExtensionId(VALID_ID)).toBe(true);
    expect(isExtensionId('a'.repeat(32))).toBe(true);
    expect(isExtensionId('p'.repeat(32))).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isExtensionId('')).toBe(false);
    expect(isExtensionId('a'.repeat(31))).toBe(false);
    expect(isExtensionId('a'.repeat(33))).toBe(false);
  });

  it('rejects characters outside a–p, upper case, digits and whitespace', () => {
    expect(isExtensionId(`${'a'.repeat(31)}q`)).toBe(false);
    expect(isExtensionId(`${'a'.repeat(31)}z`)).toBe(false);
    expect(isExtensionId(VALID_ID.toUpperCase())).toBe(false);
    expect(isExtensionId(`${'a'.repeat(31)}1`)).toBe(false);
    expect(isExtensionId(`${'a'.repeat(31)} `)).toBe(false);
    expect(isExtensionId(` ${VALID_ID}`)).toBe(false);
  });
});

describe('suspenderIdStatus', () => {
  it('treats an empty or whitespace-only field as "use the default"', () => {
    expect(suspenderIdStatus('')).toBe('default');
    expect(suspenderIdStatus('   ')).toBe('default');
  });

  it('accepts a well-formed id, with surrounding whitespace', () => {
    expect(suspenderIdStatus(VALID_ID)).toBe('valid');
    expect(suspenderIdStatus(`  ${VALID_ID}  `)).toBe('valid');
  });

  it('flags anything else, which is what blocks Save', () => {
    expect(suspenderIdStatus('not-an-id')).toBe('invalid');
    expect(suspenderIdStatus(VALID_ID.toUpperCase())).toBe('invalid');
    expect(suspenderIdStatus(VALID_ID.slice(0, 31))).toBe('invalid');
    expect(suspenderIdStatus(`${VALID_ID}a`)).toBe('invalid');
  });
});

describe('normalizeSuspenderId', () => {
  it('keeps a valid id and trims it', () => {
    expect(normalizeSuspenderId(VALID_ID)).toBe(VALID_ID);
    expect(normalizeSuspenderId(` ${VALID_ID}\n`)).toBe(VALID_ID);
  });

  it('falls back to the default for an empty field, so unwrapping keeps working', () => {
    expect(normalizeSuspenderId('')).toBe(THE_MARVELLOUS_SUSPENDER_EXTENSION_ID);
    expect(normalizeSuspenderId('   ')).toBe(THE_MARVELLOUS_SUSPENDER_EXTENSION_ID);
  });

  it('never stores a malformed id', () => {
    expect(normalizeSuspenderId('not-an-id')).toBe(THE_MARVELLOUS_SUSPENDER_EXTENSION_ID);
    expect(normalizeSuspenderId(VALID_ID.toUpperCase())).toBe(
      THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
    );
  });
});

describe('parseSortSettings', () => {
  it('returns the defaults for empty storage', () => {
    expect(parseSortSettings({})).toEqual(DEFAULT_SORT_SETTINGS);
  });

  it('returns the defaults for a non-object', () => {
    expect(parseSortSettings(undefined)).toEqual(DEFAULT_SORT_SETTINGS);
    expect(parseSortSettings(null)).toEqual(DEFAULT_SORT_SETTINGS);
    expect(parseSortSettings('nonsense')).toEqual(DEFAULT_SORT_SETTINGS);
  });

  it('reads back every key it is given', () => {
    expect(parseSortSettings(ALL_CHANGED)).toEqual(ALL_CHANGED);
  });

  it('keeps the stored keys it understands and defaults the rest', () => {
    expect(parseSortSettings({ sortBy: 'title', sortPinnedTabs: true })).toEqual({
      ...DEFAULT_SORT_SETTINGS,
      sortBy: 'title',
      sortPinnedTabs: true,
    });
  });

  it('falls back per key for values of the wrong type or an unknown member', () => {
    const parsed = parseSortSettings({
      sortBy: 'sideways',
      groupFrom: 42,
      preserveOrderWithinGroups: 'true',
      groupSuspendedTabs: null,
      tabSuspenderExtensionId: 12345,
      sortPinnedTabs: 1,
      duplicateTabHandling: 'closeAll',
      groupingMode: 'hostname',
    });
    expect(parsed).toEqual(DEFAULT_SORT_SETTINGS);
  });

  it('falls back to the default suspender id for an empty or malformed stored id', () => {
    expect(parseSortSettings({ tabSuspenderExtensionId: '' }).tabSuspenderExtensionId).toBe(
      THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
    );
    expect(parseSortSettings({ tabSuspenderExtensionId: 'nope' }).tabSuspenderExtensionId).toBe(
      THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
    );
    expect(parseSortSettings({ tabSuspenderExtensionId: ` ${VALID_ID} ` })).toEqual({
      ...DEFAULT_SORT_SETTINGS,
      tabSuspenderExtensionId: VALID_ID,
    });
  });
});

describe('toStoredSortSettings', () => {
  it('writes all eight settings', () => {
    expect(Object.keys(toStoredSortSettings(ALL_CHANGED)).sort()).toEqual(
      [...SORT_SETTING_KEYS].sort(),
    );
  });

  it('passes every setting through untouched but the suspender id', () => {
    expect(toStoredSortSettings(ALL_CHANGED)).toEqual(ALL_CHANGED);
  });

  it('resolves an empty suspender id to the default rather than storing ""', () => {
    const stored = toStoredSortSettings({ ...ALL_CHANGED, tabSuspenderExtensionId: '' });
    expect(stored.tabSuspenderExtensionId).toBe(THE_MARVELLOUS_SUSPENDER_EXTENSION_ID);
  });

  it('keeps the custom-only settings under the other sort modes', () => {
    const stored = toStoredSortSettings({
      ...ALL_CHANGED,
      sortBy: 'url',
      groupFrom: 'rightToLeft',
      preserveOrderWithinGroups: true,
    });
    expect(stored.groupFrom).toBe('rightToLeft');
    expect(stored.preserveOrderWithinGroups).toBe(true);
  });

  it('round-trips through parseSortSettings', () => {
    expect(parseSortSettings(toStoredSortSettings(ALL_CHANGED))).toEqual(ALL_CHANGED);
  });
});

describe('showsCustomSortOptions', () => {
  it('shows the Custom-only settings only for custom sorting', () => {
    expect(showsCustomSortOptions('custom')).toBe(true);
    expect(showsCustomSortOptions('url')).toBe(false);
    expect(showsCustomSortOptions('title')).toBe(false);
  });

  it('covers every setting sortByTitleOrUrl never reads, and only those', () => {
    expect([...CUSTOM_ONLY_SETTINGS].sort()).toEqual(
      ['groupFrom', 'groupingMode', 'preserveOrderWithinGroups'].sort(),
    );
    for (const key of CUSTOM_ONLY_SETTINGS) {
      expect(SORT_SETTING_KEYS).toContain(key);
    }
  });

  it('keeps a hidden setting stored as it is', () => {
    expect(toStoredSortSettings({ ...ALL_CHANGED, sortBy: 'url' })).toMatchObject({
      groupingMode: 'domain',
      groupFrom: 'rightToLeft',
      preserveOrderWithinGroups: true,
    });
  });
});

describe('dropdown options', () => {
  const cases = [
    { name: 'SORT_BY_OPTIONS', options: SORT_BY_OPTIONS, guard: isSortBy, count: 3 },
    {
      name: 'DUPLICATE_TAB_OPTIONS',
      options: DUPLICATE_TAB_OPTIONS,
      guard: isDuplicateTabHandling,
      count: 3,
    },
    {
      name: 'GROUPING_MODE_OPTIONS',
      options: GROUPING_MODE_OPTIONS,
      guard: isGroupingMode,
      count: 2,
    },
    { name: 'GROUP_FROM_OPTIONS', options: GROUP_FROM_OPTIONS, guard: isGroupFrom, count: 2 },
  ];

  for (const { name, options, guard, count } of cases) {
    it(`${name} offers every stored value once, each accepted by its guard`, () => {
      const values = options.map((option) => option.value);
      expect(new Set(values).size).toBe(count);
      expect(values.every((value) => guard(value))).toBe(true);
      expect(options.every((option) => option.label.trim() !== '')).toBe(true);
    });
  }

  it('keeps the wording the radio buttons had', () => {
    expect(SORT_BY_OPTIONS.map((option) => option.label)).toEqual(['By URL', 'By title', 'Custom']);
    expect(DUPLICATE_TAB_OPTIONS.map((option) => option.label)).toEqual([
      'Keep all',
      'Keep one',
      'Group them',
    ]);
  });

  it('offers each default as one of its choices', () => {
    expect(SORT_BY_OPTIONS.map((o) => o.value)).toContain(DEFAULT_SORT_SETTINGS.sortBy);
    expect(DUPLICATE_TAB_OPTIONS.map((o) => o.value)).toContain(
      DEFAULT_SORT_SETTINGS.duplicateTabHandling,
    );
    expect(GROUPING_MODE_OPTIONS.map((o) => o.value)).toContain(DEFAULT_SORT_SETTINGS.groupingMode);
    expect(GROUP_FROM_OPTIONS.map((o) => o.value)).toContain(DEFAULT_SORT_SETTINGS.groupFrom);
  });
});
