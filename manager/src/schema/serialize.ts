import type { AuthorEntry } from './types.js';
import { CATEGORIES, AUDIENCES, SEVERITIES } from './types.js';

/**
 * On-disk (snake_case) shape of a single feed entry. Key ORDER here is the
 * canonical order `serializeFeed` writes, chosen for readable, diff-friendly
 * JSON: identity first (id/category/severity/audience), then targeting
 * (version range), then content (title/body/links), then the timestamp.
 */
interface RawEntry {
  id: string;
  category: string;
  severity: string;
  audience: string;
  min_version: string | null;
  max_version: string | null;
  title: string;
  body: string;
  links: { label: string; url: string }[];
  published_at: string;
}

function toRaw(entry: AuthorEntry): RawEntry {
  return {
    id: entry.id,
    category: entry.category,
    severity: entry.severity,
    audience: entry.audience,
    min_version: entry.minVersion && entry.minVersion.trim() ? entry.minVersion.trim() : null,
    max_version: entry.maxVersion && entry.maxVersion.trim() ? entry.maxVersion.trim() : null,
    title: entry.title,
    body: entry.body,
    links: entry.links.map((l) => ({ label: l.label, url: l.url })),
    published_at: entry.publishedAt,
  };
}

/**
 * Serialize the editor's entries to the exact `feed.json` text to write to
 * disk: `{ "announcements": [ ... ] }`, 2-space indent, canonical key order,
 * trailing newline. Deterministic — the same entries always produce identical
 * bytes, so a git diff shows only what actually changed.
 */
export function serializeFeed(entries: AuthorEntry[]): string {
  const payload = { announcements: entries.map(toRaw) };
  return JSON.stringify(payload, null, 2) + '\n';
}

function coerce<T extends string>(v: unknown, valid: readonly T[], fallback: T): T {
  return typeof v === 'string' && (valid as readonly string[]).includes(v) ? (v as T) : fallback;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Load an on-disk feed payload into the editor's AuthorEntry[]. Lenient (so a
 * hand-edited or older feed still opens) but does NOT silently rewrite values:
 * unknown enum values fall back to a default and are surfaced by the validator
 * for the author to fix, rather than being dropped. Both snake_case and
 * camelCase inputs are accepted, mirroring the app parser's tolerance.
 */
export function loadFeed(raw: unknown): AuthorEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.announcements)
      ? ((raw as Record<string, unknown>).announcements as unknown[])
      : [];

  return list
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((r): AuthorEntry => {
      const minVersion = (str(r.min_version) || str(r.minVersion)).trim();
      const maxVersion = (str(r.max_version) || str(r.maxVersion)).trim();
      const rawLinks = Array.isArray(r.links) ? r.links : [];
      return {
        id: str(r.id).trim(),
        category: coerce(r.category, CATEGORIES, 'general'),
        severity: coerce(r.severity, SEVERITIES, 'info'),
        audience: coerce(r.audience, AUDIENCES, 'all'),
        minVersion: minVersion || null,
        maxVersion: maxVersion || null,
        title: str(r.title),
        body: str(r.body),
        links: rawLinks
          .filter((l): l is Record<string, unknown> => l !== null && typeof l === 'object')
          .map((l) => ({ label: str(l.label), url: str(l.url) })),
        publishedAt: (str(r.published_at) || str(r.publishedAt)).trim(),
      };
    });
}
