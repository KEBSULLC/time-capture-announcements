import type { AuthorEntry } from './schema/types.js';
import type { FeedValidation } from './schema/authoring.js';

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  feedDirty: boolean;
}

export interface FeedResponse {
  entries: AuthorEntry[];
  feedPath: string;
  feedRel: string;
  exists: boolean;
  git: GitInfo;
}

export interface SaveResult {
  ok: boolean;
  reason?: string;
  validation?: FeedValidation;
}

export interface PublishResult {
  ok: boolean;
  stage?: string;
  committed?: boolean;
  pushed?: boolean;
  reason?: string;
  note?: string;
  error?: string;
  branch?: string;
  message?: string;
  output?: string;
  validation?: FeedValidation;
}

export async function getFeed(): Promise<FeedResponse> {
  const res = await fetch('/api/feed');
  if (!res.ok) throw new Error(`Failed to load feed (${res.status})`);
  return res.json();
}

export async function saveFeed(entries: AuthorEntry[]): Promise<SaveResult> {
  const res = await fetch('/api/feed', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  return res.json();
}

export async function publishFeed(
  entries: AuthorEntry[],
  message: string,
): Promise<PublishResult> {
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries, message }),
  });
  return res.json();
}
