import type { AuthorEntry } from './types.js';
import { AUDIENCES, CATEGORIES, SEVERITIES } from './types.js';
import { parseVersion } from './app-parser.js';

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  /** dotted field path, e.g. "title", "links[0].url", "" for entry-level */
  field: string;
  level: IssueLevel;
  message: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Validate a single entry. `otherIds` is the set of ids used by the OTHER
 * entries in the feed (for duplicate detection). Errors block publish;
 * warnings are advisory guardrails (the entry is still schema-valid).
 */
export function validateEntry(entry: AuthorEntry, otherIds: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ field, level: 'error', message });
  const warn = (field: string, message: string) =>
    issues.push({ field, level: 'warning', message });

  // id
  const id = entry.id.trim();
  if (!id) {
    err('id', 'id is required — the app uses it to track read state.');
  } else {
    if (otherIds.has(id)) err('id', `Duplicate id "${id}". Every entry needs a unique id.`);
    if (!SLUG_RE.test(id))
      warn(
        'id',
        'Prefer a lowercase slug id (letters, digits, "-", ".", "_"), e.g. "security-2026-07".',
      );
  }

  // title
  if (!entry.title.trim()) err('title', 'title is required — an entry with no title is dropped.');

  // enums (defensive — the UI constrains these, but a hand-import might not)
  if (!CATEGORIES.includes(entry.category))
    err('category', `category must be one of: ${CATEGORIES.join(', ')}.`);
  if (!SEVERITIES.includes(entry.severity))
    err('severity', `severity must be one of: ${SEVERITIES.join(', ')}.`);
  if (!AUDIENCES.includes(entry.audience))
    err('audience', `audience must be one of: ${AUDIENCES.join(', ')}.`);

  // version range
  const min = entry.minVersion?.trim() || '';
  const max = entry.maxVersion?.trim() || '';
  if (min && !parseVersion(min)) err('minVersion', `"${min}" is not a valid version (e.g. 0.18.0).`);
  if (max && !parseVersion(max)) err('maxVersion', `"${max}" is not a valid version (e.g. 0.18.0).`);
  if (min && max && parseVersion(min) && parseVersion(max)) {
    const pa = parseVersion(min)!;
    const pb = parseVersion(max)!;
    const cmp = pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    if (cmp > 0) err('maxVersion', `max_version (${max}) is below min_version (${min}).`);
  }

  // links — https-only per the build brief (the app parser also tolerates
  // http, but the tool must never emit anything weaker than https).
  entry.links.forEach((link, i) => {
    if (!link.label.trim()) err(`links[${i}].label`, 'Link label is required.');
    const url = link.url.trim();
    if (!url) {
      err(`links[${i}].url`, 'Link url is required.');
    } else if (!/^https:\/\//i.test(url)) {
      err(`links[${i}].url`, 'Links must be https:// URLs.');
    } else {
      try {
        // eslint-disable-next-line no-new
        new URL(url);
      } catch {
        err(`links[${i}].url`, `"${url}" is not a valid URL.`);
      }
    }
  });

  // published_at
  const pub = entry.publishedAt.trim();
  if (!pub) {
    err('publishedAt', 'published_at is required.');
  } else if (Number.isNaN(Date.parse(pub))) {
    err('publishedAt', `"${pub}" is not a valid ISO date/time.`);
  }

  // Cross-field guardrails (warnings only) — steer authors toward the Build 18
  // model without blocking a deliberate choice.
  if (entry.category === 'security' && entry.severity !== 'critical')
    warn(
      'severity',
      'Security announcements force-pop for everyone; set severity to "critical" so the app treats it as a blocking modal.',
    );
  if (entry.category === 'general' && entry.severity === 'critical')
    warn(
      'severity',
      'severity "critical" force-pops a blocking modal; for an inbox-only item use category "security" only for real security/data-loss notices.',
    );
  if (
    entry.category === 'ad' &&
    (entry.audience === 'paid' ||
      entry.audience === 'pro' ||
      entry.audience === 'team' ||
      entry.audience === 'enterprise')
  )
    warn(
      'audience',
      'Ads target the Lite (ad-supported) rung; paid tiers are ad-free, so this ad will never pop. Use audience "all" or "free".',
    );
  if (
    entry.severity === 'info' &&
    (entry.audience === 'paid' ||
      entry.audience === 'pro' ||
      entry.audience === 'team' ||
      entry.audience === 'enterprise')
  )
    warn(
      'audience',
      'info-severity is hidden from paid tiers, so this entry will never be shown to the selected audience.',
    );

  return issues;
}

export interface FeedValidation {
  /** issues per entry, index-aligned with the input array */
  perEntry: Issue[][];
  /** true if any entry has a blocking error */
  hasErrors: boolean;
  errorCount: number;
  warningCount: number;
}

export function validateFeed(entries: AuthorEntry[]): FeedValidation {
  const perEntry = entries.map((entry, i) => {
    const otherIds = new Set(
      entries.filter((_, j) => j !== i).map((e) => e.id.trim()).filter(Boolean),
    );
    return validateEntry(entry, otherIds);
  });
  let errorCount = 0;
  let warningCount = 0;
  for (const list of perEntry) {
    for (const issue of list) {
      if (issue.level === 'error') errorCount++;
      else warningCount++;
    }
  }
  return { perEntry, hasErrors: errorCount > 0, errorCount, warningCount };
}
