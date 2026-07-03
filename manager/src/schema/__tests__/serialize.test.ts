import { describe, it, expect } from 'vitest';
import type { AuthorEntry } from '../types.js';
import { emptyEntry } from '../types.js';
import { serializeFeed, loadFeed } from '../serialize.js';

function entry(overrides: Partial<AuthorEntry> = {}): AuthorEntry {
  return { ...emptyEntry('id-1'), title: 'T', publishedAt: '2026-07-03T00:00:00.000Z', ...overrides };
}

describe('serializeFeed', () => {
  it('uses the canonical key order and a trailing newline', () => {
    const text = serializeFeed([entry({ minVersion: '0.1.0', maxVersion: '0.2.0' })]);
    expect(text.endsWith('\n')).toBe(true);
    const keys = Object.keys(JSON.parse(text).announcements[0]);
    expect(keys).toEqual([
      'id',
      'category',
      'severity',
      'audience',
      'min_version',
      'max_version',
      'title',
      'body',
      'links',
      'published_at',
    ]);
  });

  it('writes null (not undefined/omitted) for empty version bounds', () => {
    const raw = JSON.parse(serializeFeed([entry()])).announcements[0];
    expect(raw.min_version).toBeNull();
    expect(raw.max_version).toBeNull();
  });

  it('trims blank version strings to null', () => {
    const raw = JSON.parse(serializeFeed([entry({ minVersion: '   ' })])).announcements[0];
    expect(raw.min_version).toBeNull();
  });
});

describe('loadFeed', () => {
  it('round-trips serialize → loadFeed back to the same entries', () => {
    const entries = [
      entry({ id: 'a', category: 'security', severity: 'critical' }),
      entry({ id: 'b', category: 'ad', audience: 'free', links: [{ label: 'x', url: 'https://e.com' }] }),
    ];
    const reloaded = loadFeed(JSON.parse(serializeFeed(entries)));
    expect(reloaded).toEqual(entries);
  });

  it('accepts the wrapped and bare array shapes', () => {
    const bare = loadFeed([{ id: 'a', title: 'X' }]);
    const wrapped = loadFeed({ announcements: [{ id: 'a', title: 'X' }] });
    expect(bare).toHaveLength(1);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]!.category).toBe('general');
  });

  it('reads camelCase min/max/published as a fallback', () => {
    const [e] = loadFeed([
      { id: 'a', title: 'X', minVersion: '0.8.0', maxVersion: '0.9.0', publishedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(e!.minVersion).toBe('0.8.0');
    expect(e!.maxVersion).toBe('0.9.0');
    expect(e!.publishedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('coerces unknown enum values to defaults (surfaced later by the validator)', () => {
    const [e] = loadFeed([{ id: 'a', title: 'X', category: 'bogus', severity: 'nope', audience: 'weird' }]);
    expect(e!.category).toBe('general');
    expect(e!.severity).toBe('info');
    expect(e!.audience).toBe('all');
  });
});
