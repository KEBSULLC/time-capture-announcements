import { describe, it, expect } from 'vitest';
import type { AuthorEntry } from '../types.js';
import { emptyEntry } from '../types.js';
import { serializeFeed, loadFeed } from '../serialize.js';
import { validateEntry } from '../authoring.js';

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

  it('defaults ABSENT enum fields but PRESERVES present-but-invalid ones for the validator', () => {
    // absent → default (lets a pre-Build-18 feed with no category open cleanly)
    const [absent] = loadFeed([{ id: 'a', title: 'X' }]);
    expect(absent!.category).toBe('general');
    expect(absent!.severity).toBe('info');
    expect(absent!.audience).toBe('all');

    // present-but-invalid → kept verbatim (NOT silently rewritten to a default)
    const [bad] = loadFeed([
      { id: 'b', title: 'X', category: 'secirty', severity: 'nope', audience: 'weird' },
    ]);
    expect(bad!.category).toBe('secirty');
    expect(bad!.severity).toBe('nope');
    expect(bad!.audience).toBe('weird');

    // ...and the validator flags each invalid value as a blocking error
    const errs = validateEntry(bad!, new Set()).filter((i) => i.level === 'error');
    const fields = errs.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['category', 'severity', 'audience']));
  });
});
