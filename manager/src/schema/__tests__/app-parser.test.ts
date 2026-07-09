import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  isVersionInRange,
  isVisibleToUser,
  parseAnnouncementFeed,
  parseVersion,
} from '../app-parser.js';

/**
 * Mirror of a subset of the app's own announcement tests, so the vendored copy
 * is exercised against the same expectations. If these ever diverge from
 * time-capture packages/shared/src/__tests__/announcements.test.ts, the vendor
 * has drifted — re-sync app-parser.ts.
 */

describe('parseVersion / compareVersions / range (vendored)', () => {
  it('parses and pads', () => {
    expect(parseVersion('0.8.0')).toEqual([0, 8, 0]);
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('0.8.0-beta.1')).toEqual([0, 8, 0]);
    expect(parseVersion('latest')).toBeNull();
  });
  it('orders versions', () => {
    expect(compareVersions('0.7.0', '0.8.0')).toBe(-1);
    expect(compareVersions('0.8.10', '0.8.2')).toBe(1);
  });
  it('range is inclusive with null bounds open', () => {
    expect(isVersionInRange('0.9.0', '0.8.0', '1.0.0')).toBe(true);
    expect(isVersionInRange('0.7.0', '0.8.0', null)).toBe(false);
    expect(isVersionInRange('2.0.0', null, '1.0.0')).toBe(false);
  });
});

describe('parseAnnouncementFeed (vendored)', () => {
  it('drops items missing required fields', () => {
    const out = parseAnnouncementFeed([{ id: 'a', title: 'T' }, { title: 'no id' }, { id: 'x' }]);
    expect(out.map((a) => a.id)).toEqual(['a']);
  });

  it('defaults severity/audience/category and reads version range', () => {
    const [a] = parseAnnouncementFeed([
      { id: 'a', title: 'T', min_version: '0.8.0', max_version: '0.9.0' },
    ]);
    expect(a!.severity).toBe('info');
    expect(a!.audience).toBe('all');
    expect(a!.category).toBe('general');
    expect(a!.minVersion).toBe('0.8.0');
    expect(a!.maxVersion).toBe('0.9.0');
  });

  it('reads a valid category and defaults an unknown one to general', () => {
    const out = parseAnnouncementFeed([
      { id: 'a', title: 'T', category: 'security' },
      { id: 'b', title: 'T', category: 'nonsense' },
    ]);
    expect(out[0]!.category).toBe('security');
    expect(out[1]!.category).toBe('general');
  });

  it('drops links with a missing or non-http(s) scheme', () => {
    const [a] = parseAnnouncementFeed([
      {
        id: 'a',
        title: 'T',
        links: [
          { label: 'ok', url: 'https://example.com' },
          { label: 'bad', url: 'javascript:alert(1)' },
          { label: '', url: 'https://nolabel.com' },
        ],
      },
    ]);
    expect(a!.links).toEqual([{ label: 'ok', url: 'https://example.com' }]);
  });
});

describe('isVisibleToUser (vendored)', () => {
  it('hides info-severity from paid tiers', () => {
    expect(isVisibleToUser({ severity: 'info', audience: 'all' }, 'free')).toBe(true);
    expect(isVisibleToUser({ severity: 'info', audience: 'all' }, 'pro')).toBe(false);
  });
  it('applies audience filters for important/critical', () => {
    expect(isVisibleToUser({ severity: 'critical', audience: 'all' }, 'pro')).toBe(true);
    expect(isVisibleToUser({ severity: 'important', audience: 'free' }, 'pro')).toBe(false);
    expect(isVisibleToUser({ severity: 'important', audience: 'paid' }, 'team')).toBe(true);
  });
});
