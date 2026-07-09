import { describe, it, expect } from 'vitest';
import { emptyEntry } from '../types.js';
import type { AuthorEntry } from '../types.js';
import { validateEntry, validateFeed } from '../authoring.js';

function valid(overrides: Partial<AuthorEntry> = {}): AuthorEntry {
  return {
    ...emptyEntry('ok-id'),
    title: 'A title',
    publishedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

const errs = (issues: { level: string; field: string }[]) => issues.filter((i) => i.level === 'error');
const fields = (issues: { field: string }[]) => issues.map((i) => i.field);

describe('validateEntry', () => {
  it('passes a clean entry with no errors', () => {
    expect(errs(validateEntry(valid(), new Set()))).toHaveLength(0);
  });

  it('requires id and title', () => {
    const issues = validateEntry(valid({ id: '', title: '  ' }), new Set());
    expect(fields(errs(issues))).toEqual(expect.arrayContaining(['id', 'title']));
  });

  it('flags duplicate ids', () => {
    const issues = validateEntry(valid({ id: 'dup' }), new Set(['dup']));
    expect(errs(issues).some((i) => i.field === 'id')).toBe(true);
  });

  it('rejects invalid version strings and inverted ranges', () => {
    expect(errs(validateEntry(valid({ minVersion: 'latest' }), new Set())).some((i) => i.field === 'minVersion')).toBe(
      true,
    );
    const inverted = validateEntry(valid({ minVersion: '0.19.0', maxVersion: '0.18.0' }), new Set());
    expect(errs(inverted).some((i) => i.field === 'maxVersion')).toBe(true);
  });

  it('accepts a valid inclusive range', () => {
    const issues = validateEntry(valid({ minVersion: '0.14.0', maxVersion: '0.19.0' }), new Set());
    expect(errs(issues)).toHaveLength(0);
  });

  it('rejects http links (https only) and missing labels', () => {
    const http = validateEntry(valid({ links: [{ label: 'x', url: 'http://example.com' }] }), new Set());
    expect(errs(http).some((i) => i.field === 'links[0].url')).toBe(true);

    const noLabel = validateEntry(valid({ links: [{ label: '', url: 'https://example.com' }] }), new Set());
    expect(errs(noLabel).some((i) => i.field === 'links[0].label')).toBe(true);
  });

  it('accepts https links', () => {
    const issues = validateEntry(valid({ links: [{ label: 'ok', url: 'https://example.com' }] }), new Set());
    expect(errs(issues)).toHaveLength(0);
  });

  it('rejects an invalid published_at', () => {
    const issues = validateEntry(valid({ publishedAt: 'not-a-date' }), new Set());
    expect(errs(issues).some((i) => i.field === 'publishedAt')).toBe(true);
  });

  it('warns (not errors) when security is not critical severity', () => {
    const issues = validateEntry(valid({ category: 'security', severity: 'info' }), new Set());
    expect(errs(issues)).toHaveLength(0);
    expect(issues.some((i) => i.level === 'warning' && i.field === 'severity')).toBe(true);
  });

  it('warns when an ad targets a paid tier (never pops)', () => {
    const issues = validateEntry(valid({ category: 'ad', audience: 'pro' }), new Set());
    expect(issues.some((i) => i.level === 'warning' && i.field === 'audience')).toBe(true);
  });
});

describe('validateFeed', () => {
  it('aggregates counts and detects cross-entry duplicate ids', () => {
    const feed = [valid({ id: 'same' }), valid({ id: 'same' })];
    const result = validateFeed(feed);
    expect(result.hasErrors).toBe(true);
    expect(result.perEntry[0]!.some((i) => i.field === 'id')).toBe(true);
    expect(result.perEntry[1]!.some((i) => i.field === 'id')).toBe(true);
  });

  it('reports zero errors for a valid feed', () => {
    const result = validateFeed([valid({ id: 'a' }), valid({ id: 'b' })]);
    expect(result.hasErrors).toBe(false);
    expect(result.errorCount).toBe(0);
  });
});
