/*
 * =============================================================================
 *  KEEP IN SYNC with time-capture packages/shared/src/announcements.ts
 * =============================================================================
 *
 *  This file is a VENDORED COPY of the desktop app's announcement-feed parser.
 *  It is the authoring tool's oracle for "will the app accept this entry?".
 *  The `feed.json` this tool produces is only correct insofar as it survives
 *  THIS parser unchanged — the round-trip test in `__tests__/roundtrip.test.ts`
 *  enforces exactly that.
 *
 *  RULES for keeping it in sync:
 *   - When the app's parser (`packages/shared/src/announcements.ts`) changes,
 *     re-copy the changed functions here VERBATIM and re-run the tests.
 *   - Do NOT "improve" or refactor this parser locally. Its job is to be a
 *     faithful mirror, not a better implementation. Any divergence silently
 *     lets the tool emit entries the real app would drop or mis-read.
 *
 *  ONE INTENTIONAL ADDITION over the current app parser: the Build 18
 *  `category` field (`security` / `ad` / `general`). The current shipped app
 *  parser does not yet read `category` (it defensively ignores unknown fields,
 *  so emitting it is forward-compatible and harmless today); Build 18 —
 *  see time-capture docs/build-threads/04-announcements-upsell.md — adds it to
 *  drive force-pop / daily-ad / inbox behavior. The `category` handling below
 *  is fenced in a clearly marked block so that, when Build 18's real parser
 *  lands, this file is re-synced from it and the fence goes away.
 * =============================================================================
 */

export type AnnouncementSeverity = 'info' | 'important' | 'critical';
export type AnnouncementAudience = 'all' | 'free' | 'paid' | 'pro' | 'team' | 'enterprise';
export type LicenseTier = 'free' | 'pro' | 'team' | 'enterprise' | 'developer';

// ---- Build 18 addition (see header) ----------------------------------------
export type AnnouncementCategory = 'security' | 'ad' | 'general';
export const VALID_CATEGORIES: ReadonlyArray<AnnouncementCategory> = ['security', 'ad', 'general'];
// ----------------------------------------------------------------------------

export interface AnnouncementLink {
  label: string;
  url: string;
}

export interface Announcement {
  id: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  minVersion: string | null;
  maxVersion: string | null;
  title: string;
  body: string;
  links: AnnouncementLink[];
  publishedAt: string;
  // Build 18 addition (see header).
  category: AnnouncementCategory;
}

const VALID_SEVERITIES: ReadonlyArray<AnnouncementSeverity> = ['info', 'important', 'critical'];
const VALID_AUDIENCES: ReadonlyArray<AnnouncementAudience> = [
  'all',
  'free',
  'paid',
  'pro',
  'team',
  'enterprise',
];

/**
 * Parse a "0.8.0" / "0.8" / "1" style version into a numeric tuple.
 * Returns null for malformed input. Non-numeric pre-release suffixes are
 * stripped at the first non-digit character of each segment so "0.8.0-beta.1"
 * compares as [0, 8, 0].
 */
export function parseVersion(v: string): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts.slice(0, 3)) {
    const digits = p.match(/^\d+/);
    if (!digits) return null;
    const n = Number(digits[0]);
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  while (nums.length < 3) nums.push(0);
  return [nums[0]!, nums[1]!, nums[2]!];
}

/** -1 if a < b, 0 if equal, 1 if a > b */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return -1;
    if (pa[i]! > pb[i]!) return 1;
  }
  return 0;
}

export function isVersionInRange(
  version: string,
  minInclusive: string | null,
  maxInclusive: string | null,
): boolean {
  if (minInclusive && compareVersions(version, minInclusive) < 0) return false;
  if (maxInclusive && compareVersions(version, maxInclusive) > 0) return false;
  return true;
}

/**
 * Audience targeting rules (see the app parser for the authoritative comment).
 * `severity: 'info'` is hidden from paid tiers (conversion-targeted marketing).
 */
export function isVisibleToUser(
  ann: Pick<Announcement, 'audience' | 'severity'>,
  tier: LicenseTier,
): boolean {
  const isPaidTier = tier === 'pro' || tier === 'team' || tier === 'enterprise';

  if (ann.severity === 'info') {
    if (isPaidTier || tier === 'developer') return false;
    if (ann.audience === 'pro' || ann.audience === 'team' || ann.audience === 'enterprise')
      return false;
    if (ann.audience === 'paid') return false;
    return true; // 'all' or 'free'
  }

  switch (ann.audience) {
    case 'all':
      return true;
    case 'free':
      return tier === 'free';
    case 'paid':
      return isPaidTier;
    case 'pro':
      return tier === 'pro';
    case 'team':
      return tier === 'team';
    case 'enterprise':
      return tier === 'enterprise';
  }
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asLinks(v: unknown): AnnouncementLink[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item): AnnouncementLink | null => {
      if (item === null || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const label = asString(r.label).trim();
      const url = asString(r.url).trim();
      if (!label || !url) return null;
      if (!/^https?:\/\//i.test(url)) return null;
      return { label, url };
    })
    .filter((l): l is AnnouncementLink => l !== null);
}

/**
 * Parses a raw feed payload (anything the fetcher gives us) into a clean
 * Announcement[] with safe defaults. Invalid items are dropped silently
 * rather than throwing — a malformed entry on the server should never crash
 * the client.
 */
export function parseAnnouncementFeed(raw: unknown): Announcement[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.announcements)
      ? ((raw as Record<string, unknown>).announcements as unknown[])
      : [];

  return list
    .map((item): Announcement | null => {
      if (item === null || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const id = asString(r.id).trim();
      const title = asString(r.title).trim();
      if (!id || !title) return null;
      const severity = VALID_SEVERITIES.includes(r.severity as AnnouncementSeverity)
        ? (r.severity as AnnouncementSeverity)
        : 'info';
      const audience = VALID_AUDIENCES.includes(r.audience as AnnouncementAudience)
        ? (r.audience as AnnouncementAudience)
        : 'all';
      const minVersion = asString(r.min_version ?? r.minVersion).trim() || null;
      const maxVersion = asString(r.max_version ?? r.maxVersion).trim() || null;
      const publishedAt =
        asString(r.published_at ?? r.publishedAt).trim() || new Date(0).toISOString();
      // ---- Build 18 addition (see header) ----------------------------------
      const category = VALID_CATEGORIES.includes(r.category as AnnouncementCategory)
        ? (r.category as AnnouncementCategory)
        : 'general';
      // ----------------------------------------------------------------------
      return {
        id,
        severity,
        audience,
        minVersion,
        maxVersion,
        title,
        body: asString(r.body),
        links: asLinks(r.links),
        publishedAt,
        category,
      };
    })
    .filter((a): a is Announcement => a !== null);
}
