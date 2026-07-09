import { describe, it, expect } from 'vitest';
import type { AuthorEntry } from '../types.js';
import { serializeFeed } from '../serialize.js';
import { parseAnnouncementFeed } from '../app-parser.js';

/**
 * The contract test: an entry authored by this tool, serialized to feed.json,
 * MUST be read back by the app's parser with every field intact. This is what
 * guarantees "match the app parser exactly". If the vendored parser drifts
 * from the real app, these assertions are what should catch it.
 */

const security: AuthorEntry = {
  id: 'security-2026-07',
  category: 'security',
  severity: 'critical',
  audience: 'all',
  minVersion: '0.14.0',
  maxVersion: null,
  title: 'Security update available',
  body: 'Please update to the latest version.\nThis addresses a data-integrity fix.',
  links: [{ label: 'Read the advisory', url: 'https://kebsullc.github.io/time-capture-announcements/' }],
  publishedAt: '2026-07-03T00:00:00.000Z',
};

const ad: AuthorEntry = {
  id: 'upgrade-pro-2026-07',
  category: 'ad',
  severity: 'info',
  audience: 'free',
  minVersion: null,
  maxVersion: null,
  title: 'Upgrade to Pro',
  body: 'Getting a lot of value from Time Capture? Consider upgrading to Pro.',
  links: [{ label: 'How to upgrade', url: 'https://example.com/upgrade' }],
  publishedAt: '2026-07-03T12:00:00.000Z',
};

const general: AuthorEntry = {
  id: 'welcome-2026-05',
  category: 'general',
  severity: 'info',
  audience: 'all',
  minVersion: null,
  maxVersion: null,
  title: 'Welcome to Time Capture',
  body: 'Thanks for trying Time Capture.',
  links: [],
  publishedAt: '2026-05-14T00:00:00.000Z',
};

const samples = [security, ad, general];

describe('feed round-trip through the app parser', () => {
  it('every authored field survives serialize → parse', () => {
    const json = JSON.parse(serializeFeed(samples));
    const parsed = parseAnnouncementFeed(json);
    expect(parsed).toHaveLength(samples.length);

    samples.forEach((entry, i) => {
      const p = parsed[i]!;
      expect(p.id).toBe(entry.id);
      expect(p.category).toBe(entry.category);
      expect(p.severity).toBe(entry.severity);
      expect(p.audience).toBe(entry.audience);
      expect(p.minVersion).toBe(entry.minVersion);
      expect(p.maxVersion).toBe(entry.maxVersion);
      expect(p.title).toBe(entry.title);
      expect(p.body).toBe(entry.body);
      expect(p.links).toEqual(entry.links);
      expect(p.publishedAt).toBe(entry.publishedAt);
    });
  });

  it('emits the wrapped { announcements: [...] } shape the app fetches', () => {
    const json = JSON.parse(serializeFeed(samples));
    expect(Array.isArray(json.announcements)).toBe(true);
    expect(json.announcements[0].min_version).toBe('0.14.0');
    expect(json.announcements[0].max_version).toBeNull();
  });

  it('serialization is deterministic and idempotent (diff-friendly)', () => {
    const once = serializeFeed(samples);
    const twice = serializeFeed(parseAsAuthor(once));
    // parse back through the app parser then re-serialize → identical bytes
    expect(twice).toBe(once);
    expect(once.endsWith('\n')).toBe(true);
  });
});

/** Re-hydrate serialized feed text into AuthorEntry[] (via the app parser). */
function parseAsAuthor(text: string): AuthorEntry[] {
  return parseAnnouncementFeed(JSON.parse(text)).map((a) => ({
    id: a.id,
    category: a.category,
    severity: a.severity,
    audience: a.audience,
    minVersion: a.minVersion,
    maxVersion: a.maxVersion,
    title: a.title,
    body: a.body,
    links: a.links,
    publishedAt: a.publishedAt,
  }));
}
