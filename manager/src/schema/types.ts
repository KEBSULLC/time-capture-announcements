import type {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementLink,
  AnnouncementSeverity,
} from './app-parser.js';

export type {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementLink,
  AnnouncementSeverity,
} from './app-parser.js';

/**
 * The editor's working model for one feed entry — camelCase, a superset of
 * the app's `Announcement`. This is what the React forms bind to and what the
 * server persists (via `serialize.ts`). It maps 1:1 onto the on-disk
 * snake_case shape the app parser reads.
 */
export interface AuthorEntry {
  id: string;
  category: AnnouncementCategory;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  minVersion: string | null;
  maxVersion: string | null;
  title: string;
  body: string;
  links: AnnouncementLink[];
  publishedAt: string;
}

export const SEVERITIES: readonly AnnouncementSeverity[] = ['info', 'important', 'critical'];
export const AUDIENCES: readonly AnnouncementAudience[] = [
  'all',
  'free',
  'paid',
  'pro',
  'team',
  'enterprise',
];
export const CATEGORIES: readonly AnnouncementCategory[] = ['security', 'ad', 'general'];

/** How the app renders/behaves for each Build 18 category. */
export type RenderMode = 'modal' | 'ad' | 'inbox';

export function renderModeForCategory(category: AnnouncementCategory): RenderMode {
  switch (category) {
    case 'security':
      return 'modal';
    case 'ad':
      return 'ad';
    case 'general':
      return 'inbox';
  }
}

export function emptyEntry(id = ''): AuthorEntry {
  return {
    id,
    category: 'general',
    severity: 'info',
    audience: 'all',
    minVersion: null,
    maxVersion: null,
    title: '',
    body: '',
    links: [],
    publishedAt: new Date().toISOString(),
  };
}
